from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from pydantic import BaseModel
from typing import Optional
from datetime import date
from ..database import get_db
from ..models import Budget, Category, Transaction

router = APIRouter(prefix="/budgets", tags=["budgets"])


class BudgetCreate(BaseModel):
    category_id: int
    month: str   # YYYY-MM
    amount_limit: float


class BudgetUpdate(BaseModel):
    amount_limit: float


class BudgetOut(BaseModel):
    id: int
    category_id: int
    category_name: str
    category_color: str
    category_icon: str
    month: str
    amount_limit: float
    spent: float
    percent: float


@router.get("", response_model=list[BudgetOut])
def list_budgets(
    month: Optional[str] = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    if month is None:
        today = date.today()
        month = f"{today.year:04d}-{today.month:02d}"

    year_int, month_int = int(month[:4]), int(month[5:7])

    budgets = db.query(Budget).filter(Budget.month == month).all()

    result = []
    for b in budgets:
        cat = db.query(Category).filter(Category.id == b.category_id).first()
        spent_q = (
            db.query(func.sum(Transaction.amount))
            .filter(
                Transaction.category_id == b.category_id,
                Transaction.is_credit == False,
                Transaction.is_internal == False,
                Transaction.is_reversal == False,
                extract("year", Transaction.date) == year_int,
                extract("month", Transaction.date) == month_int,
            )
            .scalar() or 0.0
        )
        percent = (spent_q / b.amount_limit * 100) if b.amount_limit > 0 else 0.0
        result.append(BudgetOut(
            id=b.id,
            category_id=b.category_id,
            category_name=cat.name if cat else "Unknown",
            category_color=cat.color if cat else "#6B7280",
            category_icon=cat.icon if cat else "❓",
            month=b.month,
            amount_limit=b.amount_limit,
            spent=round(spent_q, 2),
            percent=round(min(percent, 999), 1),
        ))

    return result


@router.post("", response_model=BudgetOut)
def create_budget(body: BudgetCreate, db: Session = Depends(get_db)):
    existing = db.query(Budget).filter(
        Budget.category_id == body.category_id,
        Budget.month == body.month,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Budget already exists for this category/month")

    b = Budget(**body.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)

    cat = db.query(Category).filter(Category.id == b.category_id).first()
    return BudgetOut(
        id=b.id,
        category_id=b.category_id,
        category_name=cat.name if cat else "Unknown",
        category_color=cat.color if cat else "#6B7280",
        category_icon=cat.icon if cat else "❓",
        month=b.month,
        amount_limit=b.amount_limit,
        spent=0.0,
        percent=0.0,
    )


@router.put("/{budget_id}", response_model=BudgetOut)
def update_budget(budget_id: int, body: BudgetUpdate, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget not found")
    b.amount_limit = body.amount_limit
    db.commit()
    db.refresh(b)

    year_int, month_int = int(b.month[:4]), int(b.month[5:7])
    cat = db.query(Category).filter(Category.id == b.category_id).first()
    spent_q = (
        db.query(func.sum(Transaction.amount))
        .filter(
            Transaction.category_id == b.category_id,
            Transaction.is_credit == False,
            Transaction.is_internal == False,
            Transaction.is_reversal == False,
            extract("year", Transaction.date) == year_int,
            extract("month", Transaction.date) == month_int,
        )
        .scalar() or 0.0
    )
    percent = (spent_q / b.amount_limit * 100) if b.amount_limit > 0 else 0.0

    return BudgetOut(
        id=b.id,
        category_id=b.category_id,
        category_name=cat.name if cat else "Unknown",
        category_color=cat.color if cat else "#6B7280",
        category_icon=cat.icon if cat else "❓",
        month=b.month,
        amount_limit=b.amount_limit,
        spent=round(spent_q, 2),
        percent=round(min(percent, 999), 1),
    )


@router.delete("/{budget_id}")
def delete_budget(budget_id: int, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget not found")
    db.delete(b)
    db.commit()
    return {"ok": True}
