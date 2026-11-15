import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePickHit } from '../picking.js';
const hit = (userData, distance, visible = true) => ({ object: { userData, visible }, distance });
test('company geometry wins over the invisible sector surface', () => {
  const sector = hit({ sector: 'Energy' }, 8), company = hit({ ticker: 'SHEL.L' }, 8.1);
  assert.equal(choosePickHit([sector, company], 8), company);
});
test('hidden and far-side companies cannot steal a sector click', () => {
  const sector = hit({ sector: 'Energy' }, 8);
  assert.equal(choosePickHit([hit({ ticker: 'BP.L' }, 12), hit({ ticker: 'SHEL.L' }, 7, false), sector], 8), sector);
  assert.equal(choosePickHit([hit({ ticker: 'BP.L', companyMesh: { visible: false } }, 7)], 8), undefined);
});
test('craters, neighbor planets and empty space remain selectable as before', () => {
  const sector = hit({ sector: 'Energy' }, 8), crater = hit({ crater: {} }, 8.05);
  assert.equal(choosePickHit([sector, crater], 8), crater);
  const planet = hit({ marketId: 'asia' }, 20);
  assert.equal(choosePickHit([planet], 8), planet);
  assert.equal(choosePickHit([], Infinity), undefined);
});
