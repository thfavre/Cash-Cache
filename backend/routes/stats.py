from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, case
from typing import Optional
import datetime
import re
from ..database import get_db
from ..models import Transaction, Account, Category

router = APIRouter(prefix="/stats", tags=["stats"])


def clean_merchant_name(raw_desc: str, cat_name: str) -> str:
    if not raw_desc:
        return cat_name
    lines = [l.strip() for l in raw_desc.split("\n") if l.strip()]
    s = lines[0] if lines else raw_desc.strip()

    s = re.sub(r'^(?:Achat|Transfert|Paiement)?\s*(?:TWINT|online|par carte|POS|card)?\s*[,:-]?\s*', '', s, flags=re.IGNORECASE).strip()
    s = re.sub(r'^[àa]\s+', '', s, flags=re.IGNORECASE).strip()
    s = re.sub(r'\s*\d{2}\.\d{2}\.\d{4}.*$', '', s).strip()

    s_upper = s.upper()

    if any(k in s_upper for k in ["SBB", "CFF", "FFS", "PERSONENVERKEHR"]):
        return "Trains CFF / SBB"
    if any(k in s_upper for k in ["COOP"]):
        return "Coop"
    if any(k in s_upper for k in ["MIGROS"]):
        return "Migros"
    if any(k in s_upper for k in ["LIDL"]):
        return "Lidl"
    if any(k in s_upper for k in ["MANOR"]):
        return "Manor"
    if any(k in s_upper for k in ["DIGITEC", "GALAXUS"]):
        return "Digitec Galaxus"
    if any(k in s_upper for k in ["BOOKING"]):
        return "Booking.com"
    if any(k in s_upper for k in ["SALT"]):
        return "Salt Mobile"
    if any(k in s_upper for k in ["INFOMANIAK"]):
        return "Infomaniak"
    if any(k in s_upper for k in ["ASSURA"]):
        return "Assura Assurance"
    if any(k in s_upper for k in ["AXA"]):
        return "AXA Assurance"
    if any(k in s_upper for k in ["INTERACTIVE BROKERS", "IBKR"]):
        return "Interactive Brokers"
    if any(k in s_upper for k in ["UBER"]):
        return "Uber / VTC"
    if any(k in s_upper for k in ["MCDONALD"]):
        return "McDonald's"
    if any(k in s_upper for k in ["PHARMACIE", "SUN STORE", "AMAVITA"]):
        return "Pharmacie"

    if len(s) > 24:
        s = s[:24] + "..."
    return s if not s.isupper() else s.title()


def _period_bounds(period, year=None, month=None):
    """Return (start_date, end_date) inclusive for a named period, or None for no bound."""
    today = datetime.date.today()
    if period == "current_month":
        return today.replace(day=1), today
    if period == "last_month":
        first_this = today.replace(day=1)
        end = first_this - datetime.timedelta(days=1)
        return end.replace(day=1), end
    if period == "last_3_months":
        return today - datetime.timedelta(days=90), today
    if period == "last_6_months":
        return today - datetime.timedelta(days=180), today
    if period == "current_year":
        return today.replace(month=1, day=1), today
    if period == "last_year":
        return datetime.date(today.year - 1, 1, 1), datetime.date(today.year - 1, 12, 31)
    if period == "all":
        return None
    if year is not None:
        if month is not None:
            start = datetime.date(year, month, 1)
            end_month = month + 1 if month < 12 else 1
            end_year = year if month < 12 else year + 1
            return start, datetime.date(end_year, end_month, 1) - datetime.timedelta(days=1)
        return datetime.date(year, 1, 1), datetime.date(year, 12, 31)
    return None


def _apply_period_filter(q, period, year, month):
    bounds = _period_bounds(period, year, month)
    if bounds is not None:
        start, end = bounds
        q = q.filter(Transaction.date >= start, Transaction.date <= end)
    return q


def _expense_filter(q, account_id, year, month, exclude_internal=True, period=None):
    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    q = _apply_period_filter(q, period, year, month)
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
    expenses_raw = base.filter(Transaction.is_credit == False).with_entities(func.sum(Transaction.amount)).scalar() or 0.0

    # Exclude categories marked as savings from expenses so they count as savings
    savings_cats = db.query(Category).filter(Category.is_savings == True).all()
    savings_cat_ids = [c.id for c in savings_cats]
    invest_amount = 0.0
    if savings_cat_ids:
        invest_amount = base.filter(
            Transaction.is_credit == False,
            Transaction.category_id.in_(savings_cat_ids)
        ).with_entities(func.sum(Transaction.amount)).scalar() or 0.0

    expenses = expenses_raw - invest_amount
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
    period: Optional[str] = None,
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
    q = _expense_filter(q, account_id, year, month, period=period)
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
def balance_history(
    account_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    period: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Return monthly closing balance for each account (or all combined).
    Reconstructed from opening balance + cumulative transactions, then
    truncated to the requested date range (the running balance itself is
    still computed from the full history so it stays accurate).
    """
    accounts = db.query(Account).all()
    if account_id is not None:
        accounts = [a for a in accounts if a.id == account_id]

    bounds = _period_bounds(period, year, month)

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

        for month_key, bal in month_balance.items():
            result[month_key] = round(result.get(month_key, 0) + bal, 2)

    if bounds is not None:
        start, end = bounds
        start_key = f"{start.year:04d}-{start.month:02d}"
        end_key = f"{end.year:04d}-{end.month:02d}"
        result = {m: b for m, b in result.items() if start_key <= m <= end_key}

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


@router.get("/cashflow")
def get_cashflow(
    account_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    period: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Transaction).filter(
        Transaction.is_internal == False,
        Transaction.is_reversal == False
    )

    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)

    q = _apply_period_filter(q, period, year, month)

    txs = q.all()

    inflows = {}
    outflows = {}
    total_income = 0.0
    total_expenses = 0.0
    monthly_map = {}

    for t in txs:
        amt = float(t.amount or 0.0)
        m_key = f"{t.date.year:04d}-{t.date.month:02d}" if t.date else "Inconnu"
        if m_key not in monthly_map:
            monthly_map[m_key] = {"month": m_key, "income": 0.0, "expenses": 0.0}

        if t.is_credit:
            total_income += amt
            monthly_map[m_key]["income"] += amt
            cat_id = t.category_id
            cat_name = t.category.name if t.category else "Revenus divers"
            cat_color = t.category.color if t.category else "#10B981"
            cat_icon = t.category.icon if t.category else "💰"
            if cat_name == "Non catégorisé":
                cat_name = "Virements & Divers"
            if cat_name not in inflows:
                inflows[cat_name] = {"id": cat_id, "name": cat_name, "amount": 0.0, "color": cat_color, "icon": cat_icon, "tx_count": 0}
            inflows[cat_name]["amount"] += amt
            inflows[cat_name]["tx_count"] += 1
        else:
            cat_id = t.category_id or 0
            cat_name = t.category.name if t.category else "Non catégorisé"
            cat_color = t.category.color if t.category else "#64748B"
            cat_icon = t.category.icon if t.category else "📦"

            # Exclude categories marked as savings from expenses so they count as savings
            is_savings_cat = t.category.is_savings if t.category else False
            if not is_savings_cat:
                total_expenses += amt
                monthly_map[m_key]["expenses"] += amt

            if cat_name not in outflows:
                outflows[cat_name] = {
                    "id": cat_id,
                    "name": cat_name,
                    "amount": 0.0,
                    "color": cat_color,
                    "icon": cat_icon,
                    "tx_count": 0,
                    "_subitems": {}
                }
            outflows[cat_name]["amount"] += amt
            outflows[cat_name]["tx_count"] += 1
            sub_name = clean_merchant_name(t.counterparty or t.description or "Divers", cat_name)
            sub_map = outflows[cat_name]["_subitems"]
            sub_map[sub_name] = sub_map.get(sub_name, 0.0) + amt

    inflows_list = sorted(inflows.values(), key=lambda x: x["amount"], reverse=True)
    outflows_list = sorted(outflows.values(), key=lambda x: x["amount"], reverse=True)
    monthly_trend = sorted(monthly_map.values(), key=lambda x: x["month"])

    for item in inflows_list:
        item["amount"] = round(item["amount"], 2)
        item["percentage"] = round((item["amount"] / total_income * 100) if total_income > 0 else 0.0, 1)

    for item in outflows_list:
        item["amount"] = round(item["amount"], 2)
        item["percentage_of_expenses"] = round((item["amount"] / total_expenses * 100) if total_expenses > 0 else 0.0, 1)
        item["percentage_of_income"] = round((item["amount"] / total_income * 100) if total_income > 0 else 0.0, 1)
        item["avg_ticket"] = round(item["amount"] / item["tx_count"], 2) if item["tx_count"] > 0 else 0.0

        sub_dict = item.pop("_subitems", {})
        sorted_subs = sorted(sub_dict.items(), key=lambda x: x[1], reverse=True)
        top_subs = []
        other_amt = 0.0
        other_detail = []
        for i, (s_name, s_amt) in enumerate(sorted_subs):
            if i < 4 and s_amt > 1.0 and (len(sorted_subs) <= 5 or i < 4):
                top_subs.append({"name": s_name, "amount": round(s_amt, 2)})
            else:
                other_amt += s_amt
                other_detail.append({"name": s_name, "amount": round(s_amt, 2)})
        if other_amt > 1.0:
            other_detail.sort(key=lambda x: x["amount"], reverse=True)
            top_subs.append({
                "name": f"Autres {item['name']}",
                "amount": round(other_amt, 2),
                "detail": other_detail,
            })
        item["subitems"] = top_subs

    for m in monthly_trend:
        m["income"] = round(m["income"], 2)
        m["expenses"] = round(m["expenses"], 2)
        m["net"] = round(m["income"] - m["expenses"], 2)

    net_savings = round(total_income - total_expenses, 2)
    savings_rate = round((net_savings / total_income * 100) if total_income > 0 else 0.0, 1)

    return {
        "summary": {
            "income": round(total_income, 2),
            "expenses": round(total_expenses, 2),
            "net_savings": net_savings,
            "savings_rate": savings_rate,
            "tx_count": len(txs)
        },
        "inflows": inflows_list,
        "outflows": outflows_list,
        "monthly_trend": monthly_trend
    }

