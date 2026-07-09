"""
Shared helper for logging revertible categorization actions.
Kept outside routes/ so both categories.py and transactions.py can log
without importing each other.
"""
from sqlalchemy.orm import Session

from .models import HistoryEntry


def log_history(db: Session, action: str, summary: str, payload: dict) -> HistoryEntry:
    entry = HistoryEntry(action=action, summary=summary, payload=payload)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry
