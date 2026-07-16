"""
Monte Carlo simulation engine.

Everything is expressed in today's purchasing power (real terms), so figures
stay directly comparable to the FIRE target and to today's expenses even at
50-year horizons:
  - Liquid balance  = starting_balance + monthly_net_cashflow (drawn from Normal distribution)
  - Portfolio value = previous_portfolio × (1 + monthly_real_rate) + monthly_contribution,
    where monthly_real_rate nets the annual return against inflation
    (nominal return minus inflation ≈ growth in actual purchasing power).

Scenarios can shift the mean income / mean expenses before sampling.

Returns percentile bands (p10 / p25 / p50 / p75 / p90) at each month.
"""
from __future__ import annotations

import datetime
from typing import Any

import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, case

from .forecast import forecast_series
from .models import Transaction, Account, Category


# ── Historical data helpers ───────────────────────────────────────────────────

def _monthly_cashflow_series(db: Session) -> tuple[list[float], list[float], list[float]]:
    """
    Return (net_cashflow_list, expenses_list, invested_list) for all
    non-internal, non-savings transactions, ordered from oldest to newest.

    `net` excludes the Investissements category from expenses, so it's the
    discretionary pool each month *before* deciding how much of it went to
    investing — `invested` is that latter amount, tracked separately.
    """
    savings_ids = [
        c.id for c in db.query(Category).filter(Category.is_savings == True).all()
    ]
    ignored_ids = [
        c.id for c in db.query(Category).filter(Category.is_ignored == True).all()
    ]
    exclude_ids = savings_ids + ignored_ids

    invest_cat = db.query(Category).filter(Category.name == "Investissements").first()
    invest_cat_id = invest_cat.id if invest_cat else None

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
            func.sum(
                case(
                    (
                        (Transaction.is_credit == False) & (Transaction.category_id == invest_cat_id),
                        Transaction.amount,
                    ),
                    else_=0,
                )
            ).label("invested"),
        )
        .filter(
            Transaction.is_internal == False,
            Transaction.is_reversal == False,
            # Deactivated accounts are hidden everywhere, including the
            # historical cashflow that drives the simulation.
            Transaction.account.has(Account.is_active == True),
        )
        .group_by("year", "month")
        .order_by("year", "month")
        .all()
    )

    net      = [float((r.income or 0) - (r.expenses or 0)) for r in q]
    expenses = [float(r.expenses or 0) for r in q]
    invested = [float(r.invested or 0) for r in q] if invest_cat_id is not None else [0.0] * len(q)
    return net, expenses, invested


def current_liquid_balance(db: Session) -> float:
    accounts = db.query(Account).filter(Account.is_active == True).all()
    return round(sum(a.closing_balance for a in accounts), 2)


def monthly_summary(db: Session, window_months: int | None) -> dict:
    """
    Historical averages over `window_months` (or all history if None):
    how much has been left over each month vs. how much was actually
    invested. `net` already excludes the Investissements category, so
    `leftover = avg(net) - avg(invested)` is the real historical average
    monthly growth of liquid balance.
    """
    net_history, _, invested_history = _monthly_cashflow_series(db)
    history_months_available = len(net_history)
    net_window      = net_history      if window_months is None else net_history[-window_months:]
    invested_window = invested_history if window_months is None else invested_history[-window_months:]
    avg_net      = float(np.mean(net_window)) if net_window else 0.0
    avg_invested = float(np.mean(invested_window)) if invested_window else 0.0
    return {
        "leftover_per_month":       round(avg_net - avg_invested, 2),
        "invested_per_month":       round(avg_invested, 2),
        "history_months_available": history_months_available,
    }


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
    contrib_mode: str = "manual",
    target_liquid: float | None = None,
    seed: int | None = None,
    fire_monthly_expenses: float | None = None,
) -> dict[str, Any]:
    """
    Run Monte Carlo simulation.

    Returns a dict with:
      - monthly: list of {month, balance_p10…p90, portfolio_p10…p90, networth_p10…p90}
      - fire_number: float
      - fire_months: {p10, p50, p90} (months from now, or null if not reached)
      - annual_expenses_median: float
    """
    # A shared seed lets a scenario-vs-baseline comparison isolate the scenario's
    # real effect: both calls then draw identical cashflow noise, so any diff
    # left over is only the scenario, not sampling luck. Without one, each call
    # produces genuinely different futures.
    rng = np.random.default_rng(seed)

    cashflow_history, expenses_history, _ = _monthly_cashflow_series(db)
    liquid_start = current_liquid_balance(db)

    # Need at least 3 months of history
    if len(cashflow_history) < 3:
        cashflow_history = [0.0] * 12
    if len(expenses_history) < 3:
        expenses_history = [1000.0] * 12

    # Trend/seasonality-aware expected cashflow for each future month (e.g. a
    # December spending spike or a slow income ramp), rather than a single
    # flat historical average applied forever.
    mu_path, sigma = forecast_series(cashflow_history, months)
    # Mean monthly expenses — used for realistic expense_reduction scenarios and inflation drag
    mean_expenses_hist = float(np.mean(expenses_history)) if expenses_history else 1000.0

    # Apply scenario deltas to mu, each starting at its own `start_month`
    # rather than uniformly from month 1 — `delta_path`/`contrib_path` are
    # per-month arrays so "starts at month X" is actually true, not just a
    # label.
    delta_path = np.zeros(months)
    recurring_portfolio_path = np.zeros(months)   # recurring_cashflow scenarios routed to investment
    contrib_path = np.full(months, monthly_contrib)
    one_time_events: dict[int, float] = {}             # month_offset -> amount delta (bank/liquid)
    one_time_events_portfolio: dict[int, float] = {}   # month_offset -> amount delta (investment)

    if scenarios:
        # contribution_change scenarios *overwrite* the tail of contrib_path
        # (rather than adding to it), so applying them out of chronological
        # order would let an earlier-starting change wipe out a later-starting
        # one just because it was added to the UI second. Apply them by
        # start_month ascending so each change always wins for its own
        # window, regardless of creation order.
        for sc in sorted(
            (s for s in scenarios if s.get("type") == "contribution_change"),
            key=lambda s: int(s.get("start_month", 1)),
        ):
            start_m = max(1, int(sc.get("start_month", 1)))
            start_idx = min(start_m - 1, months)
            contrib_path[start_idx:] = float(sc.get("amount", monthly_contrib))

        for sc in scenarios:
            sc_type = sc.get("type", "")
            start_m = max(1, int(sc.get("start_month", 1)))
            start_idx = min(start_m - 1, months)   # clamp: starts past the horizon never kicks in
            dur     = sc.get("duration_months")  # reserved for future use

            if sc_type == "expense_reduction":
                # percent_change: positive = spending increases (cashflow falls),
                # negative = spending decreases (cashflow rises).
                pct = float(sc.get("percent_change", 0)) / 100
                delta_path[start_idx:] -= mean_expenses_hist * pct
            elif sc_type == "recurring_cashflow":
                # A recurring amount (+ income / − expense) at an arbitrary
                # frequency, converted to its monthly-equivalent average and
                # smoothed across every month from start_month onward — same
                # mechanism as the other additive scenarios, just generalized
                # beyond "monthly".
                amount = float(sc.get("amount", 0))
                occurrences_per_month = {
                    "daily":   30.44,   # 365.25 / 12
                    "weekly":  4.348,   # 52.18  / 12
                    "monthly": 1.0,
                    "yearly":  1 / 12,
                }.get(sc.get("frequency", "monthly"), 1.0)
                monthly_equivalent = amount * occurrences_per_month
                if sc.get("target") == "investment":
                    recurring_portfolio_path[start_idx:] += monthly_equivalent
                else:
                    delta_path[start_idx:] += monthly_equivalent
            elif sc_type == "one_time_event":
                amount = float(sc.get("amount", 0))
                if sc.get("target") == "investment":
                    one_time_events_portfolio[start_m] = one_time_events_portfolio.get(start_m, 0) + amount
                else:
                    one_time_events[start_m] = one_time_events.get(start_m, 0) + amount
            # contribution_change already applied above, in chronological order

    effective_mu_path = np.array(mu_path) + delta_path   # (months,)

    # Net the nominal return against inflation so portfolio growth reflects
    # actual purchasing power. Cashflow history/forecast is already in
    # today's CHF, so it needs no separate inflation adjustment — applying one
    # on top (as a growing monthly "drag") would compound without bound and
    # force every long-horizon simulation into a runaway collapse regardless
    # of how healthy the underlying finances are.
    monthly_real_rate = (annual_rate - inflation_rate) / 12

    # Simulate
    # Shape: (n_simulations, months+1)
    balance_mat   = np.zeros((n_simulations, months + 1))
    portfolio_mat = np.zeros((n_simulations, months + 1))

    balance_mat[:, 0]   = liquid_start
    portfolio_mat[:, 0] = portfolio_start

    # Draw all random cashflows at once: (n_sims, months), one mean per month
    draws = rng.normal(effective_mu_path, sigma, size=(n_simulations, months))

    for m in range(1, months + 1):
        cf = draws[:, m - 1]

        # one-time event
        if m in one_time_events:
            cf = cf + one_time_events[m]

        if contrib_mode == "auto" and target_liquid is not None:
            # Let the balance grow toward the target untouched; once above
            # it, sweep everything in excess into the portfolio each month.
            # (contribution_change scenarios have no effect here since
            # there's no fixed contribution to change.)
            prospective_balance = balance_mat[:, m - 1] + cf
            sweep = np.clip(prospective_balance - target_liquid, 0, None)
            balance_mat[:, m]   = prospective_balance - sweep
            portfolio_mat[:, m] = portfolio_mat[:, m - 1] * (1 + monthly_real_rate) + sweep
        else:
            # monthly_contrib is a standing transfer: it must leave the liquid
            # balance the same way it enters the portfolio, otherwise investing
            # looks free and net worth grows too fast.
            contrib = contrib_path[m - 1]
            balance_mat[:, m]   = balance_mat[:, m - 1] + cf - contrib
            portfolio_mat[:, m] = portfolio_mat[:, m - 1] * (1 + monthly_real_rate) + contrib

        portfolio_mat[:, m] = portfolio_mat[:, m] + recurring_portfolio_path[m - 1]

        if m in one_time_events_portfolio:
            portfolio_mat[:, m] = portfolio_mat[:, m] + one_time_events_portfolio[m]

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
    # Use last 12 months of expenses history, unless the user overrides the
    # target monthly expense to plan for (e.g. a different lifestyle in FIRE).
    if fire_monthly_expenses is not None:
        annual_expenses_median = fire_monthly_expenses * 12
    else:
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

    # % of simulated futures still solvent (liquid balance ≥ 0) at the horizon's end
    pct_solvent_final = round(float((balance_mat[:, -1] >= 0).mean() * 100), 1)

    return {
        "monthly":               monthly_out,
        "fire_number":           fire_number,
        "fire_months":           fire_pcts,
        "pct_simulations_fire":  pct_fire_reached,
        "annual_expenses_median": round(annual_expenses_median, 0),
        "starting_liquid":       liquid_start,
        "starting_portfolio":    portfolio_start,
        "mu_monthly_cashflow":   round(float(np.mean(effective_mu_path)), 2),
        "sigma_monthly_cashflow": round(sigma, 2),
        "pct_solvent_final":     pct_solvent_final,
    }
