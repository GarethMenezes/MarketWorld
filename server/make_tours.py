"""Pre-generate tour narrations into public/tours.json so tours work offline.

Usage:  python -m server.make_tours          (set ANTHROPIC_API_KEY for AI text;
                                             without it, data summaries are written)
Re-run after setting a key to replace template narrations with AI ones.
"""
import json
from pathlib import Path

from server.app import DATES, SECTORS, STOCKS, explain

TOURS = Path(__file__).parent.parent / "public" / "tours.json"


def main():
    tours = json.loads(TOURS.read_text())
    for t in tours:
        week = next(i for i, d in enumerate(DATES) if d >= t["date"])
        t["date"] = DATES[week]  # snap to the matching trading week
        focus = t["focus"]
        ticker = focus if focus in STOCKS else None
        sector = focus if focus in SECTORS else None
        if t.get("narrationSource") == "ai":
            continue  # keep existing AI narration
        res = explain(ticker, sector, week, event=t["title"])
        t["narration"] = res["text"]
        t["narrationSource"] = res["source"]
        print(f"{t['date']}  {t['title']:32s} [{res['source']}] {res['text'][:70]}...")
    TOURS.write_text(json.dumps(tours, indent=2) + "\n")


if __name__ == "__main__":
    main()
