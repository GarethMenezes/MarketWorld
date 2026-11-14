"""Sanity-check public/world.json. Usage: python check_world.py"""
import json
from pathlib import Path

world = json.loads((Path(__file__).parent / "public" / "world.json").read_text())
dates, m = world["dates"], world["market"]


def top(values, k=5, reverse=True):
    idx = [i for i, v in enumerate(values) if v is not None]
    idx.sort(key=lambda i: values[i], reverse=reverse)
    return [(dates[i], values[i]) for i in idx[:k]]


print(f"Weeks: {len(dates)}   first: {dates[0]}   last: {dates[-1]}")
print(f"Sectors: {[s['name'] for s in world['sectors']]}")
print(f"Stocks: {len(world['stocks'])}")
for label, key, rev in [("highest VIX", "vix", True),
                        ("highest avgCorr", "avgCorr", True),
                        ("worst market.ret", "ret", False)]:
    print(f"\nTop 5 {label}:")
    for d, v in top(m[key], reverse=rev):
        print(f"  {d}  {v}")

for key in ["vix", "avgCorr", "ret"]:
    vals = [v for v in m[key] if v is not None]
    vals.sort()
    q = lambda p: vals[int(p * (len(vals) - 1))]
    print(f"\n{key}: min {vals[0]}  p10 {q(.1)}  median {q(.5)}  p90 {q(.9)}  max {vals[-1]}")

bad = [s["ticker"] for s in world["stocks"]
       if all(v is None for v in s["growth"])]
print("\nAll-null stocks:", bad or "none")
lens = {len(a) for s in world["stocks"] for a in (s["growth"], s["ret"], s["vol"], s["relVolume"])}
lens |= {len(m[k]) for k in m}
print("Array lengths consistent:", lens == {len(dates)})
