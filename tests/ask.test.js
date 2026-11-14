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

// Free-form questions the matcher now understands (no backend, no API key)
const more = [
  ['tell me about apple', 'AAPL'],
  ['which company grew the most?', 'NVDA'],
  ['svb', 'Financials'],
  ['oil price war', 'Energy'],
  ['how did boeing do', 'BA'],
];
for (const [q, focus] of more) {
  test(`free-form: ${q}`, () => {
    const r = localAnswer(q, us);
    assert.equal(r.focus, focus);
    assert.ok(r.weekIndex != null && !r.help);
  });
}

test('an exact date goes to the week that contains it', () => {
  assert.equal(localAnswer('what happened on 16 march 2020', us).date, '2020-03-20');
});

test('mentioning investment banks is not treated as an advice request', () => {
  const r = localAnswer('When did investment banks crash?', us);
  assert.equal(r.focus, 'Financials');
  assert.equal(r.date, '2008-10-10');
});

test('companies not on the planet and unmatched questions get help, not a dead end', () => {
  assert.match(localAnswer('what about tesla?', us).answer, /isn't one of the 30 companies/);
  const r = localAnswer('what is the meaning of life', us);
  assert.equal(r.help, true);
  assert.equal(r.weekIndex, null);
});

test('best week inside a crisis explains the rebound and the distance from the peak', () => {
  const r = localAnswer('Best week for NVIDIA', us);
  assert.equal(r.date, '2008-10-31');
  assert.match(r.answer, /rebound in the middle of a crisis/);
  assert.match(r.answer, /below its earlier peak/);
});

test('best and worst calendar years', () => {
  const best = localAnswer('Best year for NVIDIA', us);
  assert.equal(best.focus, 'NVDA');
  assert.ok(best.date.startsWith('2023'));
  assert.match(best.answer, /best calendar year for NVIDIA was 2023/);
  assert.ok(localAnswer('worst year for the market', us).date.startsWith('2008'));
});
