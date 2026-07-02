from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, case
from typing import Optional
from ..database import get_db
from ..models import Transaction, Account, Category

router = APIRouter(prefix="/stats", tags=["stats"])


def _expense_filter(q, account_id, year, month, exclude_internal=True):
    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    if year is not None:
        q = q.filter(extract("year", Transaction.date) == year)
    if month is not None:
        q = q.filter(extract("month", Transaction.date) == month)
    if exclude_internal:
        q = q.filter(Transaction.is_internal == False)
    q = q.filter(Transaction.is_reversal == False)
    return q


@router.get("/overview")
def overview(
    account_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    accounts = db.query(Account).all()
    total_balance = sum(a.closing_balance for a in accounts)

    base = db.query(Transaction)
    base = _expense_filter(base, account_id, year, month)

    income = base.filter(Transaction.is_credit == True).with_entities(func.sum(Transaction.amount)).scalar() or 0.0
    expenses = base.filter(Transaction.is_credit == False).with_entities(func.sum(Transaction.amount)).scalar() or 0.0

    savings_rate = ((income - expenses) / income * 100) if income > 0 else 0.0

    return {
        "total_balance": round(total_balance, 2),
        "income": round(income, 2),
        "expenses": round(expenses, 2),
        "net": round(income - expenses, 2),
        "savings_rate": round(savings_rate, 1),
    }


@router.get("/monthly")
def monthly(
    account_id: Optional[int] = None,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(
        extract("year", Transaction.date).label("year"),
        extract("month", Transaction.date).label("month"),
        func.sum(case((Transaction.is_credit == True, Transaction.amount), else_=0)).label("income"),
        func.sum(case((Transaction.is_credit == False, Transaction.amount), else_=0)).label("expenses"),
    )
    q = q.filter(Transaction.is_internal == False, Transaction.is_reversal == False)
    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    if year is not None:
        q = q.filter(extract("year", Transaction.date) == year)

    rows = q.group_by("year", "month").order_by("year", "month").all()

    return [
        {
            "month": f"{int(r.year):04d}-{int(r.month):02d}",
            "income": round(r.income or 0, 2),
            "expenses": round(r.expenses or 0, 2),
            "net": round((r.income or 0) - (r.expenses or 0), 2),
        }
        for r in rows
    ]


@router.get("/categories")
def by_category(
    account_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(
        Category.id,
        Category.name,
        Category.color,
        Category.icon,
        func.sum(Transaction.amount).label("total"),
    ).join(Transaction, Transaction.category_id == Category.id)
    q = q.filter(Transaction.is_credit == False, Transaction.is_internal == False, Transaction.is_reversal == False)
    q = _expense_filter(q, account_id, year, month)
    rows = q.group_by(Category.id).order_by(func.sum(Transaction.amount).desc()).all()

    return [
        {"id": r.id, "name": r.name, "color": r.color, "icon": r.icon, "total": round(r.total or 0, 2)}
        for r in rows
    ]


@router.get("/top-merchants")
def top_merchants(
    account_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    q = db.query(
        Transaction.counterparty,
        func.sum(Transaction.amount).label("total"),
        func.count(Transaction.id).label("count"),
    )
    q = q.filter(Transaction.is_credit == False, Transaction.is_internal == False, Transaction.is_reversal == False)
    q = q.filter(Transaction.counterparty != None)
    q = _expense_filter(q, account_id, year, month)
    rows = (
        q.group_by(Transaction.counterparty)
        .order_by(func.sum(Transaction.amount).desc())
        .limit(limit)
        .all()
    )

    return [
        {"name": r.counterparty, "total": round(r.total or 0, 2), "count": r.count}
        for r in rows
    ]


@router.get("/balance-history")
def balance_history(account_id: Optional[int] = None, db: Session = Depends(get_db)):
    """
    Return monthly closing balance for each account (or all combined).
    Reconstructed from opening balance + cumulative transactions.
    """
    accounts = db.query(Account).all()
    if account_id is not None:
        accounts = [a for a in accounts if a.id == account_id]

    result: dict[str, float] = {}

    for acct in accounts:
        txs = (
            db.query(Transaction)
            .filter(Transaction.account_id == acct.id)
            .order_by(Transaction.date, Transaction.id)
            .all()
        )
        balance = acct.opening_balance
        month_balance: dict[str, float] = {}

        for tx in txs:
            if tx.date is None:
                continue
            balance += tx.amount if tx.is_credit else -tx.amount
            month_key = f"{tx.date.year:04d}-{tx.date.month:02d}"
            month_balance[month_key] = round(balance, 2)

        for month, bal in month_balance.items():
            result[month] = round(result.get(month, 0) + bal, 2)

    return [{"month": m, "balance": b} for m, b in sorted(result.items())]


@router.get("/accounts")
def list_accounts(db: Session = Depends(get_db)):
    accounts = db.query(Account).all()
    return [
        {"id": a.id, "iban": a.iban, "name": a.name, "currency": a.currency, "closing_balance": round(a.closing_balance, 2)}
        for a in accounts
    ]


@router.put("/accounts/{account_id}")
def rename_account(account_id: int, body: dict, db: Session = Depends(get_db)):
    from fastapi import HTTPException
    acct = db.query(Account).filter(Account.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="Account not found")
    if "name" in body:
        acct.name = body["name"]
    db.commit()
    return {"id": acct.id, "name": acct.name}
