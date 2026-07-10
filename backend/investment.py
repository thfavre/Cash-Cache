"""
Investment engine.

Reconstructs the estimated current portfolio value by compounding every
transaction in the 'Investissements' category forward to today at the
configured annual return rate.  All editable parameters (rate, inflation,
monthly_contribution, manual portfolio override) are persisted in the
existing `settings` table.
"""
from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy.orm import Session

from .models import Transaction, Category, Setting

# ── Setting keys ──────────────────────────────────────────────────────────────
KEY_ANNUAL_RATE      = "invest_annual_rate"        # float  e.g. 0.07
KEY_INFLATION_RATE   = "invest_inflation_rate"     # float  e.g. 0.02
KEY_MANUAL_PORTFOLIO = "invest_manual_portfolio"   # float | null
KEY_MONTHLY_CONTRIB  = "invest_monthly_contrib"    # float | null  (null = auto)

DEFAULTS = {
    KEY_ANNUAL_RATE:      0.07,
    KEY_INFLATION_RATE:   0.02,
    KEY_MANUAL_PORTFOLIO: None,
    KEY_MONTHLY_CONTRIB:  None,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get(db: Session, key: str):
    row = db.query(Setting).filter(Setting.key == key).first()
    return row.value if row else DEFAULTS[key]


def _set(db: Session, key: str, value) -> None:
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))
    db.commit()


# ── Investment category lookup ────────────────────────────────────────────────

def _invest_category_id(db: Session) -> Optional[int]:
    cat = db.query(Category).filter(Category.name == "Investissements").first()
    return cat.id if cat else None


# ── Core calculation ──────────────────────────────────────────────────────────

def compute_auto_portfolio(db: Session, annual_rate: float) -> float:
    """
    Sum all outgoing 'Investissements' transactions, each compounded forward
    to today at `annual_rate`.  Returns estimated portfolio value today.
    """
    cat_id = _invest_category_id(db)
    if cat_id is None:
        return 0.0

    today = datetime.date.today()
    monthly_rate = annual_rate / 12

    txs = (
        db.query(Transaction)
        .filter(
            Transaction.category_id == cat_id,
            Transaction.is_credit == False,
            Transaction.is_reversal == False,
        )
        .order_by(Transaction.date)
        .all()
    )

    total = 0.0
    for tx in txs:
        if tx.date is None:
            continue
        # months elapsed since this transaction
        months = (
            (today.year - tx.date.year) * 12
            + (today.month - tx.date.month)
        )
        if months < 0:
            months = 0
        compounded = float(tx.amount) * ((1 + monthly_rate) ** months)
        total += compounded

    return round(total, 2)


def avg_monthly_contribution(db: Session, n_months: int = 6) -> float:
    """
    Average monthly investment outflow over the last `n_months` months.
    Used as the default monthly_contribution when none is set manually.
    """
    cat_id = _invest_category_id(db)
    if cat_id is None:
        return 0.0

    today = datetime.date.today()
    # Proper calendar-month subtraction (avoids the "30 days per month" approximation)
    cutoff_month = today.month - n_months
    cutoff_year  = today.year
    while cutoff_month <= 0:
        cutoff_month += 12
        cutoff_year  -= 1
    cutoff = datetime.date(cutoff_year, cutoff_month, 1)

    txs = (
        db.query(Transaction)
        .filter(
            Transaction.category_id == cat_id,
            Transaction.is_credit == False,
            Transaction.is_reversal == False,
            Transaction.date >= cutoff,
        )
        .all()
    )

    if not txs:
        return 0.0

    total = sum(float(t.amount) for t in txs)
    return round(total / n_months, 2)


# ── Public API ────────────────────────────────────────────────────────────────

def get_investment_settings(db: Session) -> dict:
    annual_rate      = _get(db, KEY_ANNUAL_RATE)
    inflation_rate   = _get(db, KEY_INFLATION_RATE)
    manual_portfolio = _get(db, KEY_MANUAL_PORTFOLIO)
    monthly_contrib  = _get(db, KEY_MONTHLY_CONTRIB)

    auto_portfolio = compute_auto_portfolio(db, annual_rate)
    auto_contrib   = avg_monthly_contribution(db)

    return {
        "annual_rate":           annual_rate,
        "inflation_rate":        inflation_rate,
        "manual_portfolio":      manual_portfolio,
        "auto_portfolio":        auto_portfolio,
        # effective value the simulation will use
        "effective_portfolio":   manual_portfolio if manual_portfolio is not None else auto_portfolio,
        "monthly_contrib":       monthly_contrib,
        "auto_monthly_contrib":  auto_contrib,
        "effective_contrib":     monthly_contrib if monthly_contrib is not None else auto_contrib,
    }


def save_investment_settings(
    db: Session,
    annual_rate: Optional[float] = None,
    inflation_rate: Optional[float] = None,
    manual_portfolio: Optional[float] = None,   # pass -1 to clear
    monthly_contrib: Optional[float] = None,    # pass -1 to clear
) -> dict:
    if annual_rate is not None:
        _set(db, KEY_ANNUAL_RATE, annual_rate)
    if inflation_rate is not None:
        _set(db, KEY_INFLATION_RATE, inflation_rate)
    if manual_portfolio is not None:
        _set(db, KEY_MANUAL_PORTFOLIO, None if manual_portfolio < 0 else manual_portfolio)
    if monthly_contrib is not None:
        _set(db, KEY_MONTHLY_CONTRIB, None if monthly_contrib < 0 else monthly_contrib)

    return get_investment_settings(db)
