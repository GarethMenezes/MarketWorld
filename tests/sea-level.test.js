import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEA_CONFIG, seaLevelFromCorrelation, seaDropFraction } from '../sea-level.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10,
  `Expected ${actual} to be close to ${expected}`);
const world = JSON.parse(readFileSync(new URL('../public/markets/us/world.json', import.meta.url), 'utf8'));
const correlationAt = (date) => {
  const index = world.dates.indexOf(date);
  assert.notEqual(index, -1, `Missing reference date ${date}`);
  return world.market.avgCorr[index];
};

test('normal and lowest levels clamp at the configured correlation bounds', () => {
  for (const correlation of [-1, 0, SEA_CONFIG.corrLow]) {
    assert.equal(seaLevelFromCorrelation(correlation), SEA_CONFIG.normal);
  }
  for (const correlation of [SEA_CONFIG.corrHigh, 1, 2]) {
    assert.equal(seaLevelFromCorrelation(correlation), SEA_CONFIG.lowest);
  }
  close(seaLevelFromCorrelation((SEA_CONFIG.corrLow + SEA_CONFIG.corrHigh) / 2), -0.0325);
});

test('sea level falls monotonically and its displayed fraction rises as correlation rises', () => {
  let previousLevel = Infinity;
  let previousDrop = -Infinity;
  for (let step = 0; step <= 200; step++) {
    const level = seaLevelFromCorrelation(-1 + step / 100);
    const drop = seaDropFraction(level);
    assert.ok(level <= previousLevel + 1e-12);
    assert.ok(drop >= previousDrop - 1e-12);
    assert.ok(drop >= 0 && drop <= 1);
    previousLevel = level;
    previousDrop = drop;
  }
});

test('missing, nonnumeric and nonfinite inputs never masquerade as calm data', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity, '0.5', '', false, true, {}]) {
    assert.equal(seaLevelFromCorrelation(value), null);
    assert.equal(seaDropFraction(value), null);
  }
});

test('drop fractions clamp correctly and both helpers respect custom bounds', () => {
  assert.equal(seaDropFraction(1), 0);
  assert.equal(seaDropFraction(SEA_CONFIG.normal), 0);
  assert.equal(seaDropFraction(SEA_CONFIG.lowest), 1);
  assert.equal(seaDropFraction(-1), 1);
  const config = { corrLow: 0.2, corrHigh: 0.8, normal: 2, lowest: -2 };
  close(seaLevelFromCorrelation(0.5, config), 0);
  close(seaDropFraction(0, config), 0.5);
});

test('committed calm, intermediate and crisis weeks produce the expected visual fall', () => {
  assert.equal(seaDropFraction(seaLevelFromCorrelation(correlationAt('2017-10-27'))), 0);
  close(seaDropFraction(seaLevelFromCorrelation(correlationAt('2007-06-29'))), 0.273 / 0.55);
  close(seaDropFraction(seaLevelFromCorrelation(correlationAt('2008-10-10'))), 0.473 / 0.55);
  assert.equal(seaDropFraction(seaLevelFromCorrelation(correlationAt('2020-03-20'))), 1);
});

test('the first six weeks have no correlation target, even after visiting a crisis', () => {
  assert.equal(seaLevelFromCorrelation(correlationAt('2020-03-20')), SEA_CONFIG.lowest);
  for (const date of ['2007-01-05', '2007-01-12', '2007-01-19', '2007-01-26', '2007-02-02', '2007-02-09']) {
    assert.equal(correlationAt(date), null);
    assert.equal(seaLevelFromCorrelation(correlationAt(date)), null);
  }
});
