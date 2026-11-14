"""Download ~20 years of market data and write public/world.json.

Usage:  python build_world.py            (downloads from Yahoo Finance)
        python build_world.py --cached   (re-uses data/raw.pkl, no internet)

JSON contract (keep in sync with main.js and server/app.py):
{
  "dates":   ["2007-01-05", ...],                       # weekly, Fridays
  "sectors": [{"name", "tickers", "ret": [], "vol": []}],
  "stocks":  [{"ticker", "sector", "growth": [], "ret": [], "vol": [], "relVolume": []}],
  "market":  {"ret": [], "vix": [], "avgCorr": [],
              "pairCorr": {"Technology|Financials": [], ...}}   # 60-day, all 15 pairs
}
Every array has one value per date; null = no data.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

START = "2007-01-01"
SECTORS = {
    "Technology":  ["AAPL", "MSFT", "NVDA", "GOOGL", "ORCL"],
    "Financials":  ["JPM", "BAC", "GS", "MS", "WFC"],
    "Energy":      ["XOM", "CVX", "COP", "SLB", "OXY"],
    "Healthcare":  ["JNJ", "PFE", "UNH", "MRK", "ABT"],
    "Consumer":    ["AMZN", "WMT", "KO", "PG", "MCD"],
    "Industrials": ["CAT", "BA", "DE", "UPS", "LMT"],
}
VIX = "^VIX"
VOL_WINDOW = 20      # trading days for volatility
CORR_WINDOW = 30     # trading days for average sector correlation (30 reacts to crashes quickly)
PAIR_CORR_WINDOW = 60  # trading days for each sector-pair correlation (fault lines)
VOLUME_WINDOW = 52   # weeks for "normal" trading volume

ROOT = Path(__file__).parent
RAW = ROOT / "data" / "raw.pkl"
OUT = ROOT / "public" / "world.json"


def download():
    import yfinance as yf
    tickers = [t for ts in SECTORS.values() for t in ts] + [VIX]
    df = yf.download(tickers, start=START, auto_adjust=True,
                     progress=False, group_by="column", threads=True)
    if df is None or df.empty:
        sys.exit("Download failed: no data returned")
    # yfinance returns MultiIndex columns (field, ticker); older versions may differ.
    if not isinstance(df.columns, pd.MultiIndex):
        sys.exit("Unexpected yfinance column format: " + str(df.columns[:5]))
    close, volume = df["Close"], df["Volume"]
    missing = [t for t in tickers if t not in close.columns or close[t].isna().all()]
    if missing:
        print("WARNING: no data for", missing)
    RAW.parent.mkdir(exist_ok=True)
    pd.to_pickle({"close": close, "volume": volume}, RAW)
    return close, volume


def clean(series, digits=4):
    """pandas Series -> list with None for NaN/inf, rounded."""
    arr = series.to_numpy(dtype=float)
    return [None if not np.isfinite(v) else round(float(v), digits) for v in arr]


def build(close, volume):
    close = close.sort_index()
    close.index = pd.to_datetime(close.index).tz_localize(None)
    volume.index = pd.to_datetime(volume.index).tz_localize(None)
    # Drop days when only VIX traded (stock holidays); they would break rolling windows.
    stock_cols = [t for t in close.columns if t != VIX]
    keep = close[stock_cols].notna().any(axis=1)
    print(f"Dropping {(~keep).sum()} non-trading days")
    close, volume = close[keep], volume.reindex(close.index[keep])

    daily_ret = close.pct_change(fill_method=None)
    daily_vol = daily_ret.rolling(VOL_WINDOW, min_periods=VOL_WINDOW).std() * np.sqrt(252)

    # Weekly frames (week ending Friday)
    wk_close = close.resample("W-FRI").last()
    wk_ret = wk_close.pct_change(fill_method=None)
    wk_vol = daily_vol.resample("W-FRI").last()
    wk_volume = volume.resample("W-FRI").sum(min_count=1).replace(0, np.nan)
    rel_volume = wk_volume / wk_volume.rolling(VOLUME_WINDOW, min_periods=8).mean()
    dates = wk_close.index

    stocks, sectors = [], []
    sector_daily = {}
    for name, tickers in SECTORS.items():
        present = [t for t in tickers if t in close.columns and close[t].notna().any()]
        for t in present:
            first = wk_close[t].dropna().iloc[0]
            stocks.append({
                "ticker": t,
                "sector": name,
                "growth": clean(wk_close[t] / first, 3),
                "ret": clean(wk_ret[t]),
                "vol": clean(wk_vol[t], 3),
                "relVolume": clean(rel_volume[t], 2),
            })
        sector_daily[name] = daily_ret[present].mean(axis=1)
        sectors.append({
            "name": name,
            "tickers": present,
            "ret": clean(wk_ret[present].mean(axis=1)),
            "vol": clean(wk_vol[present].mean(axis=1), 3),
        })

    # Average pairwise correlation between sector daily returns, rolling window.
    sec = pd.DataFrame(sector_daily)
    n = sec.shape[1]
    corr = sec.rolling(CORR_WINDOW, min_periods=CORR_WINDOW).corr()
    # sum of matrix minus diagonal (n), divided by number of off-diagonal entries
    avg_corr = (corr.groupby(level=0).sum().sum(axis=1) - n) / (n * (n - 1))
    avg_corr[corr.groupby(level=0).count().sum(axis=1) < n * n] = np.nan
    wk_corr = avg_corr.resample("W-FRI").last()

    # Pairwise sector correlation, rolling 60 trading days → fault-line glow between plates.
    # Keys "A|B" in SECTORS order (A before B).
    names = list(sector_daily)
    pair_corr = {}
    for a in range(len(names)):
        for b in range(a + 1, len(names)):
            pc = sec[names[a]].rolling(PAIR_CORR_WINDOW, min_periods=PAIR_CORR_WINDOW).corr(sec[names[b]])
            pair_corr[f"{names[a]}|{names[b]}"] = clean(pc.resample("W-FRI").last().reindex(dates), 3)

    all_stocks = [t for ts in SECTORS.values() for t in ts if t in close.columns]
    market = {
        "ret": clean(wk_ret[all_stocks].mean(axis=1)),
        "vix": clean(wk_close[VIX], 2) if VIX in wk_close else [None] * len(dates),
        "avgCorr": clean(wk_corr.reindex(dates), 3),
        "pairCorr": pair_corr,
    }
    return {
        "dates": [d.strftime("%Y-%m-%d") for d in dates],
        "sectors": sectors,
        "stocks": stocks,
        "market": market,
    }


def main():
    if "--cached" in sys.argv and RAW.exists():
        raw = pd.read_pickle(RAW)
        close, volume = raw["close"], raw["volume"]
    else:
        close, volume = download()
    world = build(close, volume)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(world, separators=(",", ":")))
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB), "
          f"{len(world['dates'])} weeks, {len(world['stocks'])} stocks")


if __name__ == "__main__":
    main()
