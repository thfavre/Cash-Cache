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

    class Config:
        from_attributes = True


@router.get("", response_model=list[HistoryOut])
def list_history(db: Session = Depends(get_db)):
    return (
        db.query(HistoryEntry)
        .order_by(HistoryEntry.id.desc())
        .limit(200)
        .all()
    )


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
                tx.category_id = change["previous_category_id"]

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {entry.action}")

    entry.reverted = True
    db.commit()
    db.refresh(entry)
    return entry
