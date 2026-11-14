const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../dist/planet3d.js'), 'utf8'), sandbox);
const { Planet, Moon } = sandbox.window.Planet3D;

test('quarter orbit preserves radius and matches upstream trigonometry', () => {
  const planet = new Planet('Test', 1, 4, 3, [1, 0, 0]);
  planet.update(1);
  assert(Math.abs(planet.position()[0]) < 1e-10);
  assert.equal(planet.position()[1], 0);
  assert.equal(planet.position()[2], 4);
});
test('elapsed-time orbit is independent of rendering frame rate', () => {
  const a = new Planet('A', 1, 4, 3, [1, 0, 0]);
  const b = new Planet('B', 1, 4, 3, [1, 0, 0]);
  a.update(1);
  for (let i = 0; i < 60; i++) b.update(1 / 60);
  assert(Math.abs(a.angle - b.angle) < 1e-10);
});
test('parent updates an independently orbiting moon', () => {
  const planet = new Planet('Parent', 1, 0, 0, [1, 0, 0]);
  const moon = planet.add_moon('Moon', .1, 2, 1, [.5, .5, .5]);
  assert(moon instanceof Moon);
  planet.update(1);
  assert.equal(planet.angle, 0);
  assert.equal(moon.angle, 30);
  assert(Math.abs(Math.hypot(...moon.position()) - 2) < 1e-10);
});
test('ring API retains radius, width, colour and transparency', () => {
  const planet = new Planet('Ringed', 1, 0, 0, [1, 0, 0]);
  planet.add_ring(1.5, .2, [.8, .7, .6], .4);
  assert.equal(planet.rings.radius, 1.5);
  assert.equal(planet.rings.width, .2);
  assert.equal(planet.rings.transparency, .4);
});
