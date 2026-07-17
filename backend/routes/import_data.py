import csv
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Account, BankProfile, ImportBatch, Transaction
from ..categorizer import seed_default_categories
from ..parser import (
    _categorize_all,
    _mark_internal_transfers,
    is_revolut_csv,
    parse_file,
    parse_generic_csv,
    parse_revolut_csv,
)

router = APIRouter(prefix="/import", tags=["import"])

DATA_DIR = Path(__file__).parent.parent.parent / "data"
UPLOADS_DIR = DATA_DIR / "uploads"


class NewAccountIn(BaseModel):
    name: str
    currency: str = "CHF"


class MappingIn(BaseModel):
    delimiter: str = ","
    date_column: str
    date_format: str
    description_column: Optional[str] = None
    counterparty_column: Optional[str] = None
    amount_mode: Literal["single_signed", "single_unsigned_with_type", "separate_debit_credit"]
    amount_column: Optional[str] = None
    type_column: Optional[str] = None
    credit_value: Optional[str] = None
    debit_column: Optional[str] = None
    credit_column: Optional[str] = None
    decimal_separator: str = "."


class MapImportIn(BaseModel):
    mapping: MappingIn
    account_id: Optional[int] = None
    new_account: Optional[NewAccountIn] = None
    save_profile_name: Optional[str] = None


def _detect_delimiter(path: Path) -> str:
    with open(path, "r", encoding="utf-8-sig") as f:
        first_line = f.readline()
    try:
        return csv.Sniffer().sniff(first_line, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","


_COMMA_DECIMAL = re.compile(r"^-?\d{1,3}(\.\d{3})*,\d{1,2}$")
_DOT_DECIMAL = re.compile(r"^-?\d{1,3}(,\d{3})*\.\d{1,2}$")


def _detect_decimal_separator(rows: list[list[str]]) -> str:
    comma_hits = dot_hits = 0
    for row in rows:
        for cell in row:
            c = cell.strip()
            if _COMMA_DECIMAL.match(c):
                comma_hits += 1
            elif _DOT_DECIMAL.match(c):
                dot_hits += 1
    return "," if comma_hits > dot_hits else "."


def _read_headers_and_sample(path: Path, delimiter: Optional[str] = None) -> tuple[list[str], list[list[str]]]:
    if delimiter is None:
        delimiter = _detect_delimiter(path)
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f, delimiter=delimiter)
        rows = list(reader)
    headers = rows[0] if rows else []
    return headers, rows[1:6]


def _account_out(a: Account) -> dict:
    return {"id": a.id, "name": a.name, "currency": a.currency}


@router.post("/upload")
async def upload(file: UploadFile = File(...), db: Session = Depends(get_db)):
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    original_name = file.filename or "upload"
    upload_id = uuid.uuid4().hex
    stored_path = UPLOADS_DIR / f"{upload_id}_{original_name}"
    with open(stored_path, "wb") as out:
        shutil.copyfileobj(file.file, out)

    suffix = Path(original_name).suffix.lower()
    if suffix == ".xml":
        kind = "camt"
    elif suffix == ".csv" and is_revolut_csv(stored_path):
        kind = "revolut"
    elif suffix == ".csv":
        kind = "generic_csv"
    else:
        stored_path.unlink(missing_ok=True)
        raise HTTPException(400, "Format de fichier non supporté (XML ou CSV attendu).")

    if kind == "generic_csv":
        delimiter = _detect_delimiter(stored_path)
        headers, sample_rows = _read_headers_and_sample(stored_path, delimiter=delimiter)
        signature = sorted(headers)
        matched = next(
            (p for p in db.query(BankProfile).all() if sorted(p.header_signature) == signature),
            None,
        )
        return {
            "status": "needs_mapping",
            "upload_id": upload_id,
            "delimiter": delimiter,
            "decimal_separator": _detect_decimal_separator(sample_rows),
            "headers": headers,
            "sample_rows": sample_rows,
            "accounts": [_account_out(a) for a in db.query(Account).filter(Account.is_active == True).order_by(Account.name).all()],
            "suggested_profile": (
                {"id": matched.id, "name": matched.name, "mapping": matched.mapping} if matched else None
            ),
        }

    seed_default_categories(db)
    known_ibans = {a.iban for a in db.query(Account).all()}
    batch = ImportBatch(filename=original_name, stored_path=str(stored_path.relative_to(DATA_DIR)), kind=kind)
    db.add(batch)
    db.flush()

    if kind == "camt":
        accts, txs = parse_file(stored_path, db, known_ibans, import_batch_id=batch.id)
    else:
        accts, txs = parse_revolut_csv(stored_path, db, known_ibans, import_batch_id=batch.id)

    _categorize_all(db)
    _mark_internal_transfers(db, known_ibans)
    db.commit()

    if txs == 0:
        db.delete(batch)
        db.commit()
        stored_path.unlink(missing_ok=True)
        return {"status": "imported", "batch_id": None, "accounts": 0, "transactions": 0}

    return {"status": "imported", "batch_id": batch.id, "accounts": accts, "transactions": txs}


@router.post("/upload/{upload_id}/map")
def map_upload(upload_id: str, body: MapImportIn, db: Session = Depends(get_db)):
    matches = list(UPLOADS_DIR.glob(f"{upload_id}_*"))
    if not matches:
        raise HTTPException(404, "Fichier introuvable ou déjà traité.")
    stored_path = matches[0]

    if body.account_id is not None:
        account = db.query(Account).filter(Account.id == body.account_id).first()
        if not account:
            raise HTTPException(404, "Compte introuvable.")
        accts_created = 0
    elif body.new_account is not None:
        account = Account(
            iban=f"GENERIC_{uuid.uuid4().hex[:10].upper()}",
            name=body.new_account.name,
            currency=body.new_account.currency,
        )
        db.add(account)
        db.flush()
        accts_created = 1
    else:
        raise HTTPException(400, "Précisez un compte existant ou les informations d'un nouveau compte.")

    seed_default_categories(db)
    known_ibans = {a.iban for a in db.query(Account).all()}

    original_name = stored_path.name.split("_", 1)[1] if "_" in stored_path.name else stored_path.name
    batch = ImportBatch(filename=original_name, stored_path=str(stored_path.relative_to(DATA_DIR)), kind="generic_csv")
    db.add(batch)
    db.flush()

    mapping_dict = body.mapping.model_dump()
    txs = parse_generic_csv(stored_path, mapping_dict, account, db, import_batch_id=batch.id)

    _categorize_all(db)
    _mark_internal_transfers(db, known_ibans)
    db.commit()

    if txs == 0:
        db.delete(batch)
        db.commit()
        return {"status": "imported", "batch_id": None, "accounts": 0, "transactions": 0}

    if body.save_profile_name:
        headers, _ = _read_headers_and_sample(stored_path, delimiter=body.mapping.delimiter)
        signature = sorted(headers)
        existing = db.query(BankProfile).filter(BankProfile.name == body.save_profile_name).first()
        if existing:
            existing.header_signature = signature
            existing.mapping = mapping_dict
        else:
            db.add(BankProfile(name=body.save_profile_name, header_signature=signature, mapping=mapping_dict))
        db.commit()

    return {"status": "imported", "batch_id": batch.id, "accounts": accts_created, "transactions": txs}


@router.get("/batches")
def list_batches(db: Session = Depends(get_db)):
    batches = db.query(ImportBatch).order_by(ImportBatch.created_at.desc()).all()
    result = []
    for b in batches:
        account_ids = {t.account_id for t in b.transactions}
        accounts = db.query(Account).filter(Account.id.in_(account_ids)).all() if account_ids else []
        result.append({
            "id": b.id,
            "filename": b.filename,
            "kind": b.kind,
            "created_at": b.created_at,
            "transaction_count": len(b.transactions),
            "accounts": [_account_out(a) for a in accounts],
        })
    legacy_count = db.query(func.count(Transaction.id)).filter(Transaction.import_batch_id.is_(None)).scalar() or 0
    return {"batches": result, "legacy_transaction_count": legacy_count}


@router.delete("/batches/{batch_id}")
def delete_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.query(ImportBatch).filter(ImportBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(404, "Import introuvable.")

    account_ids = {
        row[0] for row in
        db.query(Transaction.account_id).filter(Transaction.import_batch_id == batch_id).distinct().all()
    }
    stored_full_path = DATA_DIR / batch.stored_path

    db.query(Transaction).filter(Transaction.import_batch_id == batch_id).delete(synchronize_session=False)
    db.query(ImportBatch).filter(ImportBatch.id == batch_id).delete(synchronize_session=False)
    db.commit()

    for acc_id in account_ids:
        remaining = db.query(func.count(Transaction.id)).filter(Transaction.account_id == acc_id).scalar() or 0
        if remaining == 0:
            account = db.query(Account).filter(Account.id == acc_id).first()
            if account:
                db.delete(account)
    db.commit()

    if stored_full_path.exists():
        stored_full_path.unlink()

    return {"status": "deleted"}


WIPE_ALL_CONFIRMATION = "TOUT SUPPRIMER"


class WipeAllIn(BaseModel):
    confirm: str


@router.delete("/wipe-all")
def wipe_all(body: WipeAllIn, db: Session = Depends(get_db)):
    """
    Full factory reset: every account, transaction, category, budget,
    history entry, saved CSV mapping, and uploaded bank file — gone. Meant
    for "start over as a new user" without touching the database file
    directly. Requires typing an exact confirmation phrase (checked here too,
    not just client-side) since there is no undo.
    """
    if body.confirm != WIPE_ALL_CONFIRMATION:
        raise HTTPException(400, "Confirmation invalide.")

    from ..models import Budget, Category, HistoryEntry, Setting
    from ..categorizer import seed_default_categories

    db.query(Transaction).delete(synchronize_session=False)
    db.query(ImportBatch).delete(synchronize_session=False)
    db.query(Account).delete(synchronize_session=False)
    db.query(Budget).delete(synchronize_session=False)
    db.query(HistoryEntry).delete(synchronize_session=False)
    db.query(Category).delete(synchronize_session=False)
    db.query(BankProfile).delete(synchronize_session=False)
    db.query(Setting).delete(synchronize_session=False)
    db.commit()

    if UPLOADS_DIR.exists():
        for f in UPLOADS_DIR.iterdir():
            if f.is_file():
                f.unlink()

    seed_default_categories(db)

    return {"status": "wiped"}
