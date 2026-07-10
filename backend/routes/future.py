"""
Future & Investments API routes.

GET  /future/investment-settings      — current settings + auto-computed values
PUT  /future/investment-settings      — save overrides
POST /future/simulate                 — run Monte Carlo, return percentile bands
GET  /future/fire                     — quick FIRE summary (uses stored settings)
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..investment import get_investment_settings, save_investment_settings
from ..montecarlo import simulate

router = APIRouter(prefix="/future", tags=["future"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class InvestmentSettingsBody(BaseModel):
    annual_rate:      Optional[float] = None
    inflation_rate:   Optional[float] = None
    manual_portfolio: Optional[float] = None   # -1 clears manual override
    monthly_contrib:  Optional[float] = None   # -1 uses auto average


class ScenarioItem(BaseModel):
    type: str                           # expense_reduction | income_increase | one_time_event | contribution_change
    category: Optional[str] = None
    percent_change: Optional[float] = None
    amount: Optional[float] = None
    start_month: int = 1
    duration_months: Optional[int] = None


class SimulateBody(BaseModel):
    months: int = 120                   # 10 years default
    n_simulations: int = 1000
    scenarios: list[ScenarioItem] = []
    # allow per-request overrides (so sliders update without writing to DB)
    annual_rate:      Optional[float] = None
    inflation_rate:   Optional[float] = None
    portfolio_value:  Optional[float] = None
    monthly_contrib:  Optional[float] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/investment-settings")
def get_settings(db: Session = Depends(get_db)):
    """Return current investment parameters and auto-computed portfolio estimate."""
    return get_investment_settings(db)


@router.put("/investment-settings")
def update_settings(body: InvestmentSettingsBody, db: Session = Depends(get_db)):
    """Persist investment parameter overrides."""
    return save_investment_settings(
        db,
        annual_rate      = body.annual_rate,
        inflation_rate   = body.inflation_rate,
        manual_portfolio = body.manual_portfolio,
        monthly_contrib  = body.monthly_contrib,
    )


@router.post("/simulate")
def run_simulation(body: SimulateBody, db: Session = Depends(get_db)):
    """
    Run Monte Carlo simulation.
    Per-request overrides (sliders) take priority over stored settings.
    """
    settings = get_investment_settings(db)

    annual_rate     = body.annual_rate     if body.annual_rate     is not None else settings["annual_rate"]
    inflation_rate  = body.inflation_rate  if body.inflation_rate  is not None else settings["inflation_rate"]
    portfolio_value = body.portfolio_value if body.portfolio_value is not None else settings["effective_portfolio"]
    monthly_contrib = body.monthly_contrib if body.monthly_contrib is not None else settings["effective_contrib"]

    months = min(max(body.months, 6), 600)  # cap at 50 years

    scenarios_dicts = [s.model_dump() for s in body.scenarios]

    result = simulate(
        db             = db,
        months         = months,
        portfolio_start= portfolio_value,
        monthly_contrib= monthly_contrib,
        annual_rate    = annual_rate,
        inflation_rate = inflation_rate,
        n_simulations  = min(body.n_simulations, 2000),
        scenarios      = scenarios_dicts if scenarios_dicts else None,
    )

    return result


@router.get("/fire")
def fire_summary(db: Session = Depends(get_db)):
    """Quick FIRE summary using stored settings, 30-year horizon."""
    settings = get_investment_settings(db)

    result = simulate(
        db              = db,
        months          = 360,
        portfolio_start = settings["effective_portfolio"],
        monthly_contrib = settings["effective_contrib"],
        annual_rate     = settings["annual_rate"],
        inflation_rate  = settings["inflation_rate"],
        n_simulations   = 1000,
    )

    return {
        "fire_number":            result["fire_number"],
        "fire_months":            result["fire_months"],
        "pct_simulations_fire":   result["pct_simulations_fire"],
        "annual_expenses_median": result["annual_expenses_median"],
    }
