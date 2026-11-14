"""Market Worlds backend: AI "explorer's log" for a stock or sector in a given week.

Run:   uvicorn server.app:app --reload --port 8000
Env:   ANTHROPIC_API_KEY  (optional; without it a template sentence is returned)
       LLM_MODEL          (default claude-sonnet-5-5)

The server looks numbers up in the market's world file itself (public/markets.json lists
them; US = public/world.json); it never trusts numbers from the client. It must never return an error to the demo: any failure falls back
to a template built from the same numbers.
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel

PUBLIC = Path(__file__).parent.parent / "public"


class MarketData:
    """One planet's data (one market)."""
    def __init__(self, world):
        self.world = world
        self.meta = world.get("meta", {"id": "us", "name": "United States", "fearLabel": "VIX"})
        self.dates = world["dates"]
        self.stocks = {s["ticker"]: s for s in world["stocks"]}
        self.sectors = {s["name"]: s for s in world["sectors"]}
        self.market = world["market"]


_index = json.loads((PUBLIC / "markets.json").read_text()) if (PUBLIC / "markets.json").exists() \
    else [{"id": "us", "world": "world.json"}]
MARKETS = {m["id"]: MarketData(json.loads((PUBLIC / m["world"]).read_text(encoding="utf-8")))
           for m in _index if (PUBLIC / m["world"]).exists()}
US = MARKETS.get("us") or next(iter(MARKETS.values()))
WORLD = US.world                     # kept for the US-only helpers (tours)


def market_for(mid):
    return MARKETS.get(mid or "us", US)

MODEL = os.environ.get("LLM_MODEL", "claude-sonnet-5-5")
TIMEOUT_S = 8
_pool = ThreadPoolExecutor(max_workers=4)
_cache: dict[tuple, dict] = {}

app = FastAPI(title="Market Worlds")


class ExplainRequest(BaseModel):
    ticker: str | None = None
    sector: str | None = None
    week: int
    market: str = "us"


# ───────────── numbers ─────────────
def pct(x):
    return "n/a" if x is None else f"{x * 100:+.1f}%"


def fear_label(vix):
    if vix is None:
        return "unknown"
    return ("calm" if vix < 15 else "normal" if vix < 20 else "nervous" if vix < 30
            else "stressed" if vix < 40 else "crisis level")


def gather(ticker, sector, week, event=None, mk=None):
    """Collect the facts for this week from the market's data. Returns (subject, facts dict)."""
    mk = mk or US
    DATES, STOCKS, SECTORS, MARKET = mk.dates, mk.stocks, mk.sectors, mk.market
    week = max(0, min(len(DATES) - 1, week))
    facts = {
        "market": mk.meta.get("name", "United States"),
        "week_ending": DATES[week],
        **({"known_as": event} if event else {}),
        "market_weekly_return": pct(MARKET["ret"][week]),
        "fear_measure": mk.meta.get("fearLabel", "VIX"),
        "vix": MARKET["vix"][week],
        "vix_mood": fear_label(MARKET["vix"][week]),
        "avg_sector_correlation": MARKET["avgCorr"][week],
    }
    if ticker in STOCKS:
        s = STOCKS[ticker]
        sec = SECTORS[s["sector"]]
        g = s["growth"][week]
        facts.update({
            "ticker": ticker,
            "company": s.get("name", ticker),
            "sector": s["sector"],
            "weekly_return": pct(s["ret"][week]),
            "growth_since_2007": None if g is None else f"x{g:.2f}",
            "annualised_volatility": None if s["vol"][week] is None else f"{s['vol'][week] * 100:.0f}%",
            "trading_volume_vs_normal": s["relVolume"][week],
            "sector_weekly_return": pct(sec["ret"][week]),
        })
        return s.get("name", ticker) if s.get("name") and s.get("name") != ticker else ticker, facts
    if sector in SECTORS:
        sec = SECTORS[sector]
        facts.update({
            "sector": sector,
            "companies": sec["tickers"],
            "sector_weekly_return": pct(sec["ret"][week]),
            "sector_volatility": None if sec["vol"][week] is None else f"{sec['vol'][week] * 100:.0f}%",
        })
        return f"the {sector} sector", facts
    return "the market", facts


def template(subject, f):
    """Fallback explanation built only from the numbers."""
    own = f.get("weekly_return") or f.get("sector_weekly_return") or f["market_weekly_return"]
    verb = "rose" if own.startswith("+") else "fell" if own.startswith("-") else "was flat"
    move = f"{verb} {own.lstrip('+-')}" if verb != "was flat" else verb
    vix = f["vix"]
    corr = f["avg_sector_correlation"]
    s1 = f"In the week of {f['week_ending']}, {subject} {move}"
    s1 += "." if subject == "the market" else f", while the whole market moved {f['market_weekly_return']}."
    label = f.get("fear_measure", "VIX")
    s2 = (f"Market fear was {f['vix_mood']} ({label} {vix:.0f})." if vix is not None else "")
    if corr is not None:
        s3 = ("Sectors were moving almost in lockstep, so diversification offered little shelter."
              if corr > 0.75 else
              "Sectors were moving fairly independently." if corr < 0.35 else
              "Sectors were partly moving together.")
    else:
        s3 = ""
    return " ".join(x for x in (s1, s2, s3) if x)


# ───────────── LLM (swap provider here) ─────────────
PROMPT = """You are a guide on a planet built from stock market data. In 3 short sentences, explain what was happening to {subject} in the week ending {date}, using ONLY these numbers:
{numbers}
If "known_as" is given, that is what the week is remembered for; you may name it but add no other facts. Relate it to the wider market mood (VIX = market fear, average sector correlation = how much sectors move together). If the numbers don't show why it moved, say so. Do not invent news or events. Never give investment advice."""


def call_llm(prompt: str) -> str:
    import anthropic
    client = anthropic.Anthropic(timeout=TIMEOUT_S, max_retries=0)
    kwargs = {}
    if MODEL == "claude-sonnet-5-5":
        # Server-side fallback if the model declines; routes by refusal category.
        kwargs = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
    resp = client.beta.messages.create(
        model=MODEL,
        max_tokens=1024,
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": prompt}],
        **kwargs,
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("model declined")
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    if not text:
        raise RuntimeError("empty response")
    return text


def explain(ticker, sector, week, event=None, market="us"):
    """event: optional name of the week (tours only, written by us, never by the client)."""
    mk = market_for(market)
    key = (mk.meta.get("id"), ticker, sector, week, event)
    if key in _cache:
        return _cache[key]
    subject, facts = gather(ticker, sector, week, event, mk)
    fallback = template(subject, facts)
    result = {"text": fallback, "source": "template", "facts": facts}
    if os.environ.get("ANTHROPIC_API_KEY"):
        prompt = PROMPT.format(subject=subject, date=facts["week_ending"],
                               numbers=json.dumps(facts, indent=1))
        try:
            text = _pool.submit(call_llm, prompt).result(timeout=TIMEOUT_S)
            result = {"text": text, "source": "ai", "facts": facts}
        except FutureTimeout:
            print(f"LLM timeout for {key}; using template")
        except Exception as e:  # never surface errors to the demo
            print(f"LLM failed for {key}: {type(e).__name__}: {e}")
    if result["source"] == "ai":  # only cache real answers, so a later retry can succeed
        _cache[key] = result
    return result


@app.post("/api/explain")
def api_explain(req: ExplainRequest):
    return explain(req.ticker, req.sector, req.week, market=req.market)


# ───────────── Ask the planet ─────────────
from server.ask import Asker, NO_ADVICE, is_advice  # noqa: E402

_tours_path = Path(__file__).parent.parent / "public" / "tours.json"
TOURS = json.loads(_tours_path.read_text(encoding="utf-8")) if _tours_path.exists() else []
# One asker per market; tours (US events and narrations) only for the US planet
ASKERS = {mid: Asker(mk.world, TOURS if mid == "us" else [],
                     (lambda t, s, w, _mk=mk: gather(t, s, w, None, _mk)), template)
          for mid, mk in MARKETS.items()}
_ask_cache: dict[str, dict] = {}


class AskRequest(BaseModel):
    question: str
    market: str = "us"


@app.post("/api/ask")
def api_ask(req: AskRequest):
    q = req.question.strip()[:300]
    ASKER = ASKERS.get(req.market) or ASKERS.get("us") or next(iter(ASKERS.values()))
    key = f"{req.market}|{q.lower()}"
    if key in _ask_cache:
        return _ask_cache[key]
    if not q:
        return ASKER.respond(None, "market", "Ask me about a week in market history.", "fallback")
    if is_advice(q):  # never ask the LLM for advice
        return ASKER.respond(None, "market", NO_ADVICE, "fallback")
    result = None
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            raw = _pool.submit(call_llm, ASKER.prompt(q)).result(timeout=TIMEOUT_S)
            result = ASKER.from_llm(raw)
        except FutureTimeout:
            print(f"ask: LLM timeout for {q!r}; using keyword fallback")
        except Exception as e:  # invalid JSON, bad week, API error → fallback, never an error
            print(f"ask: LLM failed for {q!r}: {type(e).__name__}: {e}")
    if result is None:
        result = ASKER.fallback(q)
    _ask_cache[key] = result
    return result


@app.get("/api/health")
def health():
    return {"ok": True, "model": MODEL, "ai": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "markets": list(MARKETS)}
