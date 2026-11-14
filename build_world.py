"""Build real daily-derived UK, US and Asia market worlds and stress models.

python build_world.py                 # download Yahoo adjusted prices for all markets
python build_world.py --cached        # require local raw caches; no network
python build_world.py --market uk     # regenerate a selected market

Existing world.json fields are preserved. New fields: stocks[].name/firstDate,
marketInfo and shocks[]. The UK dataset is also written to public/world.json.
Each planet is an equal-weight selected-company basket, not a market index.
"""
import argparse
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

START = "2007-01-01"
VIX = "^VIX"
VOL_WINDOW = 20
CORR_WINDOW = 30
PAIR_CORR_WINDOW = 60
VOLUME_WINDOW = 52
MIN_STRESS_DAYS = 20
ROOT = Path(__file__).parent
PUBLIC = ROOT / "public"

US = {
    "Technology": [("AAPL", "Apple"), ("MSFT", "Microsoft"), ("NVDA", "NVIDIA"), ("GOOGL", "Alphabet"), ("ORCL", "Oracle")],
    "Financials": [("JPM", "JPMorgan Chase"), ("BAC", "Bank of America"), ("GS", "Goldman Sachs"), ("MS", "Morgan Stanley"), ("WFC", "Wells Fargo")],
    "Energy": [("XOM", "ExxonMobil"), ("CVX", "Chevron"), ("COP", "ConocoPhillips"), ("SLB", "SLB"), ("OXY", "Occidental")],
    "Healthcare": [("JNJ", "Johnson & Johnson"), ("PFE", "Pfizer"), ("UNH", "UnitedHealth"), ("MRK", "Merck"), ("ABT", "Abbott")],
    "Consumer": [("AMZN", "Amazon"), ("WMT", "Walmart"), ("KO", "Coca-Cola"), ("PG", "Procter & Gamble"), ("MCD", "McDonald's")],
    "Industrials": [("CAT", "Caterpillar"), ("BA", "Boeing"), ("DE", "Deere"), ("UPS", "UPS"), ("LMT", "Lockheed Martin")],
}
UK = {
    "Technology": [("SGE.L", "Sage"), ("CCC.L", "Computacenter"), ("SCT.L", "Softcat"), ("BYIT.L", "Bytes Technology"), ("KNOS.L", "Kainos")],
    "Financials": [("HSBA.L", "HSBC"), ("BARC.L", "Barclays"), ("LLOY.L", "Lloyds Banking Group"), ("NWG.L", "NatWest"), ("STAN.L", "Standard Chartered")],
    "Energy": [("SHEL.L", "Shell"), ("BP.L", "BP"), ("HBR.L", "Harbour Energy"), ("ITH.L", "Ithaca Energy"), ("ENOG.L", "Energean")],
    "Healthcare": [("AZN.L", "AstraZeneca"), ("GSK.L", "GSK"), ("HLN.L", "Haleon"), ("SN.L", "Smith & Nephew"), ("HIK.L", "Hikma Pharmaceuticals")],
    "Consumer": [("ULVR.L", "Unilever"), ("DGE.L", "Diageo"), ("TSCO.L", "Tesco"), ("ABF.L", "Associated British Foods"), ("IHG.L", "IHG Hotels & Resorts")],
    "Industrials": [("RR.L", "Rolls-Royce"), ("BA.L", "BAE Systems"), ("WEIR.L", "Weir Group"), ("IMI.L", "IMI"), ("SMIN.L", "Smiths Group")],
}
ASIA = {
    "Technology": [("2330.TW", "TSMC"), ("005930.KS", "Samsung Electronics"), ("8035.T", "Tokyo Electron"), ("INFY.NS", "Infosys"), ("0700.HK", "Tencent")],
    "Financials": [("8306.T", "Mitsubishi UFJ"), ("8316.T", "Sumitomo Mitsui"), ("3988.HK", "Bank of China"), ("1398.HK", "ICBC"), ("D05.SI", "DBS")],
    "Energy": [("1605.T", "INPEX"), ("5020.T", "ENEOS"), ("0883.HK", "CNOOC"), ("0857.HK", "PetroChina"), ("ONGC.NS", "ONGC")],
    "Healthcare": [("4502.T", "Takeda"), ("4503.T", "Astellas Pharma"), ("4519.T", "Chugai Pharmaceutical"), ("1093.HK", "CSPC Pharmaceutical"), ("SUNPHARMA.NS", "Sun Pharmaceutical")],
    "Consumer": [("7203.T", "Toyota"), ("9988.HK", "Alibaba"), ("1216.TW", "Uni-President"), ("ITC.NS", "ITC"), ("HINDUNILVR.NS", "Hindustan Unilever")],
    "Industrials": [("6501.T", "Hitachi"), ("7011.T", "Mitsubishi Heavy Industries"), ("600031.SS", "Sany Heavy Industry"), ("BN4.SI", "Keppel"), ("028050.KS", "Samsung E&A")],
}
MARKETS = {
    "uk": {"name": "United Kingdom", "short": "UK", "sectors": UK},
    "us": {"name": "United States", "short": "US", "sectors": US},
    "asia": {"name": "Asia", "short": "Asia", "sectors": ASIA},
}
# Retained for callers that import the original US configuration.
SECTORS = {name: [ticker for ticker, _ in stocks] for name, stocks in US.items()}
RAW = ROOT / "data" / "raw.pkl"
OUT = PUBLIC / "world.json"


def clean(series, digits=4):
    return [None if not np.isfinite(value) else round(float(value), digits)
            for value in series.to_numpy(dtype=float)]


def number(value, digits=6):
    return round(float(value), digits) if np.isfinite(value) else None


def download(market_id):
    import yfinance as yf
    market = MARKETS[market_id]
    tickers = [ticker for entries in market["sectors"].values() for ticker, _ in entries] + [VIX]
    end = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
    print(f"Downloading {market_id}: {len(tickers) - 1} stocks and US VIX", flush=True)
    frame = yf.download(tickers, start=START, end=end, auto_adjust=True, progress=False,
                        group_by="column", threads=4, timeout=25)
    if frame is None or frame.empty or not isinstance(frame.columns, pd.MultiIndex):
        raise RuntimeError(f"No usable Yahoo Finance data for {market_id}; existing outputs retained")
    close, volume = frame["Close"], frame["Volume"]
    # Retry failed individual symbols once; do not silently replace companies.
    for ticker in tickers:
        if ticker in close.columns and close[ticker].notna().any():
            continue
        print(f"Retrying {ticker}", flush=True)
        retry = yf.download(ticker, start=START, end=end, auto_adjust=True, progress=False,
                            group_by="column", threads=False, timeout=20)
        if retry is not None and not retry.empty:
            rc, rv = retry["Close"], retry["Volume"]
            close[ticker] = rc.iloc[:, 0] if isinstance(rc, pd.DataFrame) else rc
            volume[ticker] = rv.iloc[:, 0] if isinstance(rv, pd.DataFrame) else rv
    path = ROOT / "data" / f"raw-{market_id}.pkl"
    path.parent.mkdir(exist_ok=True)
    pd.to_pickle({"close": close, "volume": volume}, path)
    return close, volume


def prepare(close, volume, sectors):
    close = close.copy().sort_index()
    close.index = pd.to_datetime(close.index).tz_localize(None).normalize()
    close = close[~close.index.duplicated(keep="last")]
    close = close.where(close > 0)
    volume = volume.copy()
    volume.index = pd.to_datetime(volume.index).tz_localize(None).normalize()
    volume = volume[~volume.index.duplicated(keep="last")]
    requested = [ticker for tickers in sectors.values() for ticker in tickers]
    present = [ticker for ticker in requested if ticker in close and close[ticker].notna().any()]
    if not present:
        raise ValueError("No observed stock prices; refusing to generate an empty market")
    keep = close[present].notna().any(axis=1)
    close = close.loc[keep]
    volume = volume.reindex(index=close.index, columns=close.columns)
    # Each market has its own holidays: compute between actual observed closes.
    # Missing prices never become a zero daily return or an invented quote.
    daily_ret = close.apply(lambda series: series.dropna().pct_change(fill_method=None).reindex(close.index))
    daily_ret = daily_ret.replace([np.inf, -np.inf], np.nan)
    sector_daily = pd.DataFrame({
        name: daily_ret[[ticker for ticker in tickers if ticker in present]].mean(axis=1)
        for name, tickers in sectors.items()
    }, index=close.index)
    empty = [name for name in sectors if sector_daily[name].notna().sum() < MIN_STRESS_DAYS]
    if empty:
        raise ValueError(f"Insufficient observed data for sectors {empty}; existing outputs retained")
    return close, volume, daily_ret, sector_daily, present


def build_stress(sector_daily, vix, market_id="us"):
    names = list(sector_daily.columns)
    joined = sector_daily.join(vix.rename("__vix"), how="left")
    output = {"sectors": names, "market": market_id,
              "dateRange": [sector_daily.index.min().strftime("%Y-%m-%d"), sector_daily.index.max().strftime("%Y-%m-%d")],
              "method": "Daily sector mean returns; pairwise observed days; sample covariance / shocked-sector variance.",
              "vixLabel": "US VIX · global-risk proxy", "minimumPairDays": MIN_STRESS_DAYS, "regimes": {}}
    for regime, mask in [("calm", joined.__vix < 20), ("crisis", joined.__vix > 30)]:
        rows = joined.loc[mask, names]
        beta, correlation, counts = {}, {}, {}
        for shocked in names:
            beta[shocked], correlation[shocked], counts[shocked] = {}, {}, {}
            for affected in names:
                paired = rows[[shocked]].rename(columns={shocked: "x"}).join(rows[[affected]].rename(columns={affected: "y"})).dropna()
                count = len(paired)
                variance = paired.x.var(ddof=1)
                enough = count >= MIN_STRESS_DAYS and np.isfinite(variance) and variance > 1e-12
                coefficient = paired.x.cov(paired.y) / variance if enough else np.nan
                corr = paired.x.corr(paired.y) if enough and paired.y.var(ddof=1) > 1e-12 else np.nan
                beta[shocked][affected] = number(coefficient)
                correlation[shocked][affected] = number(corr)
                counts[shocked][affected] = count
        output["regimes"][regime] = {"days": int(rows.notna().any(axis=1).sum()), "beta": beta, "corr": correlation, "pairDays": counts}
    for shocked in names:
        means = []
        for regime in ("calm", "crisis"):
            values = [value for other, value in output["regimes"][regime]["beta"][shocked].items() if other != shocked and value is not None]
            means.append(float(np.mean(values)) if values else np.nan)
        print(f"  {market_id} {shocked}: average beta calm={means[0]:.3f}, crisis={means[1]:.3f}" +
              (" (crisis is not higher; retained as observed)" if means[1] <= means[0] else ""), flush=True)
    return output


def build_shocks(daily_ret, sector_daily, stock_tickers, dates):
    weekly = {date.strftime("%Y-%m-%d"): index for index, date in enumerate(dates)}
    market_daily = daily_ret[stock_tickers].mean(axis=1)
    by_week = {}
    for date, sector_row in sector_daily.iterrows():
        valid = sector_row.dropna()
        if valid.empty:
            continue
        friday = date.to_period("W-FRI").end_time.strftime("%Y-%m-%d")
        if friday not in weekly:
            continue
        week = weekly[friday]
        daily_market = market_daily.loc[date]
        if pd.notna(daily_market) and daily_market <= -0.04:
            worst = valid.idxmin()
            candidates = [{"kind": "market", "ret": number(daily_market), "sector": worst, "sectorRet": number(valid[worst])}]
        else:
            candidates = [{"kind": "sector", "ret": number(value), "sector": sector, "sectorRet": number(value)}
                          for sector, value in valid.items() if value <= -0.07]
        for event in candidates:
            event.update({"date": date.strftime("%Y-%m-%d"), "week": week})
            by_week.setdefault(week, []).append(event)
    result = []
    for week in sorted(by_week):
        result.extend(sorted(by_week[week], key=lambda event: (event["ret"], event["date"], event["sector"]))[:3])
    return result


def build(close, volume, sectors=None, market_id="us"):
    sectors = sectors or SECTORS
    close, volume, daily_ret, sec, present = prepare(close, volume, sectors)
    # Volatility windows use actual observations for each exchange.
    daily_vol = daily_ret.apply(lambda series: series.dropna().rolling(VOL_WINDOW, min_periods=VOL_WINDOW).std().reindex(daily_ret.index)) * np.sqrt(252)
    wk_close = close.resample("W-FRI").last()
    wk_ret = wk_close.pct_change(fill_method=None)
    wk_vol = daily_vol.resample("W-FRI").last()
    wk_volume = volume.resample("W-FRI").sum(min_count=1).replace(0, np.nan)
    rel_volume = wk_volume / wk_volume.rolling(VOLUME_WINDOW, min_periods=8).mean()
    dates = wk_close.index
    stocks, sector_output = [], []
    stock_names = {ticker: name for entries in MARKETS[market_id]["sectors"].values() for ticker, name in entries}
    for name, requested in sectors.items():
        available = [ticker for ticker in requested if ticker in present]
        for ticker in available:
            observed = wk_close[ticker].dropna()
            stocks.append({"ticker": ticker, "name": stock_names.get(ticker, ticker), "sector": name,
                           "firstDate": close[ticker].first_valid_index().strftime("%Y-%m-%d"),
                           "growth": clean(wk_close[ticker] / observed.iloc[0], 3), "ret": clean(wk_ret[ticker]),
                           "vol": clean(wk_vol[ticker], 3), "relVolume": clean(rel_volume[ticker], 2)})
        sector_output.append({"name": name, "tickers": available,
                              "ret": clean(wk_ret[available].mean(axis=1)), "vol": clean(wk_vol[available].mean(axis=1), 3)})
    # Pairwise complete rolling estimates; missing pairs remain null.
    names = list(sec.columns)
    pairs, pair_corr = [], {}
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            paired = sec[[a, b]].dropna()
            short = paired[a].rolling(CORR_WINDOW, min_periods=CORR_WINDOW).corr(paired[b]).reindex(sec.index)
            pairs.append(short)
            long = paired[a].rolling(PAIR_CORR_WINDOW, min_periods=PAIR_CORR_WINDOW).corr(paired[b])
            pair_corr[f"{a}|{b}"] = clean(long.resample("W-FRI").last().reindex(dates), 3)
    all_pairs = pd.concat(pairs, axis=1)
    average = all_pairs.mean(axis=1).where(all_pairs.notna().sum(axis=1) == len(pairs))
    vix = close[VIX] if VIX in close else pd.Series(np.nan, index=close.index, name=VIX)
    requested = [ticker for tickers in sectors.values() for ticker in tickers]
    missing = [ticker for ticker in requested if ticker not in present]
    info = {"id": market_id, "name": MARKETS[market_id]["name"], "short": MARKETS[market_id]["short"],
            "vixLabel": "US VIX" if market_id == "us" else "US VIX · global-risk proxy",
            "description": "Equal-weight selected-company basket; not an official market index.",
            "currencyNote": "Local-currency adjusted prices; no FX conversion.",
            "coverage": {"requestedStocks": len(requested), "availableStocks": len(present), "failedTickers": missing,
                         "from": dates[0].strftime("%Y-%m-%d"), "to": dates[-1].strftime("%Y-%m-%d"),
                         "vixObservedDays": int(vix.notna().sum())},
            "limitations": ["Today's selected companies create survivorship bias.",
                            "Coverage begins at each stock's first available observation; no pre-listing returns are invented.",
                            "Different exchange holidays and closing times limit cross-market comparability.",
                            "US VIX is a global-risk proxy, not a local volatility index."]}
    world = {"dates": [date.strftime("%Y-%m-%d") for date in dates], "sectors": sector_output, "stocks": stocks,
             "market": {"ret": clean(wk_ret[present].mean(axis=1)), "vix": clean(vix.resample("W-FRI").last().reindex(dates), 2),
                        "avgCorr": clean(average.resample("W-FRI").last().reindex(dates), 3), "pairCorr": pair_corr},
             "marketInfo": info, "shocks": build_shocks(daily_ret, sec, present, dates)}
    stress = build_stress(sec, vix, market_id)
    return world, stress


def tour_narration(world, index, focus):
    market = world["market"]
    sector = next((sector for sector in world["sectors"] if sector["name"] == focus), None)
    value = (sector or market)["ret"][index]
    move = "had no return observation" if value is None else f"moved {value * 100:+.1f}%"
    corr, vix = market["avgCorr"][index], market["vix"][index]
    fear = f"US VIX was {vix:.1f}" if vix is not None else "US VIX was unavailable"
    connection = f"sector correlation was {corr:.2f}" if corr is not None else "sector correlation was unavailable"
    subject = f"the {focus} sector" if sector else "the selected-company basket"
    return f"In the week ending {world['dates'][index]}, {subject} {move}. {fear}, and {connection}. These are historical observations for {world['marketInfo']['name']}."


def build_tours(world):
    """Data-selected stops, avoiding copied US narrative claims on other markets."""
    dates, market = world["dates"], world["market"]
    selections = []
    def extreme(year, field, reverse=False):
        eligible = [i for i, date in enumerate(dates) if date.startswith(year) and market[field][i] is not None]
        return (max if reverse else min)(eligible, key=lambda i: market[field][i]) if eligible else None
    for year, title, field, high, focus in [
        ("2007", "Before the crisis", "vix", False, "market"),
        ("2008", "Sharpest basket fall of 2008", "ret", False, "Financials"),
        ("2008", "Peak fear in 2008", "vix", True, "market"),
        ("2009", "Strongest basket week of 2009", "ret", True, "market"),
        ("2017", "A quiet week in 2017", "vix", False, "market"),
        ("2020", "Sharpest basket fall of 2020", "ret", False, "Energy"),
        ("2020", "Strongest basket week of 2020", "ret", True, "Healthcare"),
        ("2023", "Strongest basket week of 2023", "ret", True, "Technology"),
    ]:
        index = extreme(year, field, high)
        if index is None:
            continue
        selections.append({"date": dates[index], "title": title, "focus": focus,
                           "phase": "HISTORICAL DATA", "risk": (market["ret"][index] or 0) < -0.07,
                           "narration": tour_narration(world, index, focus), "narrationSource": "template"})
    return selections


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False))
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cached", action="store_true")
    parser.add_argument("--market", choices=list(MARKETS), action="append")
    args = parser.parse_args()
    selected = args.market or list(MARKETS)
    report = {"generatedAt": datetime.now(timezone.utc).isoformat(), "source": "Yahoo Finance adjusted daily prices via yfinance", "markets": {}}
    for market_id in selected:
        cache = ROOT / "data" / f"raw-{market_id}.pkl"
        if args.cached:
            if not cache.exists() and market_id == "us" and RAW.exists():
                cache = RAW
            if not cache.exists():
                raise SystemExit(f"No raw cache for {market_id}; run without --cached first")
            raw = pd.read_pickle(cache)
            close, volume = raw["close"], raw["volume"]
        else:
            close, volume = download(market_id)
        sectors = {name: [ticker for ticker, _ in stocks] for name, stocks in MARKETS[market_id]["sectors"].items()}
        world, stress = build(close, volume, sectors, market_id)
        tours = build_tours(world)
        folder = PUBLIC / "markets" / market_id
        # Existing US stories remain valid; rebuild their numeric narration from this dataset.
        if market_id == "us" and (folder / "tours.json").exists():
            prior = json.loads((folder / "tours.json").read_text())
            if isinstance(prior, list) and prior:
                tours = []
                for stop in prior:
                    if stop.get("date") not in world["dates"]:
                        continue
                    stop["narration"] = tour_narration(world, world["dates"].index(stop["date"]), stop.get("focus", "market"))
                    stop["narrationSource"] = "template"
                    tours.append(stop)
        for filename, value in [("world.json", world), ("stress.json", stress), ("tours.json", tours)]:
            write_json(folder / filename, value)
            if market_id == "uk":
                write_json(PUBLIC / filename, value)
        report["markets"][market_id] = {**world["marketInfo"]["coverage"], "weeks": len(world["dates"]),
            "stressDays": {regime: data["days"] for regime, data in stress["regimes"].items()},
            "stressPairMinimum": {regime: min(count for row in data["pairDays"].values() for count in row.values()) for regime, data in stress["regimes"].items()},
            "shocks": len(world["shocks"]), "shockWeeks": len({shock["week"] for shock in world["shocks"]}),
            "sectorCounts": {sector["name"]: len(sector["tickers"]) for sector in world["sectors"]}}
        print(f"Wrote {market_id}: {len(world['stocks'])} stocks, {len(world['dates'])} weeks, {len(world['shocks'])} daily shocks", flush=True)
    manifest = {"default": "uk", "markets": [{"id": key, "name": value["name"], "short": value["short"],
        "currencyNote": "Local-currency adjusted prices", "world": f"/markets/{key}/world.json",
        "stress": f"/markets/{key}/stress.json", "tours": f"/markets/{key}/tours.json"}
        for key, value in MARKETS.items() if (PUBLIC / "markets" / key / "stress.json").exists()]}
    write_json(PUBLIC / "markets.json", manifest)
    write_json(PUBLIC / "markets" / "validation.json", report)


if __name__ == "__main__":
    main()
