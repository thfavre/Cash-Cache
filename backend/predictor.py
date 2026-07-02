"""
Forecasting module: predicts next N months of spending per category.
Uses exponential smoothing (statsmodels) with a linear trend fallback.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

try:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    HAS_STATSMODELS = True
except ImportError:
    HAS_STATSMODELS = False


def _next_months(last_date: date, n: int) -> list[str]:
    """Return n month strings (YYYY-MM) following last_date."""
    year, month = last_date.year, last_date.month
    result = []
    for _ in range(n):
        month += 1
        if month > 12:
            month = 1
            year += 1
        result.append(f"{year:04d}-{month:02d}")
    return result


def forecast(monthly_values: list[tuple[str, float]], n_months: int = 3) -> list[dict]:
    """
    monthly_values: list of (YYYY-MM, amount) sorted ascending.
    Returns list of {month, predicted, lower, upper}.
    """
    if not monthly_values:
        return []

    months, values = zip(*monthly_values)
    values = np.array(values, dtype=float)
    last_date = date(int(months[-1][:4]), int(months[-1][5:7]), 1)
    future_months = _next_months(last_date, n_months)

    if len(values) < 2:
        pred = float(values[0])
        return [{"month": m, "predicted": round(pred, 2), "lower": round(pred * 0.8, 2), "upper": round(pred * 1.2, 2)} for m in future_months]

    if HAS_STATSMODELS and len(values) >= 4:
        try:
            if len(values) >= 12:
                model = ExponentialSmoothing(values, trend="add", seasonal="add", seasonal_periods=12)
            else:
                model = ExponentialSmoothing(values, trend="add")
            fitted = model.fit(optimized=True)
            forecast_values = fitted.forecast(n_months)
            # Build simple confidence interval: ±15% of value
            return [
                {
                    "month": m,
                    "predicted": round(float(max(0, v)), 2),
                    "lower": round(float(max(0, v * 0.85)), 2),
                    "upper": round(float(v * 1.15), 2),
                }
                for m, v in zip(future_months, forecast_values)
            ]
        except Exception:
            pass

    # Fallback: linear regression over available data
    x = np.arange(len(values))
    coeffs = np.polyfit(x, values, deg=1)
    future_x = np.arange(len(values), len(values) + n_months)
    predicted = np.polyval(coeffs, future_x)

    return [
        {
            "month": m,
            "predicted": round(float(max(0, v)), 2),
            "lower": round(float(max(0, v * 0.85)), 2),
            "upper": round(float(v * 1.15), 2),
        }
        for m, v in zip(future_months, predicted)
    ]
