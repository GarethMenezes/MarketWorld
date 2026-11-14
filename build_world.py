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
STRESS_OUT = ROOT / "public" / "stress.json"
CALM_VIX, CRISIS_VIX = 20, 30   # stress-test regimes: calm = VIX < 20, crisis = VIX > 30
MARKET_SHOCK, SECTOR_SHOCK = -0.04, -0.07   # meteor strikes: daily falls at or below these
MAX_SHOCKS_PER_WEEK = 3


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
    world = {
        "dates": [d.strftime("%Y-%m-%d") for d in dates],
        "sectors": sectors,
        "stocks": stocks,
        "market": market,
        "shocks": build_shocks(daily_ret[all_stocks].mean(axis=1), sec, dates),
    }
    vix_daily = close[VIX] if VIX in close else pd.Series(np.nan, index=close.index)
    return world, build_stress(sec, vix_daily)


def build_shocks(mkt_daily, sec, dates):
    """Meteor strikes: single days with extreme drops.

    market shock: average daily return of all stocks <= MARKET_SHOCK
    sector shock: a sector's daily return <= SECTOR_SHOCK on a day that is not a market shock
    week = index of the W-FRI week containing the day; sector = the sector that fell most that day.
    At most MAX_SHOCKS_PER_WEEK per week (the biggest falls).
    """
    week_of = {d.strftime("%Y-%m-%d"): i for i, d in enumerate(dates)}
    found = []
    for day, mret in mkt_daily.dropna().items():
        row = sec.loc[day].dropna()
        if row.empty:
            continue
        week_end = (day + pd.offsets.Week(weekday=4, n=0)).strftime("%Y-%m-%d")  # same day if Friday
        if week_end not in week_of:
            continue
        if mret <= MARKET_SHOCK:
            found.append({"date": day.strftime("%Y-%m-%d"), "week": week_of[week_end], "kind": "market",
                          "ret": round(float(mret), 4), "sector": row.idxmin()})
        else:
            for name, r in row.items():
                if r <= SECTOR_SHOCK:
                    found.append({"date": day.strftime("%Y-%m-%d"), "week": week_of[week_end], "kind": "sector",
                                  "ret": round(float(r), 4), "sector": name})
    by_week = {}
    for sh in found:
        by_week.setdefault(sh["week"], []).append(sh)
    shocks = []
    for w in sorted(by_week):
        shocks += sorted(by_week[w], key=lambda x: x["ret"])[:MAX_SHOCKS_PER_WEEK]
    years = pd.Series([s["date"][:4] for s in shocks]).value_counts().sort_index()
    print(f"Shock days: {len(shocks)} kept ({len(found)} found; "
          f"{sum(s['kind'] == 'market' for s in shocks)} market, {sum(s['kind'] == 'sector' for s in shocks)} sector)")
    print("  by year: " + ", ".join(f"{y}:{n}" for y, n in years.items()))
    return shocks


def build_stress(sec, vix_daily):
    """'What if?' sandbox data: how each sector moved per 1% move in another, by regime.

    beta[i][j] = cov(r_j, r_i) / var(r_i)  (i = shocked sector, j = affected sector)
    Regimes from the same day's VIX close: calm < CALM_VIX, crisis > CRISIS_VIX.
    """
    names = list(sec.columns)
    df = sec.join(vix_daily.rename("VIX")).dropna()
    regimes = {}
    for regime, mask in (("calm", df["VIX"] < CALM_VIX), ("crisis", df["VIX"] > CRISIS_VIX)):
        r = df.loc[mask, names]
        cov, var, corr = r.cov(), r.var(), r.corr()
        regimes[regime] = {
            "days": int(len(r)),
            "beta": {i: {j: round(float(cov.loc[i, j] / var[i]), 3) for j in names} for i in names},
            "corr": {i: {j: round(float(corr.loc[i, j]), 3) for j in names} for i in names},
        }
    # Summary: average beta from each shocked sector to the others, calm vs crisis
    print(f"Stress regimes: calm {regimes['calm']['days']} days (VIX<{CALM_VIX}), "
          f"crisis {regimes['crisis']['days']} days (VIX>{CRISIS_VIX})")
    higher = 0
    for i in names:
        avg = {k: np.mean([regimes[k]["beta"][i][j] for j in names if j != i]) for k in regimes}
        higher += avg["crisis"] > avg["calm"]
        print(f"  {i:12s} avg beta to others  calm {avg['calm']:.2f}  crisis {avg['crisis']:.2f}")
    if higher < len(names):
        print(f"  NOTE: crisis beta is NOT higher for {len(names) - higher} sector(s) — reported, not hidden.")
    return {"sectors": names, "calmVix": CALM_VIX, "crisisVix": CRISIS_VIX, "regimes": regimes}


def main():
    if "--cached" in sys.argv and RAW.exists():
        raw = pd.read_pickle(RAW)
        close, volume = raw["close"], raw["volume"]
    else:
        close, volume = download()
    world, stress = build(close, volume)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(world, separators=(",", ":")))
    STRESS_OUT.write_text(json.dumps(stress, indent=1))
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB), "
          f"{len(world['dates'])} weeks, {len(world['stocks'])} stocks")


if __name__ == "__main__":
    main()
