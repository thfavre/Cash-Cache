from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, HistoryEntry, Transaction

router = APIRouter(prefix="/history", tags=["history"])


class HistoryOut(BaseModel):
    id: int
    created_at: datetime
    action: str
    summary: str
    reverted: bool
    transactions: list[str] | None = None

    class Config:
        from_attributes = True


@router.get("", response_model=list[HistoryOut])
def list_history(db: Session = Depends(get_db)):
    entries = (
        db.query(HistoryEntry)
        .order_by(HistoryEntry.id.desc())
        .limit(200)
        .all()
    )

    tx_ids = {
        change["tx_id"]
        for entry in entries if entry.action in ("assign", "recategorize")
        for change in entry.payload.get("changes", [])
    }
    tx_labels = {}
    if tx_ids:
        for tx in db.query(Transaction).filter(Transaction.id.in_(tx_ids)).all():
            tx_labels[tx.id] = tx.counterparty or tx.description or f"Transaction #{tx.id}"

    results = []
    for entry in entries:
        out = HistoryOut.model_validate(entry)
        if entry.action in ("assign", "recategorize"):
            out.transactions = [
                tx_labels[change["tx_id"]]
                for change in entry.payload.get("changes", [])
                if change["tx_id"] in tx_labels
            ]
        results.append(out)
    return results


@router.post("/{entry_id}/revert", response_model=HistoryOut)
def revert_history(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(HistoryEntry).filter(HistoryEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="History entry not found")
    if entry.reverted:
        raise HTTPException(status_code=400, detail="Already reverted")

    if entry.action == "edit_rules":
        cat = db.query(Category).filter(Category.id == entry.payload["category_id"]).first()
        if not cat:
            raise HTTPException(status_code=404, detail="Category no longer exists")
        cat.rules = entry.payload["previous_rules"]

    elif entry.action in ("assign", "recategorize"):
        for change in entry.payload["changes"]:
            tx = db.query(Transaction).filter(Transaction.id == change["tx_id"]).first()
            if tx:
                prev_cat_id = change["previous_category_id"]
                tx.category_id = prev_cat_id
                prev_cat = db.query(Category).filter(Category.id == prev_cat_id).first() if prev_cat_id else None
                tx.is_internal = bool(prev_cat.is_ignored) if prev_cat else False

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {entry.action}")

    entry.reverted = True
    db.commit()
    db.refresh(entry)
    return entry
