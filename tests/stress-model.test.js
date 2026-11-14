import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateShock, compareShockRegimes } from '../stress-model.js';

const sample = {
  sectors: ['Energy', 'Technology', 'Healthcare', 'Missing'],
  regimes: {
    calm: { beta: { Energy: { Energy: 0.5, Technology: 0.2, Healthcare: -0.1, Missing: null } } },
    crisis: { beta: { Energy: { Energy: 2, Technology: 0.8, Healthcare: 8, Missing: null } } },
  },
};
const bySector = (rows, sector) => rows.find((row) => row.sector === sector);

test('the shocked sector moves exactly by the requested shock, independent of its diagonal beta', () => {
  for (const regime of ['calm', 'crisis']) assert.equal(bySector(simulateShock(sample, 'Energy', -0.3, regime), 'Energy').move, -0.3);
});
test('effects use historical beta, preserve sign and clamp only the resulting moves', () => {
  const calm = simulateShock(sample, 'Energy', -0.3, 'calm');
  assert.equal(bySector(calm, 'Technology').move, -0.06);
  assert.equal(bySector(calm, 'Healthcare').move, 0.03);
  assert.equal(bySector(simulateShock(sample, 'Energy', -0.3, 'crisis'), 'Healthcare').move, -1);
  assert.equal(bySector(simulateShock(sample, 'Energy', 0.2, 'crisis'), 'Healthcare').move, 1);
});
test('missing coefficients remain unavailable and sort after available results', () => {
  const rows = simulateShock(sample, 'Energy', -0.3, 'calm');
  assert.deepEqual(rows.at(-1), { sector: 'Missing', beta: null, move: null, available: false });
  const missing = simulateShock(sample, 'Energy', -0.3, 'unknown');
  assert.equal(missing.filter((row) => row.available).length, 1);
});
test('unknown sectors and invalid shocks do not silently create results', () => {
  assert.deepEqual(simulateShock(sample, 'Unknown', -0.3, 'calm'), []);
  for (const shock of [null, undefined, NaN, Infinity, '0.3', -1.01, 1.01]) assert.deepEqual(simulateShock(sample, 'Energy', shock, 'calm'), []);
});
test('comparison text comes from both matrices and reports insufficient data honestly', () => {
  const text = compareShockRegimes(sample, 'Energy', -0.3);
  assert.match(text, /Healthcare \+3% in calm times and −100% in a crisis/);
  assert.match(compareShockRegimes({ sectors: ['Energy'], regimes: {} }, 'Energy', -0.3), /not enough historical data/);
});
