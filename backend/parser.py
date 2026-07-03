"""
CAMT.053.001.08 XML parser for Swiss bank statements (Raiffeisen / ISO 20022).
Handles all 3 accounts: main current account, savings, and rent deposit.
"""
from __future__ import annotations

import csv
import hashlib
import os
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import lxml.etree as ET
from sqlalchemy.orm import Session

from .models import Account, Transaction
from .categorizer import categorize, seed_default_categories

NS = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"
NSD = {"ns": NS}


def _t(el: ET._Element, xpath: str) -> Optional[str]:
    """Return stripped text of first XPath match, or None."""
    found = el.find(xpath, NSD)
    return found.text.strip() if found is not None and found.text else None


def _all(el: ET._Element, xpath: str) -> list[ET._Element]:
    return el.findall(xpath, NSD)


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _parse_amount(el: ET._Element, xpath: str) -> Optional[float]:
    found = el.find(xpath, NSD)
    if found is not None and found.text:
        try:
            return float(found.text.strip())
        except ValueError:
            pass
    return None


def _build_tx_code(ntry: ET._Element) -> str:
    domain = _t(ntry, "ns:BkTxCd/ns:Domn/ns:Cd") or ""
    family = _t(ntry, "ns:BkTxCd/ns:Domn/ns:Fmly/ns:Cd") or ""
    subfam = _t(ntry, "ns:BkTxCd/ns:Domn/ns:Fmly/ns:SubFmlyCd") or ""
    return f"{domain}/{family}/{subfam}".strip("/")


def _get_counterparty(ntry: ET._Element, is_credit: bool) -> tuple[Optional[str], Optional[str]]:
    """
    For credits (money coming in): debtor is the counterparty.
    For debits (money going out): creditor is the counterparty.
    Returns (name, iban).
    """
    tx = ntry.find("ns:NtryDtls/ns:TxDtls", NSD)
    if tx is None:
        return None, None

    if is_credit:
        name = _t(tx, "ns:RltdPties/ns:Dbtr/ns:Pty/ns:Nm")
        iban = _t(tx, "ns:RltdPties/ns:DbtrAcct/ns:Id/ns:IBAN")
    else:
        name = _t(tx, "ns:RltdPties/ns:Cdtr/ns:Pty/ns:Nm")
        iban = _t(tx, "ns:RltdPties/ns:CdtrAcct/ns:Id/ns:IBAN")

    return name, iban


def _get_remittance(ntry: ET._Element) -> Optional[str]:
    tx = ntry.find("ns:NtryDtls/ns:TxDtls", NSD)
    if tx is None:
        return None
    unstrd = _t(tx, "ns:RmtInf/ns:Ustrd")
    if unstrd:
        return unstrd
    return _t(tx, "ns:RmtInf/ns:Strd/ns:AddtlRmtInf")


def _get_uetr(ntry: ET._Element) -> Optional[str]:
    tx = ntry.find("ns:NtryDtls/ns:TxDtls", NSD)
    if tx is None:
        return None
    return _t(tx, "ns:Refs/ns:UETR")


def parse_file(xml_path: Path, db: Session, known_ibans: set[str]) -> tuple[int, int]:
    """
    Parse one CAMT.053 XML file and upsert into the database.
    Returns (accounts_created, transactions_imported).
    """
    tree = ET.parse(str(xml_path))
    root = tree.getroot()

    stmt = root.find(".//ns:Stmt", NSD)
    if stmt is None:
        return 0, 0

    # --- Account ---
    iban = _t(stmt, "ns:Acct/ns:Id/ns:IBAN")
    acct_name = (
        _t(stmt, "ns:Acct/ns:Nm")                          # explicit name (not present in Raiffeisen exports)
        or _t(stmt, "ns:Acct/ns:Svcr/ns:FinInstnId/ns:Nm") # fall back to bank name
        or f"Compte ...{iban[-4:]}"                          # last resort
    )
    currency = _t(stmt, "ns:Acct/ns:Ccy") or "CHF"

    def _balance(code: str) -> float:
        for bal in _all(stmt, "ns:Bal"):
            cd = _t(bal, "ns:Tp/ns:CdOrPrtry/ns:Cd")
            if cd == code:
                amt = _parse_amount(bal, "ns:Amt") or 0.0
                ind = _t(bal, "ns:CdtDbtInd")
                return amt if ind == "CRDT" else -amt
        return 0.0

    opening_balance = _balance("OPBD")
    closing_balance = _balance("CLBD")

    account = db.query(Account).filter(Account.iban == iban).first()
    accts_created = 0
    if account is None:
        account = Account(
            iban=iban,
            name=acct_name,
            currency=currency,
            opening_balance=opening_balance,
            closing_balance=closing_balance,
        )
        db.add(account)
        db.flush()
        accts_created = 1
    else:
        account.closing_balance = closing_balance
        account.name = acct_name

    known_ibans.add(iban)
    tx_count = 0

    for ntry in _all(stmt, "ns:Ntry"):
        bank_ref = _t(ntry, "ns:AcctSvcrRef")
        if not bank_ref:
            continue

        # Skip if already imported (idempotent)
        if db.query(Transaction).filter(Transaction.bank_ref == bank_ref).first():
            continue

        amount = _parse_amount(ntry, "ns:Amt")
        if amount is None:
            continue

        is_credit = (_t(ntry, "ns:CdtDbtInd") or "DBIT") == "CRDT"
        is_reversal = (_t(ntry, "ns:RvslInd") or "false").lower() == "true"
        booking_date = _parse_date(_t(ntry, "ns:BookgDt/ns:Dt"))
        value_date = _parse_date(_t(ntry, "ns:ValDt/ns:Dt"))
        description = _t(ntry, "ns:AddtlNtryInf")
        tx_code = _build_tx_code(ntry)
        counterparty, cpty_iban = _get_counterparty(ntry, is_credit)
        remittance = _get_remittance(ntry)
        uetr = _get_uetr(ntry)

        is_internal = bool(cpty_iban and cpty_iban in known_ibans)

        tx = Transaction(
            account_id=account.id,
            date=booking_date,
            value_date=value_date,
            amount=amount,
            is_credit=is_credit,
            description=description,
            counterparty=counterparty,
            counterparty_iban=cpty_iban,
            remittance_info=remittance,
            tx_code=tx_code,
            bank_ref=bank_ref,
            uetr=uetr,
            is_reversal=is_reversal,
            is_internal=is_internal,
        )
        db.add(tx)
        tx_count += 1

    db.commit()
    return accts_created, tx_count


def is_revolut_csv(path: Path) -> bool:
    if path.suffix.lower() != ".csv":
        return False
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            first_line = f.readline().strip()
            headers = [h.strip() for h in first_line.split(",")]
            required = {"Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"}
            return required.issubset(set(headers))
    except Exception:
        return False


def get_revolut_counterparty(description: str) -> str:
    desc_lower = description.lower()
    for prefix in ["transfer from ", "transfer to ", "payment from ", "payment to ", "to pocket "]:
        if desc_lower.startswith(prefix):
            return description[len(prefix):].strip()
    return description.strip()


def make_revolut_bank_ref(row: dict) -> str:
    # Product, Started Date, Description, Amount, Currency, State, Balance
    s = f"{row.get('Product')}|{row.get('Started Date')}|{row.get('Description')}|{row.get('Amount')}|{row.get('Currency')}|{row.get('State')}|{row.get('Balance')}"
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def parse_revolut_csv(csv_path: Path, db: Session, known_ibans: set[str]) -> tuple[int, int]:
    """
    Parse a Revolut statement CSV file and upsert into the database.
    Returns (accounts_created, transactions_imported).
    """
    rows = []
    try:
        with open(csv_path, mode="r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                cleaned_row = {k.strip(): v.strip() for k, v in row.items() if k is not None and v is not None}
                rows.append(cleaned_row)
    except Exception as e:
        print(f"Error reading Revolut CSV {csv_path}: {e}")
        return 0, 0

    if not rows:
        return 0, 0

    accounts_by_key = {}
    accts_created = 0

    # Group completed rows by Product and Currency to find opening/closing balances
    completed_rows_by_key = {}
    for row in rows:
        if row.get("State") == "COMPLETED":
            key = (row.get("Product"), row.get("Currency"))
            completed_rows_by_key.setdefault(key, []).append(row)

    for key, g_rows in completed_rows_by_key.items():
        product, currency = key
        if not product or not currency:
            continue
        g_rows.sort(key=lambda r: r.get("Started Date", ""))

        first_tx = g_rows[0]
        last_tx = g_rows[-1]

        try:
            first_amt = float(first_tx.get("Amount", "0"))
            first_bal = float(first_tx.get("Balance", "0"))
            last_bal = float(last_tx.get("Balance", "0"))
        except ValueError:
            first_amt = 0.0
            first_bal = 0.0
            last_bal = 0.0

        opening_balance = first_bal - first_amt
        closing_balance = last_bal

        iban = f"REVOLUT_{product.upper()}_{currency.upper()}"
        acct_name = f"Revolut {product} ({currency})"

        account = db.query(Account).filter(Account.iban == iban).first()
        if account is None:
            account = Account(
                iban=iban,
                name=acct_name,
                currency=currency,
                opening_balance=opening_balance,
                closing_balance=closing_balance,
            )
            db.add(account)
            db.flush()
            accts_created += 1
        else:
            account.closing_balance = closing_balance
            account.name = acct_name

        accounts_by_key[key] = account
        known_ibans.add(iban)

    # Identify internal transfers between Revolut Savings and Current
    revolut_internal_keys = set()
    completed_by_time_amt = {}
    for row in rows:
        if row.get("State") == "COMPLETED":
            try:
                amt_val = abs(float(row.get("Amount", "0")))
            except ValueError:
                amt_val = 0.0
            time_amt_key = (row.get("Started Date"), amt_val)
            completed_by_time_amt.setdefault(time_amt_key, []).append(row)

    for (started_date, abs_amt), group in completed_by_time_amt.items():
        if len(group) == 2:
            row1, row2 = group[0], group[1]
            try:
                val1 = float(row1.get("Amount", "0"))
                val2 = float(row2.get("Amount", "0"))
            except ValueError:
                val1 = val2 = 0.0
            if val1 * val2 < 0 and row1.get("Product") != row2.get("Product"):
                revolut_internal_keys.add(make_revolut_bank_ref(row1))
                revolut_internal_keys.add(make_revolut_bank_ref(row2))

    tx_count = 0
    for row in rows:
        product = row.get("Product")
        currency = row.get("Currency")
        key = (product, currency)
        account = accounts_by_key.get(key)
        if not account:
            continue

        bank_ref = make_revolut_bank_ref(row)

        if db.query(Transaction).filter(Transaction.bank_ref == bank_ref).first():
            continue

        try:
            raw_amount = float(row.get("Amount", "0"))
        except ValueError:
            raw_amount = 0.0

        amount = abs(raw_amount)
        is_credit = raw_amount > 0
        is_reversal = row.get("State") == "REVERTED"

        started_dt_str = row.get("Started Date", "")
        completed_dt_str = row.get("Completed Date", "")

        try:
            booking_date = datetime.strptime(started_dt_str[:10], "%Y-%m-%d").date()
        except ValueError:
            continue

        value_date = None
        if completed_dt_str and completed_dt_str != "NaN":
            try:
                value_date = datetime.strptime(completed_dt_str[:10], "%Y-%m-%d").date()
            except ValueError:
                pass

        description = row.get("Description", "")
        counterparty = get_revolut_counterparty(description)
        tx_code = row.get("Type", "")

        is_internal = bank_ref in revolut_internal_keys

        tx = Transaction(
            account_id=account.id,
            date=booking_date,
            value_date=value_date,
            amount=amount,
            is_credit=is_credit,
            description=description,
            counterparty=counterparty,
            counterparty_iban=None,
            remittance_info=description,
            tx_code=tx_code,
            bank_ref=bank_ref,
            uetr=None,
            is_reversal=is_reversal,
            is_internal=is_internal,
        )
        db.add(tx)
        tx_count += 1

    db.commit()
    return accts_created, tx_count


def run_import(data_dir: str, db: Session) -> dict:
    """
    Import all XML and CSV files found recursively under data_dir.
    Must be called after categories have been seeded.
    """
    seed_default_categories(db)

    xml_files = list(Path(data_dir).rglob("*.xml"))
    csv_files = list(Path(data_dir).rglob("*.csv"))
    revolut_files = [p for p in csv_files if is_revolut_csv(p)]

    if not xml_files and not revolut_files:
        return {"files": 0, "accounts": 0, "transactions": 0}

    # First pass: collect all IBANs so internal transfer detection works
    known_ibans: set[str] = set()

    total_accts = 0
    total_txs = 0

    # Sort: smallest file first so savings (few txs) and rent deposit
    # are processed before the huge main account — speeds up IBAN detection
    xml_files.sort(key=lambda p: p.stat().st_size)

    for path in xml_files:
        accts, txs = parse_file(path, db, known_ibans)
        total_accts += accts
        total_txs += txs

    for path in revolut_files:
        accts, txs = parse_revolut_csv(path, db, known_ibans)
        total_accts += accts
        total_txs += txs

    # Second pass: categorize all uncategorized transactions
    _categorize_all(db)

    # Second pass: mark internal transfers using UETR cross-matching
    _mark_internal_transfers(db, known_ibans)

    db.commit()
    return {"files": len(xml_files) + len(revolut_files), "accounts": total_accts, "transactions": total_txs}


def _categorize_all(db: Session) -> None:
    from .models import Category
    txs = db.query(Transaction).filter(Transaction.category_id == None).all()
    categories = db.query(Category).all()
    for tx in txs:
        cat_id = categorize(tx, categories)
        tx.category_id = cat_id


def _mark_internal_transfers(db: Session, known_ibans: set[str]) -> None:
    """
    Use UETR to find transactions that appear in multiple accounts → internal transfers.
    Also mark any transaction whose counterparty IBAN is one of our accounts.
    Also cross-match transfers between Raiffeisen and Revolut accounts.
    """
    from sqlalchemy import func
    # Find UETRs that appear more than once (cross-account)
    dupes = (
        db.query(Transaction.uetr)
        .filter(Transaction.uetr != None)
        .group_by(Transaction.uetr)
        .having(func.count(Transaction.uetr) > 1)
        .all()
    )
    uetr_set = {row.uetr for row in dupes}

    txs = db.query(Transaction).filter(
        (Transaction.uetr.in_(uetr_set)) |
        (Transaction.counterparty_iban.in_(known_ibans))
    ).all()
    for tx in txs:
        tx.is_internal = True

    # Mark cross-bank transfers between Raiffeisen and Revolut
    raiff_candidates = (
        db.query(Transaction)
        .filter(
            Transaction.is_credit == False,
            Transaction.is_internal == False,
            (Transaction.description.ilike("%revolut%") | Transaction.counterparty.ilike("%revolut%"))
        )
        .all()
    )

    revolut_candidates = (
        db.query(Transaction)
        .filter(
            Transaction.is_credit == True,
            Transaction.is_internal == False,
            (Transaction.description.ilike("%thomas%") | Transaction.description.ilike("%favre%"))
        )
        .all()
    )

    for r_tx in raiff_candidates:
        for rev_tx in revolut_candidates:
            if r_tx.amount == rev_tx.amount and abs((r_tx.date - rev_tx.date).days) <= 2:
                r_tx.is_internal = True
                rev_tx.is_internal = True
