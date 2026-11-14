"""Download ~20 years of market data and write one planet per market.

Usage:  python build_world.py                     (US: downloads from Yahoo Finance)
        python build_world.py --market uk         (one market: us | uk | asia)
        python build_world.py --market all        (every market)
        python build_world.py --cached ...        (re-use data/raw-<market>.pkl, no internet)

Outputs (public/): US → world.json + stress.json (unchanged names); other markets →
world-<id>.json + stress-<id>.json; markets.json lists them all for the planet switcher.

JSON contract (keep in sync with main.js and server/app.py):
{
  "dates":   ["2007-01-05", ...],                       # weekly, Fridays
  "sectors": [{"name", "tickers", "ret": [], "vol": []}],
  "stocks":  [{"ticker", "sector", "growth": [], "ret": [], "vol": [], "relVolume": []}],
  "meta":    {"id", "name", "fearLabel", "note"},           # which market this planet is
  "market":  {"ret": [], "vix": [], "avgCorr": [],         # "vix" = the market's fear measure
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

# One planet per market: the same six sectors, five large companies each.
# fear: a volatility index ticker, or None → 20-day realised volatility of the market's
# equal-weighted daily return (annualised, in %), which sits on a similar scale to the VIX.
MARKETS = {
    "us": {
        "name": "United States", "short": "US", "fear": "^VIX", "fearLabel": "VIX",
        "note": "30 large US companies; fear = the VIX index.",
        "sectors": {
            "Technology":  ["AAPL", "MSFT", "NVDA", "GOOGL", "ORCL"],
            "Financials":  ["JPM", "BAC", "GS", "MS", "WFC"],
            "Energy":      ["XOM", "CVX", "COP", "SLB", "OXY"],
            "Healthcare":  ["JNJ", "PFE", "UNH", "MRK", "ABT"],
            "Consumer":    ["AMZN", "WMT", "KO", "PG", "MCD"],
            "Industrials": ["CAT", "BA", "DE", "UPS", "LMT"],
        },
        "names": {
            "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "GOOGL": "Alphabet", "ORCL": "Oracle",
            "JPM": "JPMorgan Chase", "BAC": "Bank of America", "GS": "Goldman Sachs", "MS": "Morgan Stanley",
            "WFC": "Wells Fargo", "XOM": "ExxonMobil", "CVX": "Chevron", "COP": "ConocoPhillips", "SLB": "SLB",
            "OXY": "Occidental", "JNJ": "Johnson & Johnson", "PFE": "Pfizer", "UNH": "UnitedHealth",
            "MRK": "Merck", "ABT": "Abbott", "AMZN": "Amazon", "WMT": "Walmart", "KO": "Coca-Cola",
            "PG": "Procter & Gamble", "MCD": "McDonald's", "CAT": "Caterpillar", "BA": "Boeing",
            "DE": "Deere", "UPS": "UPS", "LMT": "Lockheed Martin",
        },
    },
    "uk": {
        "name": "United Kingdom", "short": "UK", "fear": None, "fearLabel": "realised vol",
        "note": "30 large London-listed companies (prices in pence); fear = realised volatility, "
                "because no UK fear index is freely available.",
        "sectors": {
            "Technology":  ["SGE.L", "REL.L", "EXPN.L", "HLMA.L", "BT-A.L"],
            "Financials":  ["HSBA.L", "BARC.L", "LLOY.L", "NWG.L", "STAN.L"],
            "Energy":      ["SHEL.L", "BP.L", "SSE.L", "NG.L", "CNA.L"],
            "Healthcare":  ["AZN.L", "GSK.L", "SN.L", "HIK.L", "CTEC.L"],
            "Consumer":    ["ULVR.L", "DGE.L", "TSCO.L", "BATS.L", "NXT.L"],
            "Industrials": ["BA.L", "RR.L", "SMIN.L", "WEIR.L", "BNZL.L"],
        },
        "names": {
            "SGE.L": "Sage", "REL.L": "RELX", "EXPN.L": "Experian", "HLMA.L": "Halma", "BT-A.L": "BT",
            "HSBA.L": "HSBC", "BARC.L": "Barclays", "LLOY.L": "Lloyds", "NWG.L": "NatWest",
            "STAN.L": "StanChart", "SHEL.L": "Shell", "BP.L": "BP", "SSE.L": "SSE",
            "NG.L": "National Grid", "CNA.L": "Centrica", "AZN.L": "AstraZeneca", "GSK.L": "GSK",
            "SN.L": "Smith & Nephew", "HIK.L": "Hikma", "CTEC.L": "Convatec", "ULVR.L": "Unilever",
            "DGE.L": "Diageo", "TSCO.L": "Tesco", "BATS.L": "BAT", "NXT.L": "Next",
            "BA.L": "BAE Systems", "RR.L": "Rolls-Royce", "SMIN.L": "Smiths Group", "WEIR.L": "Weir",
            "BNZL.L": "Bunzl",
        },
    },
    "asia": {
        "name": "Asia-Pacific", "short": "Asia", "fear": None, "fearLabel": "realised vol",
        "note": "30 large companies from Japan, China/Hong Kong, Korea, Taiwan and Singapore "
                "(returns in each stock's local currency); fear = realised volatility.",
        "sectors": {
            "Technology":  ["2330.TW", "005930.KS", "0700.HK", "6758.T", "2317.TW"],
            "Financials":  ["0005.HK", "1398.HK", "8306.T", "D05.SI", "0939.HK"],
            "Energy":      ["0857.HK", "0883.HK", "0386.HK", "5020.T", "1605.T"],
            "Healthcare":  ["4502.T", "4519.T", "4568.T", "4503.T", "4523.T"],
            "Consumer":    ["7203.T", "9983.T", "2914.T", "005380.KS", "7267.T"],
            "Industrials": ["6501.T", "6301.T", "7011.T", "6503.T", "8001.T"],
        },
        "names": {
            "2330.TW": "TSMC", "005930.KS": "Samsung", "0700.HK": "Tencent", "6758.T": "Sony",
            "2317.TW": "Foxconn", "0005.HK": "HSBC (HK)", "1398.HK": "ICBC", "8306.T": "MUFG",
            "D05.SI": "DBS", "0939.HK": "CCB", "0857.HK": "PetroChina", "0883.HK": "CNOOC",
            "0386.HK": "Sinopec", "5020.T": "ENEOS", "1605.T": "Inpex", "4502.T": "Takeda", "4519.T": "Chugai",
            "4568.T": "Daiichi Sankyo", "4503.T": "Astellas", "4523.T": "Eisai", "7203.T": "Toyota",
            "9983.T": "Fast Retailing", "2914.T": "Japan Tobacco", "005380.KS": "Hyundai Motor",
            "7267.T": "Honda", "6501.T": "Hitachi", "6301.T": "Komatsu", "7011.T": "MHI",
            "6503.T": "Mitsubishi Elec.", "8001.T": "Itochu",
        },
    },
}

# Active market (set by use_market); build() reads these
SECTORS = MARKETS["us"]["sectors"]
VIX = "^VIX"
MARKET_ID = "us"
VOL_WINDOW = 20      # trading days for volatility
CORR_WINDOW = 30     # trading days for average sector correlation (30 reacts to crashes quickly)
PAIR_CORR_WINDOW = 60  # trading days for each sector-pair correlation (fault lines)
VOLUME_WINDOW = 52   # weeks for "normal" trading volume

ROOT = Path(__file__).parent
RAW = ROOT / "data" / "raw.pkl"
OUT = ROOT / "public" / "world.json"
STRESS_OUT = ROOT / "public" / "stress.json"
INDEX_OUT = ROOT / "public" / "markets.json"


def files_for(mid):
    """US keeps the original file names; other markets get a suffix."""
    suffix = "" if mid == "us" else f"-{mid}"
    return f"world{suffix}.json", f"stress{suffix}.json", f"raw{'' if mid == 'us' else '-' + mid}.pkl"


def tours_file(mid):
    """US: hand-curated public/tours.json. Other markets: generated from their own data."""
    return "tours.json" if mid == "us" else f"tours-{mid}.json"


def use_market(mid):
    global SECTORS, VIX, MARKET_ID, RAW, OUT, STRESS_OUT
    m = MARKETS[mid]
    world_f, stress_f, raw_f = files_for(mid)
    SECTORS, VIX, MARKET_ID = m["sectors"], m["fear"], mid
    RAW, OUT, STRESS_OUT = ROOT / "data" / raw_f, ROOT / "public" / world_f, ROOT / "public" / stress_f
CALM_VIX, CRISIS_VIX = 20, 30   # stress-test regimes: calm = VIX < 20, crisis = VIX > 30
MARKET_SHOCK, SECTOR_SHOCK = -0.04, -0.07   # meteor strikes: daily falls at or below these
MAX_SHOCKS_PER_WEEK = 3


def download():
    import yfinance as yf
    tickers = [t for ts in SECTORS.values() for t in ts] + ([VIX] if VIX else [])
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
    stock_cols = [t for t in close.columns if t != VIX and t in sum(SECTORS.values(), [])]
    keep = close[stock_cols].notna().any(axis=1)
    print(f"Dropping {(~keep).sum()} non-trading days")
    close, volume = close[keep], volume.reindex(close.index[keep])

    # Each stock's return over its own trading days, so another exchange's holiday
    # (different markets in one planet) does not blank the next day's return.
    daily_ret = close.apply(lambda col: col.dropna().pct_change()).reindex(close.index)
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
                "name": MARKETS[MARKET_ID]["names"].get(t, t),
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
    # min_periods < window: markets on several exchanges have days when a sector didn't trade
    corr = sec.rolling(CORR_WINDOW, min_periods=int(CORR_WINDOW * 0.7)).corr()
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
            pc = sec[names[a]].rolling(PAIR_CORR_WINDOW, min_periods=int(PAIR_CORR_WINDOW * 0.7)).corr(sec[names[b]])
            pair_corr[f"{names[a]}|{names[b]}"] = clean(pc.resample("W-FRI").last().reindex(dates), 3)

    all_stocks = [t for ts in SECTORS.values() for t in ts if t in close.columns]
    # Fear: the market's volatility index, or realised volatility of the equal-weighted market
    mkt_daily = daily_ret[all_stocks].mean(axis=1)
    if VIX and VIX in close:
        fear_daily = close[VIX]
    else:
        fear_daily = mkt_daily.rolling(VOL_WINDOW, min_periods=VOL_WINDOW).std() * np.sqrt(252) * 100
    market = {
        "ret": clean(wk_ret[all_stocks].mean(axis=1)),
        "vix": clean(fear_daily.resample("W-FRI").last().reindex(dates), 2),
        "avgCorr": clean(wk_corr.reindex(dates), 3),
        "pairCorr": pair_corr,
    }
    m = MARKETS[MARKET_ID]
    world = {
        "meta": {"id": MARKET_ID, "name": m["name"], "short": m["short"],
                 "fearLabel": m["fearLabel"], "note": m["note"]},
        "dates": [d.strftime("%Y-%m-%d") for d in dates],
        "sectors": sectors,
        "stocks": stocks,
        "market": market,
        "shocks": build_shocks(mkt_daily, sec, dates),
    }
    return world, build_stress(sec, fear_daily)


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


def build_tours(world):
    """Data-driven tour for markets without a curated one (idea from Gareth's sota commit).

    Each stop is a week picked by a rule on this market's own numbers; the narration only
    restates those numbers.
    """
    d, m = world["dates"], world["market"]
    fear = world["meta"]["fearLabel"]
    sectors = world["sectors"]

    def pick(series, best, year_from=None, year_to=None):
        idx = [i for i, v in enumerate(series) if v is not None
               and (year_from is None or int(d[i][:4]) >= year_from)
               and (year_to is None or int(d[i][:4]) <= year_to)]
        return (max if best else min)(idx, key=lambda i: series[i]) if idx else None

    def worst_sector(i):
        rows = [(s["ret"][i], s["name"]) for s in sectors if s["ret"][i] is not None]
        return min(rows)[1] if rows else "market"

    def pct(x):
        return "n/a" if x is None else f"{x * 100:+.1f}%"

    rules = [
        ("Sharpest fall of 2008", pick(m["ret"], False, 2008, 2008), "worst", "CRASH WEEK", True),
        ("Peak fear", pick(m["vix"], True), "market", "PEAK FEAR", True),
        ("Strongest rebound of 2009", pick(m["ret"], True, 2009, 2009), "market", "REBOUND", False),
        ("Sectors most in sync", pick(m["avgCorr"], True), "market", "LOCKSTEP", True),
        ("A quiet week in 2017", pick(m["vix"], False, 2017, 2017), "market", "CALM", False),
        ("Sharpest fall of 2020", pick(m["ret"], False, 2020, 2020), "worst", "PANDEMIC CRASH", True),
        ("Strongest week of 2020", pick(m["ret"], True, 2020, 2020), "market", "REBOUND", False),
        ("Worst week since 2021", pick(m["ret"], False, 2021), "worst", "SELL-OFF", True),
    ]
    tours, seen = [], set()
    for title, i, focus, phase, risk in rules:
        if i is None or i in seen:
            continue
        seen.add(i)
        focus = worst_sector(i) if focus == "worst" else focus
        f, c = m["vix"][i], m["avgCorr"][i]
        line = f"In the week ending {d[i]}, the {world['meta']['name']} market moved {pct(m['ret'][i])}"
        if focus != "market":
            sec = next(s for s in sectors if s["name"] == focus)
            line += f" and {focus}, the hardest-hit sector, moved {pct(sec['ret'][i])}"
        line += "."
        if f is not None:
            line += f" Fear ({fear}) was {f:.0f}."
        if c is not None:
            line += f" Average sector correlation was {c:.2f}."
        tours.append({"date": d[i], "title": title, "focus": focus, "phase": phase, "risk": risk,
                      "narration": line, "narrationSource": "data"})
    return sorted(tours, key=lambda t: t["date"])


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


def build_market(mid):
    use_market(mid)
    print(f"\n=== {MARKETS[mid]['name']} ({mid}) ===")
    if "--cached" in sys.argv and RAW.exists():
        raw = pd.read_pickle(RAW)
        close, volume = raw["close"], raw["volume"]
    else:
        close, volume = download()
    world, stress = build(close, volume)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(world, separators=(",", ":")))
    STRESS_OUT.write_text(json.dumps(stress, indent=1))
    if mid != "us":
        tours = build_tours(world)
        (ROOT / "public" / tours_file(mid)).write_text(json.dumps(tours, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"Tour: {len(tours)} stops -> public/{tours_file(mid)}")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB), "
          f"{len(world['dates'])} weeks, {len(world['stocks'])} stocks")


def write_index():
    """public/markets.json: every market whose files exist, for the planet switcher."""
    out = []
    for mid, m in MARKETS.items():
        world_f, stress_f, _ = files_for(mid)
        if (ROOT / "public" / world_f).exists():
            out.append({"id": mid, "name": m["name"], "short": m["short"], "world": world_f,
                        "stress": stress_f, "tours": tours_file(mid),
                        "fearLabel": m["fearLabel"], "note": m["note"]})
    INDEX_OUT.write_text(json.dumps(out, indent=1))
    print(f"\nWrote {INDEX_OUT}: {[x['id'] for x in out]}")


def main():
    arg = sys.argv[sys.argv.index("--market") + 1] if "--market" in sys.argv else "us"
    for mid in (MARKETS if arg == "all" else [arg]):
        build_market(mid)
    write_index()


if __name__ == "__main__":
    main()
