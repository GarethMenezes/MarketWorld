import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { predictMoves, headline } from '../sandbox.js';

const stress = JSON.parse(readFileSync(new URL('../public/stress.json', import.meta.url)));

test('the shocked sector moves by exactly the shock; others are clamped to ±100%', () => {
  for (const regime of ['calm', 'crisis']) {
    const moves = predictMoves(stress, regime, 'Energy', -0.3);
    assert.equal(moves.Energy, -0.3);
    for (const v of Object.values(moves)) assert.ok(v >= -1 && v <= 1);
  }
});

test('the same shock spreads further in a crisis than in calm times (US data)', () => {
  const calm = predictMoves(stress, 'calm', 'Energy', -0.3);
  const crisis = predictMoves(stress, 'crisis', 'Energy', -0.3);
  const spread = (m) => Object.entries(m).filter(([s]) => s !== 'Energy').reduce((a, [, v]) => a + Math.abs(v), 0);
  assert.ok(spread(crisis) > spread(calm));
});

test('headline is computed from the data and uses the right article', () => {
  const h = headline(stress, 'Energy', -0.3);
  assert.match(h, /^An Energy −30% shock drags \w+ −\d+% in calm times, (but|and) −\d+% in a crisis\.$/);
});
