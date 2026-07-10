"""
Monthly series forecasting via statsforecast (AutoETS).

Used by the Monte Carlo engine to get a trend/seasonality-aware expected
cashflow for each future month, instead of assuming a single flat historical
mean forever.
"""
from __future__ import annotations

import datetime

import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import AutoETS

SEASON_LENGTH = 12
MIN_HISTORY_FOR_SEASONAL_FIT = 2 * SEASON_LENGTH

# Trend extrapolation beyond this many months is not trustworthy (ETS trend
# components can drift unrealistically over decades) - the pattern from the
# last forecast year is repeated flat for any months beyond this cap.
TRUSTED_HORIZON_MONTHS = 60


def forecast_series(values: list[float], horizon: int) -> tuple[list[float], float]:
    """
    values: chronological monthly history (oldest -> newest).
    horizon: number of future months to produce.

    Returns (forecast_path, residual_std). Falls back to a flat mean/std when
    there isn't enough history to fit a seasonal model.
    """
    n = len(values)
    mean = sum(values) / n if n else 0.0

    if n < MIN_HISTORY_FOR_SEASONAL_FIT:
        std = (
            (sum((v - mean) ** 2 for v in values) / (n - 1)) ** 0.5
            if n > 1 else abs(mean) * 0.2
        )
        return [mean] * horizon, std

    today = datetime.date.today()
    dates = pd.date_range(end=pd.Timestamp(today.year, today.month, 1), periods=n, freq="MS")
    df = pd.DataFrame({"unique_id": "s", "ds": dates, "y": values})

    sf = StatsForecast(models=[AutoETS(season_length=SEASON_LENGTH)], freq="MS", n_jobs=1)
    cap = min(horizon, TRUSTED_HORIZON_MONTHS)
    fc = sf.forecast(df=df, h=cap, fitted=True)
    path = fc["AutoETS"].tolist()

    if horizon > cap:
        tail_cycle = path[-SEASON_LENGTH:] if len(path) >= SEASON_LENGTH else path[-1:]
        while len(path) < horizon:
            path.append(tail_cycle[(len(path) - cap) % len(tail_cycle)])

    fitted = sf.forecast_fitted_values()
    residuals = (fitted["y"] - fitted["AutoETS"]).to_numpy()
    std = float(residuals.std()) if len(residuals) > 1 else abs(mean) * 0.2

    return path, std
