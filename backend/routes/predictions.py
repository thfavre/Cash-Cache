from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from typing import Optional
from ..database import get_db
from ..models import Transaction, Category
from ..predictor import forecast

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("")
def predict(
    category_id: Optional[int] = None,
    account_id: Optional[int] = None,
    months: int = Query(3, ge=1, le=12),
    db: Session = Depends(get_db),
):
    """
    Return forecasted spending for the next N months.
    If category_id is given, forecast for that category only.
    Otherwise, forecast total expenses.
    """
    q = db.query(
        extract("year", Transaction.date).label("year"),
        extract("month", Transaction.date).label("month"),
        func.sum(Transaction.amount).label("total"),
    ).filter(
        Transaction.is_credit == False,
        Transaction.is_internal == False,
        Transaction.is_reversal == False,
    )

    if category_id is not None:
        q = q.filter(Transaction.category_id == category_id)
    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)

    rows = (
        q.group_by("year", "month")
        .order_by("year", "month")
        .all()
    )

    monthly_values = [
        (f"{int(r.year):04d}-{int(r.month):02d}", float(r.total or 0))
        for r in rows
    ]

    historical = [{"month": m, "actual": v} for m, v in monthly_values]
    forecasted = forecast(monthly_values, n_months=months)

    return {"historical": historical, "forecast": forecasted}


@router.get("/all-categories")
def predict_all_categories(
    months: int = Query(3, ge=1, le=12),
    db: Session = Depends(get_db),
):
    """Forecast next month spending per category."""
    categories = db.query(Category).all()
    result = []

    for cat in categories:
        if cat.name == "Non catégorisé":
            continue

        rows = (
            db.query(
                extract("year", Transaction.date).label("year"),
                extract("month", Transaction.date).label("month"),
                func.sum(Transaction.amount).label("total"),
            )
            .filter(
                Transaction.category_id == cat.id,
                Transaction.is_credit == False,
                Transaction.is_internal == False,
                Transaction.is_reversal == False,
            )
            .group_by("year", "month")
            .order_by("year", "month")
            .all()
        )

        if not rows:
            continue

        monthly_values = [
            (f"{int(r.year):04d}-{int(r.month):02d}", float(r.total or 0))
            for r in rows
        ]
        forecast_data = forecast(monthly_values, n_months=1)
        next_month_pred = forecast_data[0]["predicted"] if forecast_data else 0

        result.append({
            "category_id": cat.id,
            "category_name": cat.name,
            "category_color": cat.color,
            "category_icon": cat.icon,
            "next_month_predicted": next_month_pred,
            "avg_last_3": round(
                sum(v for _, v in monthly_values[-3:]) / min(3, len(monthly_values)), 2
            ),
        })

    result.sort(key=lambda x: x["next_month_predicted"], reverse=True)
    return result
