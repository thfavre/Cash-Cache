"""
Monte Carlo simulation engine.

Simulates `n_simulations` random futures for the user's net worth:
  - Liquid balance  = starting_balance + monthly_net_cashflow (drawn from Normal distribution)
  - Portfolio value = previous_portfolio × (1 + monthly_rate) + monthly_contribution
  - Expenses are inflated each month

Scenarios can shift the mean income / mean expenses before sampling.

Returns percentile bands (p10 / p25 / p50 / p75 / p90) at each month.
"""
from __future__ import annotations

import datetime
from typing import Any

import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, case

from .models import Transaction, Account, Category


# ── Historical data helpers ───────────────────────────────────────────────────

def _monthly_cashflow_series(db: Session) -> tuple[list[float], list[float]]:
    """
    Return (net_cashflow_list, expenses_list) for all non-internal,
    non-savings transactions, ordered from oldest to newest.
    """
    savings_ids = [
        c.id for c in db.query(Category).filter(Category.is_savings == True).all()
    ]
    ignored_ids = [
        c.id for c in db.query(Category).filter(Category.is_ignored == True).all()
    ]
    exclude_ids = savings_ids + ignored_ids

    q = (
        db.query(
            extract("year", Transaction.date).label("year"),
            extract("month", Transaction.date).label("month"),
            func.sum(
                case((Transaction.is_credit == True, Transaction.amount), else_=0)
            ).label("income"),
            func.sum(
                case(
                    (
                        (Transaction.is_credit == False)
                        & (~Transaction.category_id.in_(exclude_ids) if exclude_ids else True),
                        Transaction.amount,
                    ),
                    else_=0,
                )
            ).label("expenses"),
        )
        .filter(
            Transaction.is_internal == False,
            Transaction.is_reversal == False,
        )
        .group_by("year", "month")
        .order_by("year", "month")
        .all()
    )

    net     = [float((r.income or 0) - (r.expenses or 0)) for r in q]
    expenses = [float(r.expenses or 0) for r in q]
    return net, expenses


def _current_liquid_balance(db: Session) -> float:
    accounts = db.query(Account).all()
    return round(sum(a.closing_balance for a in accounts), 2)


# ── Simulation ────────────────────────────────────────────────────────────────

def simulate(
    db: Session,
    months: int,
    portfolio_start: float,
    monthly_contrib: float,
    annual_rate: float,
    inflation_rate: float,
    n_simulations: int = 1000,
    scenarios: list[dict] | None = None,
) -> dict[str, Any]:
    """
    Run Monte Carlo simulation.

    Returns a dict with:
      - monthly: list of {month, balance_p10…p90, portfolio_p10…p90, networth_p10…p90}
      - fire_number: float
      - fire_months: {p10, p50, p90} (months from now, or null if not reached)
      - annual_expenses_median: float
    """
    rng = np.random.default_rng()  # no fixed seed — each call produces genuinely different futures

    cashflow_history, expenses_history = _monthly_cashflow_series(db)
    liquid_start = _current_liquid_balance(db)

    # Need at least 3 months of history
    if len(cashflow_history) < 3:
        cashflow_history = [0.0] * 12
    if len(expenses_history) < 3:
        expenses_history = [1000.0] * 12

    mu    = float(np.mean(cashflow_history))
    sigma = float(np.std(cashflow_history)) if len(cashflow_history) > 1 else abs(mu) * 0.2
    # Mean monthly expenses — used for realistic expense_reduction scenarios and inflation drag
    mean_expenses_hist = float(np.mean(expenses_history)) if expenses_history else 1000.0

    # Apply scenario deltas to mu.
    # `scenario_delta` is always a positive-means-more-cashflow quantity.
    scenario_delta = 0.0
    one_time_events: dict[int, float] = {}   # month_offset -> amount delta

    if scenarios:
        for sc in scenarios:
            sc_type = sc.get("type", "")
            start_m = int(sc.get("start_month", 1))
            dur     = sc.get("duration_months")  # reserved for future use

            if sc_type == "expense_reduction":
                pct = float(sc.get("percent_change", 0)) / 100
                # Spending falls → net cashflow rises by mean_expenses × pct
                scenario_delta += mean_expenses_hist * pct
            elif sc_type == "income_increase":
                scenario_delta += float(sc.get("amount", 0))
            elif sc_type == "one_time_event":
                one_time_events[start_m] = one_time_events.get(start_m, 0) + float(sc.get("amount", 0))
            elif sc_type == "contribution_change":
                monthly_contrib = float(sc.get("amount", monthly_contrib))

    effective_mu = mu + scenario_delta

    monthly_rate    = annual_rate / 12
    monthly_inflate = inflation_rate / 12

    # Simulate
    # Shape: (n_simulations, months+1)
    balance_mat   = np.zeros((n_simulations, months + 1))
    portfolio_mat = np.zeros((n_simulations, months + 1))

    balance_mat[:, 0]   = liquid_start
    portfolio_mat[:, 0] = portfolio_start

    # Draw all random cashflows at once: (n_sims, months)
    draws = rng.normal(effective_mu, sigma, size=(n_simulations, months))

    for m in range(1, months + 1):
        cf = draws[:, m - 1]

        # one-time event
        if m in one_time_events:
            cf = cf + one_time_events[m]

        # Inflation only erodes the expense side; income is assumed to grow with
        # inflation (wage indexation). The drag = mean_expenses × ((1+r)^m − 1),
        # i.e. the extra cost compared to today due to price growth.
        inflation_drag = mean_expenses_hist * ((1 + monthly_inflate) ** m - 1)
        cf_real = cf - inflation_drag

        balance_mat[:, m]   = balance_mat[:, m - 1] + cf_real
        portfolio_mat[:, m] = portfolio_mat[:, m - 1] * (1 + monthly_rate) + monthly_contrib

    networth_mat = balance_mat + portfolio_mat

    # Percentile bands
    pcts = [10, 25, 50, 75, 90]

    today = datetime.date.today()

    def _month_label(offset: int) -> str:
        y = today.year + (today.month - 1 + offset) // 12
        mo = (today.month - 1 + offset) % 12 + 1
        return f"{y:04d}-{mo:02d}"

    monthly_out = []
    for m in range(months + 1):
        bal_pcts = np.percentile(balance_mat[:, m], pcts)
        por_pcts = np.percentile(portfolio_mat[:, m], pcts)
        nw_pcts  = np.percentile(networth_mat[:, m], pcts)
        monthly_out.append({
            "month":           _month_label(m),
            "balance_p10":     round(float(bal_pcts[0]), 0),
            "balance_p25":     round(float(bal_pcts[1]), 0),
            "balance_p50":     round(float(bal_pcts[2]), 0),
            "balance_p75":     round(float(bal_pcts[3]), 0),
            "balance_p90":     round(float(bal_pcts[4]), 0),
            "portfolio_p10":   round(float(por_pcts[0]), 0),
            "portfolio_p25":   round(float(por_pcts[1]), 0),
            "portfolio_p50":   round(float(por_pcts[2]), 0),
            "portfolio_p75":   round(float(por_pcts[3]), 0),
            "portfolio_p90":   round(float(por_pcts[4]), 0),
            "networth_p10":    round(float(nw_pcts[0]), 0),
            "networth_p25":    round(float(nw_pcts[1]), 0),
            "networth_p50":    round(float(nw_pcts[2]), 0),
            "networth_p75":    round(float(nw_pcts[3]), 0),
            "networth_p90":    round(float(nw_pcts[4]), 0),
        })

    # FIRE number = 25 × annual expenses (4% rule)
    # Use last 12 months of expenses history
    recent_exp = expenses_history[-12:] if len(expenses_history) >= 12 else expenses_history
    annual_expenses_median = float(np.median(recent_exp)) * 12 if recent_exp else 12000.0
    fire_number = round(annual_expenses_median * 25, 0)

    # FIRE date: vectorised — avoid O(n_sims × months) Python loop
    reached      = portfolio_mat >= fire_number          # (n_sims, months+1) bool
    any_reached  = reached.any(axis=1)                   # (n_sims,) bool
    first_month  = np.where(any_reached, np.argmax(reached, axis=1), -1)
    fire_reached_arr = first_month[first_month >= 0]     # only sims that hit FIRE

    fire_pcts: dict[str, int | None] = {"p10": None, "p50": None, "p90": None}
    if len(fire_reached_arr) > 0:
        # p10 = reached early (optimistic), p90 = reached late (pessimistic)
        fire_pcts = {
            "p10": int(np.percentile(fire_reached_arr, 10)),
            "p50": int(np.percentile(fire_reached_arr, 50)),
            "p90": int(np.percentile(fire_reached_arr, 90)),
        }

    pct_fire_reached = round(len(fire_reached_arr) / n_simulations * 100, 1)

    return {
        "monthly":               monthly_out,
        "fire_number":           fire_number,
        "fire_months":           fire_pcts,
        "pct_simulations_fire":  pct_fire_reached,
        "annual_expenses_median": round(annual_expenses_median, 0),
        "starting_liquid":       liquid_start,
        "starting_portfolio":    portfolio_start,
        "mu_monthly_cashflow":   round(effective_mu, 2),
        "sigma_monthly_cashflow": round(sigma, 2),
    }
