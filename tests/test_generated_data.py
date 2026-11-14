"""Validate committed offline market files, not live provider availability."""
import json
import math
from collections import Counter
from pathlib import Path
import unittest

PUBLIC = Path(__file__).resolve().parents[1] / 'public'


class OfflineData(unittest.TestCase):
    def test_three_market_manifest_and_uk_aliases(self):
        manifest = json.loads((PUBLIC / 'markets.json').read_text())
        self.assertEqual(manifest['default'], 'uk')
        self.assertEqual({market['id'] for market in manifest['markets']}, {'uk', 'us', 'asia'})
        for name in ['world.json', 'stress.json', 'tours.json']:
            self.assertEqual((PUBLIC / name).read_bytes(), (PUBLIC / 'markets' / 'uk' / name).read_bytes())

    def test_world_and_model_contracts_for_every_market(self):
        for market_id in ['uk', 'us', 'asia']:
            with self.subTest(market=market_id):
                base = PUBLIC / 'markets' / market_id
                world = json.loads((base / 'world.json').read_text())
                stress = json.loads((base / 'stress.json').read_text())
                count = len(world['dates'])
                self.assertEqual(world['dates'], sorted(set(world['dates'])))
                self.assertEqual(world['marketInfo']['id'], market_id)
                names = [sector['name'] for sector in world['sectors']]
                self.assertEqual(names, stress['sectors'])
                self.assertEqual(len(names), 6)
                for sector in world['sectors']:
                    self.assertGreater(len(sector['tickers']), 0)
                    self.assertEqual(len(sector['ret']), count)
                    self.assertEqual(len(sector['vol']), count)
                for stock in world['stocks']:
                    self.assertTrue(stock['name'])
                    self.assertIn(stock['sector'], names)
                    for key in ['growth', 'ret', 'vol', 'relVolume']:
                        self.assertEqual(len(stock[key]), count)
                        self.assertTrue(all(value is None or math.isfinite(value) for value in stock[key]))
                for key in ['ret', 'vix', 'avgCorr']:
                    self.assertEqual(len(world['market'][key]), count)
                self.assertEqual(len(world['market']['pairCorr']), 15)
                for values in world['market']['pairCorr'].values():
                    self.assertEqual(len(values), count)
                for regime in stress['regimes'].values():
                    self.assertGreaterEqual(regime['days'], stress['minimumPairDays'])
                    for shocked in names:
                        self.assertEqual(regime['beta'][shocked][shocked], 1.)
                        for affected in names:
                            beta = regime['beta'][shocked][affected]
                            corr = regime['corr'][shocked][affected]
                            self.assertTrue(beta is None or math.isfinite(beta))
                            self.assertTrue(corr is None or -1 <= corr <= 1)
                            if beta is not None:
                                self.assertGreaterEqual(regime['pairDays'][shocked][affected], stress['minimumPairDays'])
                self.assertTrue(all(stop['date'] in world['dates'] for stop in json.loads((base / 'tours.json').read_text())))
                counts = Counter(event['week'] for event in world['shocks'])
                self.assertTrue(all(number <= 3 for number in counts.values()))
                for event in world['shocks']:
                    self.assertIn(event['sector'], names)
                    self.assertLessEqual(event['date'], world['dates'][event['week']])
                    self.assertLessEqual(event['ret'], -.04 if event['kind'] == 'market' else -.07)
                    self.assertLessEqual(event['sectorRet'], 0)


if __name__ == '__main__':
    unittest.main()
