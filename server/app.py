"""Market Worlds backend: AI "explorer's log" for a stock or sector in a given week.

Run:   uvicorn server.app:app --reload --port 8000
Env:   ANTHROPIC_API_KEY  (optional; without it a template sentence is returned)
       LLM_MODEL          (default claude-sonnet-5-5)

The server looks numbers up in public/world.json itself; it never trusts numbers
from the client. It must never return an error to the demo: any failure falls back
to a template built from the same numbers.
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel

WORLD = json.loads((Path(__file__).parent.parent / "public" / "world.json").read_text())
DATES = WORLD["dates"]
STOCKS = {s["ticker"]: s for s in WORLD["stocks"]}
SECTORS = {s["name"]: s for s in WORLD["sectors"]}
MARKET = WORLD["market"]

MODEL = os.environ.get("LLM_MODEL", "claude-sonnet-5-5")
TIMEOUT_S = 8
_pool = ThreadPoolExecutor(max_workers=4)
_cache: dict[tuple, dict] = {}

app = FastAPI(title="Market Worlds")


class ExplainRequest(BaseModel):
    ticker: str | None = None
    sector: str | None = None
    week: int


# ───────────── numbers ─────────────
def pct(x):
    return "n/a" if x is None else f"{x * 100:+.1f}%"


def fear_label(vix):
    if vix is None:
        return "unknown"
    return ("calm" if vix < 15 else "normal" if vix < 20 else "nervous" if vix < 30
            else "stressed" if vix < 40 else "crisis level")


def gather(ticker, sector, week):
    """Collect the facts for this week from world.json. Returns (subject, facts dict)."""
    week = max(0, min(len(DATES) - 1, week))
    facts = {
        "week_ending": DATES[week],
        "market_weekly_return": pct(MARKET["ret"][week]),
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
            "sector": s["sector"],
            "weekly_return": pct(s["ret"][week]),
            "growth_since_2007": None if g is None else f"x{g:.2f}",
            "annualised_volatility": None if s["vol"][week] is None else f"{s['vol'][week] * 100:.0f}%",
            "trading_volume_vs_normal": s["relVolume"][week],
            "sector_weekly_return": pct(sec["ret"][week]),
        })
        return ticker, facts
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
    s2 = (f"Market fear was {f['vix_mood']} (VIX {vix:.0f})." if vix is not None else "")
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
Relate it to the wider market mood (VIX = market fear, average sector correlation = how much sectors move together). If the numbers don't show why it moved, say so. Do not invent news or events. Never give investment advice."""


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


def explain(ticker, sector, week):
    key = (ticker, sector, week)
    if key in _cache:
        return _cache[key]
    subject, facts = gather(ticker, sector, week)
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
    return explain(req.ticker, req.sector, req.week)


@app.get("/api/health")
def health():
    return {"ok": True, "model": MODEL, "ai": bool(os.environ.get("ANTHROPIC_API_KEY"))}
