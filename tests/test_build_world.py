"""Small constructed fixtures test the math; production files use Yahoo observations only."""
import unittest
import numpy as np
import pandas as pd
from build_world import build_stress, build_shocks, prepare


class DataModels(unittest.TestCase):
    def test_beta_direction_and_regime_split(self):
        index = pd.bdate_range('2020-01-01', periods=60)
        x = np.tile(np.linspace(-.025, .025, 30), 2)
        y = np.concatenate([x[:30] * .2, x[30:] * .8])
        sectors = pd.DataFrame({'Energy': x, 'Technology': y}, index=index)
        vix = pd.Series([15.] * 30 + [40.] * 30, index=index)
        stress = build_stress(sectors, vix)
        self.assertEqual(stress['regimes']['calm']['days'], 30)
        self.assertEqual(stress['regimes']['crisis']['days'], 30)
        self.assertAlmostEqual(stress['regimes']['calm']['beta']['Energy']['Technology'], .2)
        self.assertAlmostEqual(stress['regimes']['crisis']['beta']['Energy']['Technology'], .8)
        self.assertAlmostEqual(stress['regimes']['calm']['beta']['Technology']['Energy'], 5.)
        self.assertEqual(stress['regimes']['calm']['beta']['Energy']['Energy'], 1.)

    def test_missing_pair_variance_and_neutral_vix_are_not_invented(self):
        index = pd.bdate_range('2020-01-01', periods=60)
        sectors = pd.DataFrame({'Energy': np.linspace(-.03, .03, 60), 'Constant': 0., 'Missing': np.nan}, index=index)
        vix = pd.Series([15.] * 25 + [20.] * 5 + [30.] * 5 + [40.] * 25, index=index)
        result = build_stress(sectors, vix)
        self.assertEqual(result['regimes']['calm']['days'], 25)
        self.assertEqual(result['regimes']['crisis']['days'], 25)
        self.assertIsNone(result['regimes']['calm']['beta']['Constant']['Energy'])
        self.assertIsNone(result['regimes']['crisis']['beta']['Energy']['Missing'])
        self.assertIsNone(result['regimes']['calm']['corr']['Energy']['Constant'])
        self.assertEqual(result['regimes']['calm']['pairDays']['Energy']['Missing'], 0)

    def test_holidays_use_observed_returns_without_inventing_zero_days(self):
        index = pd.bdate_range('2020-01-01', periods=30)
        a = pd.Series(np.arange(100., 130.), index=index)
        b = pd.Series(np.arange(200., 230.), index=index)
        b.iloc[10] = np.nan
        close = pd.DataFrame({'A': a, 'B': b, '^VIX': 15.})
        volume = close * 0 + 1000
        _, _, returns, _, _ = prepare(close, volume, {'Energy': ['A'], 'Technology': ['B']})
        self.assertTrue(pd.isna(returns.loc[index[10], 'B']))
        self.assertAlmostEqual(returns.loc[index[11], 'B'], 211. / 209. - 1.)

    def test_shocks_map_to_friday_prioritise_market_and_cap_three_per_week(self):
        index = pd.to_datetime(['2020-03-16', '2020-03-17', '2020-03-18', '2020-03-19', '2020-03-20', '2020-03-23'])
        daily = pd.DataFrame({'A': [-.10, -.09, -.08, -.07, -.06, -.08],
                              'B': [-.10, -.09, -.08, -.07, -.06, .10]}, index=index)
        sectors = pd.DataFrame({'Energy': daily.A, 'Technology': daily.B}, index=index)
        shocks = build_shocks(daily, sectors, ['A', 'B'], pd.to_datetime(['2020-03-20', '2020-03-27']))
        self.assertEqual(len(shocks), 4)
        self.assertEqual([event['date'] for event in shocks[:3]], ['2020-03-16', '2020-03-17', '2020-03-18'])
        self.assertTrue(all(event['kind'] == 'market' and event['week'] == 0 for event in shocks[:3]))
        self.assertEqual(shocks[-1], {'kind': 'sector', 'ret': -.08, 'sector': 'Energy', 'sectorRet': -.08, 'date': '2020-03-23', 'week': 1})


if __name__ == '__main__':
    unittest.main()
