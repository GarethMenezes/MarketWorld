"""Checks on the committed, offline data files for every market planet.

Run: python -m unittest discover tests
"""
import json
import unittest
from pathlib import Path

PUBLIC = Path(__file__).resolve().parents[1] / "public"
SECTORS = ["Technology", "Financials", "Energy", "Healthcare", "Consumer", "Industrials"]


def load(name):
    return json.loads((PUBLIC / name).read_text(encoding="utf-8"))


class GeneratedData(unittest.TestCase):
    def test_manifest_lists_three_markets_with_files(self):
        markets = load("markets.json")
        self.assertEqual({m["id"] for m in markets}, {"us", "uk", "asia"})
        for m in markets:
            for key in ("world", "stress", "tours"):
                self.assertTrue((PUBLIC / m[key]).exists(), f"{m['id']}: missing {m[key]}")

    def test_every_array_has_one_value_per_week(self):
        for m in load("markets.json"):
            w = load(m["world"])
            n = len(w["dates"])
            self.assertEqual([s["name"] for s in w["sectors"]], SECTORS)
            self.assertEqual(len(w["stocks"]), 30, m["id"])
            for s in w["stocks"]:
                for key in ("growth", "ret", "vol", "relVolume"):
                    self.assertEqual(len(s[key]), n, f"{m['id']} {s['ticker']} {key}")
            for key in ("ret", "vix", "avgCorr"):
                self.assertEqual(len(w["market"][key]), n)
            self.assertEqual(len(w["market"]["pairCorr"]), 15)

    def test_shocks_point_at_real_weeks_and_are_drops(self):
        for m in load("markets.json"):
            w = load(m["world"])
            per_week = {}
            for sh in w["shocks"]:
                self.assertTrue(0 <= sh["week"] < len(w["dates"]))
                self.assertLess(sh["ret"], 0)
                self.assertIn(sh["sector"], SECTORS)
                per_week[sh["week"]] = per_week.get(sh["week"], 0) + 1
            self.assertLessEqual(max(per_week.values()), 3, m["id"])

    def test_stress_betas_cover_every_pair_and_crisis_spreads_further(self):
        for m in load("markets.json"):
            st = load(m["stress"])
            self.assertEqual(st["sectors"], SECTORS)
            for regime in ("calm", "crisis"):
                for i in SECTORS:
                    self.assertEqual(set(st["regimes"][regime]["beta"][i]), set(SECTORS))
            avg = lambda r: sum(st["regimes"][r]["beta"][i][j] for i in SECTORS for j in SECTORS if i != j)
            self.assertGreater(avg("crisis"), avg("calm"), m["id"])

    def test_tour_dates_exist_in_the_data(self):
        for m in load("markets.json"):
            dates = set(load(m["world"])["dates"])
            for stop in load(m["tours"]):
                self.assertIn(stop["date"], dates, f"{m['id']}: {stop['title']}")


if __name__ == "__main__":
    unittest.main()
