from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel
from typing import Optional, List
from ..database import get_db
from ..models import Transaction, Account, Category
from ..history import log_history
from .stats import clean_merchant_name

router = APIRouter(prefix="/transactions", tags=["transactions"])


class TransactionOut(BaseModel):
    id: int
    account_id: int
    account_iban: Optional[str]
    date: str
    amount: float
    is_credit: bool
    description: Optional[str]
    counterparty: Optional[str]
    counterparty_iban: Optional[str]
    remittance_info: Optional[str]
    category_id: Optional[int]
    category_name: Optional[str]
    category_color: Optional[str]
    category_icon: Optional[str]
    tx_code: Optional[str]
    bank_ref: str
    is_reversal: bool
    is_internal: bool

    class Config:
        from_attributes = True


class PaginatedTransactions(BaseModel):
    total: int
    page: int
    per_page: int
    items: list[TransactionOut]


class CategoryUpdate(BaseModel):
    category_id: Optional[int]


class BulkCategoryUpdate(BaseModel):
    tx_ids: list[int]
    category_id: Optional[int]


@router.get("", response_model=PaginatedTransactions)
def list_transactions(
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    uncategorized_only: bool = False,
    year: Optional[int] = None,
    month: Optional[int] = None,
    search: Optional[str] = None,
    merchant: Optional[str] = None,
    merchants: Optional[List[str]] = Query(None),
    is_credit: Optional[bool] = None,
    is_internal: Optional[bool] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    q = db.query(Transaction)

    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    if uncategorized_only:
        # "Non catégorisé" is the fallback category assigned at import
        uncat = db.query(Category).filter(Category.name == "Non catégorisé").first()
        if uncat:
            q = q.filter(
                or_(Transaction.category_id == None, Transaction.category_id == uncat.id)
            )
        else:
            q = q.filter(Transaction.category_id == None)
    elif category_id is not None:
        q = q.filter(Transaction.category_id == category_id)
    if year is not None:
        from sqlalchemy import extract
        q = q.filter(extract("year", Transaction.date) == year)
    if month is not None:
        from sqlalchemy import extract
        q = q.filter(extract("month", Transaction.date) == month)
    if is_credit is not None:
        q = q.filter(Transaction.is_credit == is_credit)
    if is_internal is not None:
        q = q.filter(Transaction.is_internal == is_internal)
    if search:
        term = f"%{search}%"
        q = q.filter(
            or_(
                Transaction.description.ilike(term),
                Transaction.counterparty.ilike(term),
                Transaction.remittance_info.ilike(term),
            )
        )

    q = q.order_by(Transaction.date.desc(), Transaction.id.desc())

    target_merchants = set(merchants) if merchants else ({merchant} if merchant else None)
    if target_merchants:
        # Merchant names are derived client-side via clean_merchant_name, which isn't
        # a SQL-expressible transform, so filter in Python instead of the DB.
        all_txs = q.all()
        matched = [
            tx for tx in all_txs
            if clean_merchant_name(
                tx.counterparty or tx.description or "Divers",
                tx.category.name if tx.category else "Non catégorisé",
            ) in target_merchants
        ]
        total = len(matched)
        txs = matched[(page - 1) * per_page: (page - 1) * per_page + per_page]
    else:
        total = q.count()
        txs = q.offset((page - 1) * per_page).limit(per_page).all()

    items = []
    for tx in txs:
        acct = tx.account
        cat = tx.category
        items.append(TransactionOut(
            id=tx.id,
            account_id=tx.account_id,
            account_iban=acct.iban if acct else None,
            date=str(tx.date),
            amount=tx.amount,
            is_credit=tx.is_credit,
            description=tx.description,
            counterparty=tx.counterparty,
            counterparty_iban=tx.counterparty_iban,
            remittance_info=tx.remittance_info,
            category_id=tx.category_id,
            category_name=cat.name if cat else None,
            category_color=cat.color if cat else "#D1D5DB",
            category_icon=cat.icon if cat else "❓",
            tx_code=tx.tx_code,
            bank_ref=tx.bank_ref,
            is_reversal=tx.is_reversal,
            is_internal=tx.is_internal,
        ))

    return PaginatedTransactions(total=total, page=page, per_page=per_page, items=items)


@router.put("/{tx_id}/category")
def update_category(tx_id: int, body: CategoryUpdate, db: Session = Depends(get_db)):
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    tx.category_id = body.category_id
    db.commit()
    return {"ok": True}


@router.put("/bulk-category")
def bulk_update_category(body: BulkCategoryUpdate, db: Session = Depends(get_db)):
    """
    Assign one or more transactions to a category in a single action, logged
    as one revertible history entry (used for click-to-assign and drag/drop,
    including grouped "most frequent" assignments).
    """
    cat = db.query(Category).filter(Category.id == body.category_id).first() if body.category_id else None

    changes = []
    for tx_id in body.tx_ids:
        tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
        if not tx or tx.category_id == body.category_id:
            continue
        changes.append({"tx_id": tx.id, "previous_category_id": tx.category_id})
        tx.category_id = body.category_id

    db.commit()

    if changes:
        cat_name = cat.name if cat else "Non catégorisé"
        summary = (
            f"1 transaction assignée à {cat_name}" if len(changes) == 1
            else f"{len(changes)} transactions assignées à {cat_name}"
        )
        log_history(
            db, action="assign", summary=summary,
            payload={"category_id": body.category_id, "changes": changes},
        )

    return {"updated": len(changes)}
