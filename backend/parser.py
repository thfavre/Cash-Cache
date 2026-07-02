"""
CAMT.053.001.08 XML parser for Swiss bank statements (Raiffeisen / ISO 20022).
Handles all 3 accounts: main current account, savings, and rent deposit.
"""
from __future__ import annotations

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


def run_import(data_dir: str, db: Session) -> dict:
    """
    Import all XML files found recursively under data_dir.
    Must be called after categories have been seeded.
    """
    seed_default_categories(db)

    xml_files = list(Path(data_dir).rglob("*.xml"))
    if not xml_files:
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

    # Second pass: categorize all uncategorized transactions
    _categorize_all(db)

    # Second pass: mark internal transfers using UETR cross-matching
    _mark_internal_transfers(db, known_ibans)

    db.commit()
    return {"files": len(xml_files), "accounts": total_accts, "transactions": total_txs}


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
