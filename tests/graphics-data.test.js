import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOceanPalette } from '../ocean-palette.js';

// From Gareth's tests: the ocean palette runs from the shallow to the deep reference colour
test('ocean palette preserves shallow and deep reference colours with opaque alpha', () => {
  const p = buildOceanPalette(512);
  assert.deepEqual([...p.slice(0, 4)], [169, 220, 240, 255]);
  assert.deepEqual([...p.slice(-4)], [14, 51, 88, 255]);
  for (let i = 4; i < p.length; i += 4) {
    assert.equal(p[i + 3], 255);
    for (let c = 0; c < 3; c++) assert.ok(p[i + c] <= p[i - 4 + c]);
  }
});
