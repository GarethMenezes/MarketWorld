import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localAnswer } from '../ask.js';

const us = JSON.parse(readFileSync(new URL('../public/world.json', import.meta.url)));

// The spec's "done when" questions, answered with no backend and no API key
const cases = [
  ['When did banks crash?', '2008-10-10', 'Financials'],
  ['Show me the COVID crash', '2020-03-20', 'market'],
  ['When was fear highest?', '2008-10-24', 'market'],
  ['Show me the AI boom', '2023-05-26', 'NVDA'],
];
for (const [q, date, focus] of cases) {
  test(`fallback: ${q}`, () => {
    const r = localAnswer(q, us);
    assert.equal(r.date, date);
    assert.equal(r.focus, focus);
    assert.equal(r.source, 'fallback');
  });
}

test('investment-advice questions get the fixed no-advice reply', () => {
  const r = localAnswer('Should I buy Apple?', us);
  assert.equal(r.weekIndex, null);
  assert.match(r.answer, /not for investment advice/);
});

test('worst week for Energy in 2020 stays inside 2020', () => {
  const r = localAnswer('Worst week for Energy in 2020', us);
  assert.equal(r.focus, 'Energy');
  assert.ok(r.date.startsWith('2020'));
});
