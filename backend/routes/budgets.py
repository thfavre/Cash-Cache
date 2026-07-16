from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator

from ..database import get_db
from ..models import Account, Budget, Category, Transaction

router = APIRouter(prefix="/budgets", tags=["budgets"])

PERIOD_TYPES = {"daily", "weekly", "monthly", "annual", "custom"}
TARGET_TYPES = {"category", "merchant"}


class BudgetCreate(BaseModel):
    name: Optional[str] = None
    amount_limit: float
    period_type: str
    period_days: Optional[int] = None
    start_date: date
    recurring: bool = True
    target_type: str
    category_ids: list[int] = []
    merchant_patterns: list[str] = []

    @field_validator("period_type")
    @classmethod
    def _check_period_type(cls, v):
        if v not in PERIOD_TYPES:
            raise ValueError(f"period_type must be one of {PERIOD_TYPES}")
        return v

    @field_validator("target_type")
    @classmethod
    def _check_target_type(cls, v):
        if v not in TARGET_TYPES:
            raise ValueError(f"target_type must be one of {TARGET_TYPES}")
        return v


class BudgetUpdate(BudgetCreate):
    pass


class BudgetOut(BaseModel):
    id: int
    name: Optional[str]
    amount_limit: float
    period_type: str
    period_days: Optional[int]
    start_date: date
    recurring: bool
    target_type: str
    category_ids: list[int]
    category_labels: list[str]
    merchant_patterns: list[str]
    period_start: date
    period_end: date
    spent: float
    percent: float
    projected_total: float
    projected_over: bool


class DailySpendPoint(BaseModel):
    date: date
    cumulative: float


class BudgetTransactionOut(BaseModel):
    id: int
    date: date
    description: Optional[str]
    counterparty: Optional[str]
    category_name: Optional[str]
    category_icon: Optional[str]
    amount: float


class HistoryPeriod(BaseModel):
    period_start: date
    period_end: date
    spent: float


class BudgetDetail(BaseModel):
    budget: BudgetOut
    daily_spend: list[DailySpendPoint]
    transactions: list[BudgetTransactionOut]
    history: list[HistoryPeriod]
    can_go_prev: bool
    can_go_next: bool


def _validate_targets(body: BudgetCreate):
    if body.target_type == "category":
        if len(body.category_ids) < 1:
            raise HTTPException(status_code=400, detail="category_ids must contain at least 1 category")
    else:
        if len(body.merchant_patterns) < 1:
            raise HTTPException(status_code=400, detail="merchant_patterns must contain at least 1 pattern")
    if body.period_type == "custom" and not body.period_days:
        raise HTTPException(status_code=400, detail="period_days is required when period_type is 'custom'")


def _check_duplicate(db: Session, body: BudgetCreate, exclude_id: Optional[int] = None):
    """Rejects creating/editing a budget into an exact duplicate of another one —
    same target, same period shape. Budgets that share a category/merchant but
    differ in period type, length, or recurrence are legitimate (e.g. a weekly
    grocery budget alongside a monthly one) and are left alone."""
    if body.target_type == "category":
        target_key = sorted(body.category_ids)
    else:
        target_key = sorted(p.strip().lower() for p in body.merchant_patterns)

    query = db.query(Budget).filter(
        Budget.target_type == body.target_type,
        Budget.period_type == body.period_type,
        Budget.recurring == body.recurring,
        Budget.period_days == body.period_days,
    )
    if exclude_id is not None:
        query = query.filter(Budget.id != exclude_id)

    for existing in query.all():
        existing_key = (
            sorted(existing.category_ids or [])
            if body.target_type == "category"
            else sorted(p.strip().lower() for p in (existing.merchant_patterns or []))
        )
        if existing_key == target_key:
            raise HTTPException(
                status_code=400,
                detail="Un budget identique existe déjà pour cette cible et cette période.",
            )


def _period_length_days(budget: Budget) -> int:
    if budget.period_type == "daily":
        return 1
    if budget.period_type == "weekly":
        return 7
    if budget.period_type == "annual":
        return 365
    if budget.period_type == "custom":
        return budget.period_days or 1
    return 30  # monthly is handled separately (calendar month), this is only a fallback


def compute_period(budget: Budget, on_date: date = None) -> tuple[date, date]:
    """Returns (period_start, period_end) inclusive, for the period containing on_date."""
    on_date = on_date or date.today()
    start = budget.start_date

    if not budget.recurring:
        if budget.period_type == "monthly":
            period_end = _safe_date(start.year, start.month + 1, start.day) - timedelta(days=1) \
                if start.month < 12 else _safe_date(start.year + 1, 1, start.day) - timedelta(days=1)
        elif budget.period_type == "annual":
            period_end = _safe_date(start.year + 1, start.month, start.day) - timedelta(days=1)
        else:
            period_end = start + timedelta(days=_period_length_days(budget) - 1)
        return start, period_end

    if budget.period_type == "monthly":
        # calendar month containing on_date — works for any date, past or future,
        # regardless of start_date: the category/merchant's spending history is
        # what matters, not when this budget row happened to be created.
        period_start = date(on_date.year, on_date.month, 1)
        period_end = _last_day_of_month(on_date.year, on_date.month)
        return period_start, period_end

    if budget.period_type == "annual":
        anniversary_year = on_date.year
        anchor = _safe_date(anniversary_year, start.month, start.day)
        if anchor > on_date:
            anchor = _safe_date(anniversary_year - 1, start.month, start.day)
        next_anchor = _safe_date(anchor.year + 1, start.month, start.day)
        return anchor, next_anchor - timedelta(days=1)

    # daily / weekly / custom: fixed-length windows anchored to start_date's phase,
    # rolled forward or backward — floor division handles dates before start_date too.
    length = _period_length_days(budget)
    days_since_start = (on_date - start).days
    periods_elapsed = days_since_start // length
    period_start = start + timedelta(days=periods_elapsed * length)
    period_end = period_start + timedelta(days=length - 1)
    return period_start, period_end


def _last_day_of_month(year: int, month: int) -> date:
    next_month = month + 1
    next_year = year
    if next_month > 12:
        next_month = 1
        next_year += 1
    return date(next_year, next_month, 1) - timedelta(days=1)


def _safe_date(year: int, month: int, day: int) -> date:
    try:
        return date(year, month, day)
    except ValueError:
        return _last_day_of_month(year, month)


def compute_history_periods(
    budget: Budget, count: int = 6, current: tuple[date, date] = None, floor_date: date = None
) -> list[tuple[date, date]]:
    """Returns up to `count` periods ending with (and including) `current` (defaults
    to today's period), oldest first. Stops once a period reaching back to
    `floor_date` (e.g. the earliest transaction ever) has been included, so an
    annual/weekly budget's "show all" doesn't manufacture decades of empty
    periods. A non-recurring budget only ever has its single fixed period."""
    current = current or compute_period(budget)
    if not budget.recurring:
        return [current]

    periods = [current]
    on_date = current[0] - timedelta(days=1)
    while len(periods) < count:
        if floor_date is not None and periods[-1][0] <= floor_date:
            break
        period = compute_period(budget, on_date)
        periods.append(period)
        on_date = period[0] - timedelta(days=1)

    periods.reverse()
    return periods


def _target_filter(budget: Budget):
    """Returns a SQLAlchemy filter expression matching this budget's target, or
    None if the budget has no valid target (nothing to match)."""
    if budget.target_type == "category":
        cat_ids = budget.category_ids or []
        if not cat_ids:
            return None
        return Transaction.category_id.in_(cat_ids)
    patterns = budget.merchant_patterns or []
    if not patterns:
        return None
    merchant_clauses = []
    for p in patterns:
        like = f"%{p}%"
        merchant_clauses.append(Transaction.counterparty.ilike(like))
        merchant_clauses.append(Transaction.description.ilike(like))
    return or_(*merchant_clauses)


def _period_base_filters(budget: Budget, period_start: date, period_end: date):
    """Common filters plus the target filter, or None if the budget has no valid target."""
    target = _target_filter(budget)
    if target is None:
        return None
    return [
        Transaction.is_credit == False,  # noqa: E712
        Transaction.is_internal == False,  # noqa: E712
        Transaction.is_reversal == False,  # noqa: E712
        Transaction.date >= period_start,
        Transaction.date <= period_end,
        # Deactivated accounts are hidden everywhere, including budget spend.
        Transaction.account.has(Account.is_active == True),
        target,
    ]


def _period_transactions(db: Session, budget: Budget, period_start: date, period_end: date):
    filters = _period_base_filters(budget, period_start, period_end)
    if filters is None:
        return []
    return db.query(Transaction).filter(*filters).order_by(Transaction.date.desc()).all()


def _spent_for_budget(db: Session, budget: Budget, period_start: date, period_end: date) -> float:
    filters = _period_base_filters(budget, period_start, period_end)
    if filters is None:
        return 0.0
    return round(db.query(func.sum(Transaction.amount)).filter(*filters).scalar() or 0.0, 2)


def _to_out(db: Session, b: Budget, period: tuple[date, date] = None) -> BudgetOut:
    period_start, period_end = period or compute_period(b)
    spent = _spent_for_budget(db, b, period_start, period_end)
    percent = round(min((spent / b.amount_limit * 100) if b.amount_limit > 0 else 0.0, 999), 1)

    today = date.today()
    clamped_today = min(max(today, period_start), period_end)
    elapsed_days = (clamped_today - period_start).days + 1
    total_days = (period_end - period_start).days + 1
    projected_total = round(spent / elapsed_days * total_days, 2) if elapsed_days > 0 else spent

    category_labels: list[str] = []
    if b.target_type == "category":
        for cid in (b.category_ids or []):
            cat = db.query(Category).filter(Category.id == cid).first()
            if cat:
                category_labels.append(f"{cat.icon} {cat.name}")

    return BudgetOut(
        id=b.id,
        name=b.name,
        amount_limit=b.amount_limit,
        period_type=b.period_type,
        period_days=b.period_days,
        start_date=b.start_date,
        recurring=b.recurring,
        target_type=b.target_type,
        category_ids=b.category_ids or [],
        category_labels=category_labels,
        merchant_patterns=b.merchant_patterns or [],
        period_start=period_start,
        period_end=period_end,
        spent=spent,
        percent=percent,
        projected_total=projected_total,
        projected_over=projected_total > b.amount_limit,
    )


@router.get("", response_model=list[BudgetOut])
def list_budgets(db: Session = Depends(get_db)):
    # start_date is only null for legacy rows that predate the startup backfill migration.
    budgets = db.query(Budget).filter(Budget.start_date.isnot(None)).all()
    return [_to_out(db, b) for b in budgets]


@router.get("/{budget_id}/detail", response_model=BudgetDetail)
def budget_detail(
    budget_id: int,
    on_date: Optional[date] = None,
    history_count: int = 6,
    db: Session = Depends(get_db),
):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget not found")

    history_count = max(1, min(history_count, 120))
    period_start, period_end = compute_period(b, on_date)
    transactions = _period_transactions(db, b, period_start, period_end)

    transactions_out = []
    for tx in transactions:
        cat = db.query(Category).filter(Category.id == tx.category_id).first() if tx.category_id else None
        transactions_out.append(BudgetTransactionOut(
            id=tx.id,
            date=tx.date,
            description=tx.description,
            counterparty=tx.counterparty,
            category_name=cat.name if cat else None,
            category_icon=cat.icon if cat else None,
            amount=tx.amount,
        ))

    today = date.today()
    chart_end = min(today, period_end)
    daily_totals: dict[date, float] = {}
    for tx in transactions:
        if tx.date <= chart_end:
            daily_totals[tx.date] = daily_totals.get(tx.date, 0.0) + tx.amount

    daily_spend = []
    running = 0.0
    d = period_start
    while d <= chart_end:
        running += daily_totals.get(d, 0.0)
        daily_spend.append(DailySpendPoint(date=d, cumulative=round(running, 2)))
        d += timedelta(days=1)

    earliest_tx_date = db.query(func.min(Transaction.date)).scalar()

    # History is always anchored to the real "now" period, not the one being
    # viewed via on_date — otherwise browsing back in time would keep chopping
    # off the more recent periods from the history chart. But make sure the
    # viewed period itself is always included, even if that means requesting
    # more periods than history_count — otherwise browsing further back than
    # the default window makes the viewed bar (and its highlight) vanish.
    effective_history_count = history_count
    if b.recurring:
        today_period_start, _ = compute_period(b)
        if period_start < today_period_start:
            steps_back = 1
            probe_date = today_period_start - timedelta(days=1)
            while steps_back < 500:
                probe_start, _ = compute_period(b, probe_date)
                if probe_start <= period_start:
                    break
                steps_back += 1
                probe_date = probe_start - timedelta(days=1)
            effective_history_count = max(history_count, steps_back + 1)

    history = [
        HistoryPeriod(period_start=ps, period_end=pe, spent=_spent_for_budget(db, b, ps, pe))
        for ps, pe in compute_history_periods(b, count=effective_history_count, floor_date=earliest_tx_date)
    ]

    return BudgetDetail(
        budget=_to_out(db, b, period=(period_start, period_end)),
        daily_spend=daily_spend,
        transactions=transactions_out,
        history=history,
        can_go_prev=b.recurring and (earliest_tx_date is None or period_start > earliest_tx_date),
        can_go_next=b.recurring and period_end < today,
    )


@router.post("", response_model=BudgetOut)
def create_budget(body: BudgetCreate, db: Session = Depends(get_db)):
    _validate_targets(body)
    _check_duplicate(db, body)
    b = Budget(
        name=body.name,
        amount_limit=body.amount_limit,
        period_type=body.period_type,
        period_days=body.period_days,
        start_date=body.start_date,
        recurring=body.recurring,
        target_type=body.target_type,
        category_ids=body.category_ids if body.target_type == "category" else [],
        merchant_patterns=body.merchant_patterns if body.target_type == "merchant" else [],
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return _to_out(db, b)


@router.put("/{budget_id}", response_model=BudgetOut)
def update_budget(budget_id: int, body: BudgetUpdate, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget not found")
    _validate_targets(body)
    _check_duplicate(db, body, exclude_id=budget_id)

    b.name = body.name
    b.amount_limit = body.amount_limit
    b.period_type = body.period_type
    b.period_days = body.period_days
    b.start_date = body.start_date
    b.recurring = body.recurring
    b.target_type = body.target_type
    b.category_ids = body.category_ids if body.target_type == "category" else []
    b.merchant_patterns = body.merchant_patterns if body.target_type == "merchant" else []

    db.commit()
    db.refresh(b)
    return _to_out(db, b)


@router.delete("/{budget_id}")
def delete_budget(budget_id: int, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget not found")
    db.delete(b)
    db.commit()
    return {"ok": True}
