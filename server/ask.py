"""'Ask the planet': turn a free-text question into a week + focus + short answer.

Used by server/app.py (POST /api/ask). The LLM picks a week from a compact context built
from world.json; everything it returns is validated and the numbers shown come from the data.
A keyword matcher (also mirrored in ask.js on the frontend) answers when there is no key,
no internet, or the call is slow.
"""
import json
import re
from datetime import date

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
SECTOR_WORDS = {
    "Technology": ["technology", "tech"],
    "Financials": ["financials", "financial", "banks", "bank", "banking", "finance"],
    "Energy": ["energy", "oil", "gas"],
    "Healthcare": ["healthcare", "health", "pharma", "drug"],
    "Consumer": ["consumer", "retail", "shopping"],
    "Industrials": ["industrials", "industrial", "manufacturing", "airline"],
}
COMPANY_WORDS = {
    "AAPL": "apple", "MSFT": "microsoft", "NVDA": "nvidia", "GOOGL": "google", "ORCL": "oracle",
    "JPM": "jpmorgan", "BAC": "bank of america", "GS": "goldman", "MS": "morgan stanley", "WFC": "wells fargo",
    "XOM": "exxon", "CVX": "chevron", "COP": "conocophillips", "SLB": "schlumberger", "OXY": "occidental",
    "JNJ": "johnson", "PFE": "pfizer", "UNH": "unitedhealth", "MRK": "merck", "ABT": "abbott",
    "AMZN": "amazon", "WMT": "walmart", "KO": "coca-cola", "PG": "procter", "MCD": "mcdonald",
    "CAT": "caterpillar", "BA": "boeing", "DE": "deere", "UPS": "ups", "LMT": "lockheed",
}
CRASH = r"crash|worst|fall|fell|drop|panic|plunge|collapse|tank|bad"
BEST = r"best|boom|rally|recover|surge|soar|rise|rose|gain|good"
FEAR = r"fear|scary|scared|afraid|vix|volatil"
TOGETHER = r"together|connected|correlat|in sync|diversif"
# Advice = asking what to do or what will happen (not just mentioning "investment banks")
ADVICE = (r"\bshould (i|we|you)\b|\bwould you (buy|sell|invest)|\bworth buying\b|\bgood (investment|buy|time to)"
          r"|\brecommend|\bprice target|\bpredict|\bforecast|\bwhat (stock|stocks|shares) (to|should)"
          r"|\bwill [\w\s]+ (go up|go down|rise|fall|crash)|\b(buy|sell) (now|today|it)\b")

NO_ADVICE = ("Market Worlds is for exploring market history, not for investment advice. "
             "Try asking about a past event, like 'When did banks crash?'")
UNSURE = "I couldn't work that out. Try 'worst week for Energy in 2020'."


def is_advice(q):
    return re.search(ADVICE, q.lower()) is not None


class Asker:
    def __init__(self, world, tours, gather, template):
        self.world, self.tours, self.gather, self.template = world, tours, gather, template
        self.dates = world["dates"]
        self.name = world.get("meta", {}).get("name", "United States")
        self.fear = world.get("meta", {}).get("fearLabel", "VIX")
        self.sectors = {s["name"]: s for s in world["sectors"]}
        self.stocks = {s["ticker"]: s for s in world["stocks"]}
        self.context = self._build_context()

    # ── context for the LLM ──
    def _top(self, values, k=10, reverse=False):
        idx = [i for i, v in enumerate(values) if v is not None]
        idx.sort(key=lambda i: values[i], reverse=reverse)
        return [[self.dates[i], round(values[i], 4)] for i in idx[:k]]

    def _build_context(self):
        m = self.world["market"]
        ctx = {
            "market": self.name,
            "companies": {t: s.get("name", t) for t, s in self.stocks.items()},
            "date_range": [self.dates[0], self.dates[-1]],
            "sectors": {n: s["tickers"] for n, s in self.sectors.items()},
            "market_worst_weeks": self._top(m["ret"]),
            "market_best_weeks": self._top(m["ret"], reverse=True),
            "highest_vix_weeks": self._top(m["vix"], reverse=True),
            "highest_correlation_weeks": self._top(m["avgCorr"], reverse=True),
            "sector_worst_weeks": {n: self._top(s["ret"]) for n, s in self.sectors.items()},
            "sector_best_weeks": {n: self._top(s["ret"], reverse=True) for n, s in self.sectors.items()},
            "events": [[t["date"], t["title"]] for t in self.tours],
        }
        return json.dumps(ctx, separators=(",", ":"))

    def prompt(self, question):
        return (
            f"You are the guide of Market Worlds, a planet built from {self.name} stock market data "
            f"(weekly returns as fractions, e.g. -0.199 = -19.9%; market fear = {self.fear}).\n"
            f"Context (the only data you may use):\n{self.context}\n\n"
            f"Question: {question}\n\n"
            "Reply with JSON only, no other text: "
            '{"week": "YYYY-MM-DD or null", "focus": "market | <sector name> | <ticker>", '
            '"answer": "2-3 sentences"}.\n'
            "Choose the week from the context dates where possible. Use only numbers from the context. "
            "If unsure, say so and set week to null. Never give investment advice."
        )

    # ── validation ──
    def snap_week(self, s):
        """Nearest week index to an ISO date string, or None if outside the data range."""
        try:
            d = date.fromisoformat(str(s)[:10])
        except ValueError:
            return None
        first, last = date.fromisoformat(self.dates[0]), date.fromisoformat(self.dates[-1])
        if (d - first).days < -7 or (d - last).days > 7:
            return None
        return min(range(len(self.dates)), key=lambda i: abs((date.fromisoformat(self.dates[i]) - d).days))

    def clean_focus(self, f):
        if isinstance(f, str):
            f = f.strip()
            for name in self.sectors:
                if f.lower() == name.lower():
                    return name
            if f.upper() in self.stocks:
                return f.upper()
        return "market"

    def facts(self, week, focus):
        ticker = focus if focus in self.stocks else None
        sector = focus if focus in self.sectors else None
        return self.gather(ticker, sector, week)

    def respond(self, week, focus, answer, source):
        subject, facts = self.facts(week, focus) if week is not None else (None, None)
        return {"weekIndex": week, "date": self.dates[week] if week is not None else None,
                "focus": focus, "answer": answer, "source": source, "facts": facts}

    def from_llm(self, raw):
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            raise ValueError("no JSON in reply")
        obj = json.loads(m.group(0))
        week = self.snap_week(obj.get("week")) if obj.get("week") else None
        focus = self.clean_focus(obj.get("focus"))
        answer = str(obj.get("answer") or "").strip()[:600]
        if week is None or not answer:
            raise ValueError("no usable week/answer")
        return self.respond(week, focus, answer, "ai")

    # ── keyword fallback (mirrored in ask.js) ──
    def fallback(self, question):
        q = question.lower()
        year_m = re.search(r"\b(20[0-2]\d)\b", q)
        year = int(year_m.group(1)) if year_m and 2007 <= int(year_m.group(1)) <= 2026 else None
        month = next((i + 1 for i, mn in enumerate(MONTHS) if mn in q or re.search(rf"\b{mn[:3]}\b", q)), None)
        focus = "market"
        for t, s in self.stocks.items():                     # ticker or company name in this market
            word = COMPANY_WORDS.get(t) or s.get("name", "").lower()
            if re.search(rf"\b{re.escape(t.lower())}\b", q) or (len(word) > 2 and word in q):
                focus = t
        for name, words in SECTOR_WORDS.items():
            if focus == "market" and any(re.search(rf"\b{w}\b", q) for w in words):
                focus = name
        # Named events
        if "covid" in q or "pandemic" in q:
            year = year or 2020
        if "lehman" in q or "financial crisis" in q or "great recession" in q:
            year = year or 2008
        if re.search(r"\bai\b", q):
            focus = ("NVDA" if "NVDA" in self.stocks else "Technology") if focus == "market" else focus
            year = year or 2023

        m = self.world["market"]
        if re.search(FEAR, q):
            kind, series, best = "fear", m["vix"], True
        elif re.search(TOGETHER, q):
            kind, series, best = "together", m["avgCorr"], True
        elif re.search(BEST, q):
            kind, best = "best", True
            series = self._series(focus)
        elif re.search(CRASH, q) or "covid" in q or "lehman" in q:
            kind, best = "worst", False
            series = self._series(focus)
        else:
            return self.respond(None, "market", UNSURE, "fallback")

        idx = [i for i, v in enumerate(series) if v is not None
               and (year is None or self.dates[i].startswith(str(year)))
               and (month is None or int(self.dates[i][5:7]) == month)]
        if not idx:
            return self.respond(None, "market", UNSURE, "fallback")
        week = (max if best else min)(idx, key=lambda i: series[i])
        if kind in ("fear", "together"):
            focus = "market"
        subject, facts = self.facts(week, focus)
        fmt = lambda v, f: "n/a" if v is None else format(v, f)
        where = f" in {year}" if year else ""
        if kind == "fear":
            lead = f"Market fear peaked in the week of {self.dates[week]} ({self.fear} {fmt(m['vix'][week], '.0f')})."
        elif kind == "together":
            lead = (f"Sectors moved most closely together in the week of {self.dates[week]} "
                    f"(average correlation {fmt(m['avgCorr'][week], '.2f')}).")
        else:
            lead = f"The {kind} week for {subject}{where} was the week of {self.dates[week]}."
        return self.respond(week, focus, f"{lead} {self.template(subject, facts)}", "fallback")

    def _series(self, focus):
        if focus in self.stocks:
            return self.stocks[focus]["ret"]
        if focus in self.sectors:
            return self.sectors[focus]["ret"]
        return self.world["market"]["ret"]
