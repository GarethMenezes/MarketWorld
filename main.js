// Market Worlds — the stock market as a planet.
// Every visual is driven by a number in public/world.json (see CLAUDE.md, section 1).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import planetFragment from './shaders/planet.frag.glsl?raw';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { createSandbox } from './sandbox.js';
import { createAsk } from './ask.js';
import { createMeteors } from './meteors.js';
import { createAudio } from './audio.js';
import { buildOceanPalette } from './ocean-palette.js';
import { choosePickHit } from './picking.js';

// ───────────────────────────── TUNABLE VALUES ─────────────────────────────
// Tuned on real data 2007–2026 (see check_world.py output).
const CONFIG = {
  planetRadius: 5,

  // Mountain height = growth since 2007 on a log scale:
  //   h = base + perDecade * log10(growth), clamped, then * worldScale
  height: { base: 0.6, perDecade: 0.7, min: 0.12, max: 3, worldScale: 0.3 },

  // Mountain colour: t = weeklyReturn * colorSensitivity, clamped to [-1, 1]
  //   -1 red · 0 yellow · +1 green.  20 → a 5% weekly move is full colour.
  colorSensitivity: 20,
  glow: { base: 0.12, perMove: 1.4 },          // emissive = base + perMove * |t|

  // Sea level from average sector correlation (30-day window). Continents stay fixed.
  //   fall = (corr - corrLow) / (corrHigh - corrLow), clamped; level = normal + fall * (lowest - normal)
  //   ≤ 0.3 → normal sea · ≥ 0.85 → lowest: wide salt-flat shelves around every coast
  //   2017 ≈ 0.13 · Oct 2008 ≈ 0.77 · Mar 2020 ≈ 0.86   (levels in shader altitude units)
  sea: { corrLow: 0.3, corrHigh: 0.85, normal: 0, lowest: -0.065, seconds: 1.2 },

  // Weather from VIX: storm = (vix - vixCalm) / vixRange, clamped to [0, 1]
  //   VIX 13 → clear blue sky · VIX 58+ → red sky, thick dark clouds
  storm: { vixCalm: 13, vixRange: 45 },
  clouds: { calm: 0.25, storm: 0.6 },           // cloud coverage at storm 0 and 1
  lightningVix: 40,                             // lightning flashes above this VIX

  quakeRet: -0.07,                              // earthquake if market weekly return below this
  weekMs: 120,                                  // playback speed: ms per trading week
  smoothing: 4,                                 // higher = visuals follow data faster
  autoRotateSpeed: 0.35,
  tour: { flySeconds: 2, marketDistance: 15, focusDistance: 11 },

  // Render resolution: as sharp as the 60 fps budget allows on integrated graphics.
  maxPixelRatio: 1.75,      // Intel Arc iGPU, crisis week, 3 planets: 2x 18.4 ms · 1.75x 14.7 ms · 1.5x 13.6 ms
  planetLight: 1.5,         // sun strength in the planet shader (Gareth's was 3 with his own tone mapping)
};

const SECTOR_COLORS = {
  Technology: '#a27bff',   // violet
  Financials: '#2fbf8f',   // emerald
  Energy: '#d9822b',       // orange-brown
  Healthcare: '#e0609e',   // pink
  Consumer: '#e8c547',     // gold
  Industrials: '#7aa83a',  // olive
};

// ───────────────────────────── MARKET (which planet) ─────────────────────────────
// ?market=us|uk|asia picks the planet. public/markets.json (built by build_world.py) lists
// each market's data files. Each market also gets its own look, so the planets differ.
const PLANET_LOOKS = {
  us:   { seed: 0,    spin: 0,   atmo: '#4aa8ff', waterDeep: [0.02, 0.05, 0.10], waterSurface: [0.05, 0.16, 0.30], cloudsCalm: 0.25 },
  uk:   { seed: 11.3, spin: 1.1, atmo: '#8cc2e0', waterDeep: [0.02, 0.06, 0.08], waterSurface: [0.06, 0.17, 0.22], cloudsCalm: 0.42 },
  asia: { seed: 23.7, spin: 2.4, atmo: '#55d0ff', waterDeep: [0.01, 0.06, 0.09], waterSurface: [0.03, 0.21, 0.29], cloudsCalm: 0.22 },
};
const MARKET_ID = new URLSearchParams(location.search).get('market') || 'us';
const MARKETS = await fetch('/markets.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
const MARKET = MARKETS.find((m) => m.id === MARKET_ID) ?? MARKETS.find((m) => m.id === 'us')
  ?? { id: 'us', name: 'United States', short: 'US', world: 'world.json', stress: 'stress.json', fearLabel: 'VIX' };
const LOOK = PLANET_LOOKS[MARKET.id] ?? PLANET_LOOKS.us;
CONFIG.clouds.calm = LOOK.cloudsCalm;

// ───────────────────────────── SETUP ─────────────────────────────
const R = CONFIG.planetRadius;
const canvas = document.getElementById('scene');
// antialias off: the bloom composer renders to its own targets, so MSAA here would be wasted work
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
// The canvas lives in the left column (Gareth's layout), so size everything from it
const viewSize = () => [Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight)];
renderer.setSize(...viewSize(), false);
// HTML labels (tickers, sector names) drawn over the canvas
const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });
labelRenderer.setSize(...viewSize());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const SKY_CALM = new THREE.Color('#000000');
const SKY_STORM = new THREE.Color('#120203');
scene.background = SKY_CALM.clone();

const camera = new THREE.PerspectiveCamera(45, viewSize()[0] / viewSize()[1], 0.1, 500);
camera.position.set(0, 3.2, 15); // planet fills the view

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 7;
controls.maxDistance = 35;
controls.autoRotate = true;
controls.autoRotateSpeed = CONFIG.autoRotateSpeed;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(...viewSize()), 0.45, 0.22, 0.95) // tight bloom: glow without haze;
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Lights (atmosphere only)
const sunDir = new THREE.Vector3(1, 0.5, 0.8).normalize();
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.position.copy(sunDir).multiplyScalar(50);
scene.add(sun);
const ambient = new THREE.HemisphereLight('#9fb8ff', '#1a1020', 0.2); // low: a real night side
scene.add(ambient);

// World group: everything that shakes in an earthquake
const world = new THREE.Group();
scene.add(world);

// ───────────────────────────── NOISE (terrain) ─────────────────────────────
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
function fbm3(x, y, z, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x, y, z); norm += amp;
    x *= 2.03; y *= 2.03; z *= 2.03; amp *= 0.5;
  }
  return sum / norm;
}

// ───────────────────────────── ATMOSPHERE (pure decoration + VIX colour) ─────────────────────────────
// Starfield: many faint stars, fewer bright ones, slightly varied colours, denser along a band
function makeStars(n, size, brightness) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const v = new THREE.Vector3(), c = new THREE.Color();
  const band = new THREE.Vector3(0.3, 1, 0.2).normalize();
  for (let i = 0; i < n; i++) {
    v.randomDirection();
    if (i % 3 === 0) v.addScaledVector(band, -v.dot(band) * 0.85).normalize(); // galactic band
    v.multiplyScalar(150 + Math.random() * 100);
    pos.set([v.x, v.y, v.z], i * 3);
    c.setHSL(0.55 + (Math.random() - 0.5) * 0.25, 0.35, brightness * (0.6 + Math.random() * 0.4));
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, sizeAttenuation: true }));
}
scene.add(makeStars(6000, 0.35, 0.55), makeStars(500, 0.8, 0.95));

const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 16),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3.5) }));
sunGlow.position.copy(sunDir).multiplyScalar(140);
scene.add(sunGlow);

// Planet surface, ocean, clouds, atmosphere and volcanoes: Julien Sulpis' realtime planet
// shader as adapted by Gareth (GPL-3.0, see NOTICES.md), driven by market data below.
// Drawn on a back-faced sphere big enough to hold the atmosphere and ash plumes; the
// shader ray-traces the real planet and writes depth so mesh mountains sit on it.
function makeOceanPalette() {
  const size = 512;
  const tex = new THREE.DataTexture(buildOceanPalette(size), size, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
function makeNoiseTexture() {
  const size = 32, bytes = new Uint8Array(size ** 3);
  let seed = 74777; // deterministic, same as Gareth's version
  for (let i = 0; i < bytes.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; bytes[i] = seed >>> 24; }
  const tex = new THREE.Data3DTexture(bytes, size, size, size);
  tex.format = THREE.RedFormat;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
const ATMO_CALM = new THREE.Color(LOOK.atmo);
const ATMO_STORM = new THREE.Color('#ff4a2a');
const planetUniforms = {
  uTime: { value: 0 },
  uPlanetPosition: { value: new THREE.Vector3() },
  uWorldRadius: { value: R },
  uSunDirection: { value: sunDir },
  uNoiseTexture: { value: makeNoiseTexture() },
  uQuality: { value: 2 },
  uProjection: { value: camera.projectionMatrix },
  uNoiseStrength: { value: 0.17 },
  uTerrainScale: { value: 0.8 },
  uCloudsDensity: { value: 0.3 },
  uCloudsScale: { value: 1 },
  uCloudsSpeed: { value: 1.4 },
  uAtmosphereColor: { value: ATMO_CALM.clone() },
  uAtmosphereDensity: { value: 0.3 },
  uSunIntensity: { value: 3 },
  uAmbientLight: { value: 0.055 },
  uStorm: { value: 0 }, uEruption: { value: 0 }, uFlash: { value: 0 }, uStress: { value: 0 },
  uWaterDeep: { value: new THREE.Color(...LOOK.waterDeep) },
  uWaterSurface: { value: new THREE.Color(...LOOK.waterSurface) },
  uWorldSeed: { value: LOOK.seed },
  uOceanPalette: { value: makeOceanPalette() },   // depth colours (Gareth, Sea Level Explorer stops)
  uShowReferenceCoast: { value: 1 },             // normal shoreline marked when the sea falls
  uRockColor: { value: new THREE.Color(0.32, 0.29, 0.26) },
  uAccent: { value: ATMO_CALM.clone() },
  uContinentDir: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, 0, 1)) },
  uContinentRot: { value: Array.from({ length: 6 }, () => new THREE.Matrix3()) },
  uContinentColor: { value: Array.from({ length: 6 }, () => new THREE.Color()) },
  uContinentCap: { value: 0.45 },
  uSeaLevel: { value: 0 },
  uStressTint: { value: new Float32Array(6) },
  uVentDir: { value: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)] },
};
const planet = new THREE.Mesh(new THREE.SphereGeometry(R * 1.85, 48, 32), new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: planetUniforms,
  vertexShader: `out vec3 vWorldPos;
    void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
  // Three only gives projectionMatrix to vertex shaders; the fragment needs it for gl_FragDepth
  fragmentShader: planetFragment.replace('projectionMatrix * viewMatrix', 'uProjection * viewMatrix')
    .replace('uniform vec3 uVentDir[2];', 'uniform vec3 uVentDir[2];\nuniform mat4 uProjection;'),
  side: THREE.BackSide,
  depthWrite: true,
  // premultiplied: planet pixels replace the background, atmosphere/ash glow adds over space
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
}));
planet.renderOrder = -1; // draw first; mountains and stars depth-test against its surface
planet.frustumCulled = false;
world.add(planet);

// ───────────────────────────── CONTINENTS (sectors) ─────────────────────────────
const CAP = 0.45;          // continent angular radius (radians)
const RINGS = 14, SEGS = 56;
const Z = new THREE.Vector3(0, 0, 1);

// Coastline radius at azimuth theta (seamless noise around a circle)
function coastRadius(theta, seed) {
  return CAP * (0.7 + 0.45 * fbm3(Math.cos(theta) * 1.3 + seed, Math.sin(theta) * 1.3, seed * 0.7, 3));
}
// Ground elevation above sea level at a local direction; f = 0 centre .. 1 coast
function groundElevation(dir, f, seed) {
  const n = fbm3(dir.x * 2.4 + seed, dir.y * 2.4, dir.z * 2.4 - seed, 4);
  return 0.012 + (1 - f * f) * (0.05 + 0.12 * n) - 0.03 * f ** 4;
}
// Direction in the continent's local frame (centre = +Z)
function localDir(angle, theta, out) {
  const s = Math.sin(angle);
  return out.set(s * Math.cos(theta), s * Math.sin(theta), Math.cos(angle));
}

function makeContinentGeometry(seed, tint, lift) {
  const pos = [], col = [], idx = [];
  const d = new THREE.Vector3(), c = new THREE.Color();
  const sand = new THREE.Color('#d9c68f'), rock = new THREE.Color('#7b6f63'), snow = new THREE.Color('#f2f4f8');
  const grass = new THREE.Color('#3f7d3a').lerp(new THREE.Color(tint), 0.55);
  const push = (angle, theta, f) => {
    localDir(angle, theta, d);
    const e = groundElevation(d, f, seed) + lift;
    pos.push(d.x * (R + e), d.y * (R + e), d.z * (R + e));
    const h = e - lift;
    if (h < 0.025) c.copy(sand);
    else if (h < 0.11) c.copy(grass).lerp(rock, (h - 0.025) / 0.17);
    else c.copy(rock).lerp(snow, Math.min(1, (h - 0.11) / 0.06));
    col.push(c.r, c.g, c.b);
  };
  push(0, 0, 0); // centre vertex
  for (let i = 1; i <= RINGS; i++) {
    const f = i / RINGS;
    for (let j = 0; j < SEGS; j++) {
      const theta = (j / SEGS) * Math.PI * 2;
      push(coastRadius(theta, seed) * f, theta, f);
    }
  }
  for (let j = 0; j < SEGS; j++) idx.push(0, 1 + j, 1 + ((j + 1) % SEGS));
  for (let i = 1; i < RINGS; i++) {
    const a0 = 1 + (i - 1) * SEGS, a1 = 1 + i * SEGS;
    for (let j = 0; j < SEGS; j++) {
      const jn = (j + 1) % SEGS;
      idx.push(a0 + j, a1 + j, a1 + jn, a0 + j, a1 + jn, a0 + jn);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Realistic mountain: ridged fractal noise on a radial profile, rock/scree/snow vertex
// colours, smooth normals. Base at y=0, peak at y=1 (scaled by the data), skirt below ground.
const MOUNTAIN_RADIUS = 0.42;
function makeMountainGeometry(seed) {
  const RINGS = 26, SEGS = 72;
  const pos = [], col = [], idx = [];
  const rock = new THREE.Color('#8a7663'), scree = new THREE.Color('#4b3c31'), snow = new THREE.Color('#f1f3f6');
  const c = new THREE.Color();
  // Ridged multifractal (Musgrave): each octave is weighted by the one before, so sharp
  // ridges and gullies form along the crests — the classic procedural-terrain look.
  const ridgedMF = (x, z) => {
    let sum = 0, amp = 0.55, f = 2.6, w = 1;
    for (let o = 0; o < 5; o++) {
      let n = 1 - Math.abs(noise3(x * f + seed, z * f - seed, seed * 0.31 + o * 7.7) * 2 - 1);
      n *= n * w;
      w = Math.min(1, n * 1.8);
      sum += n * amp;
      f *= 2.1; amp *= 0.5;
    }
    return sum;
  };
  const h = (r, th) => {
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const dome = Math.pow(Math.max(0, 1 - r * r), 1.25);   // broad massif, not a cone
    return dome * (0.18 + ridgedMF(x, z)) + dome * dome * 0.25;  // central summit stays highest
  };
  const heights = [];
  heights.push(h(0, 0));
  for (let i = 1; i <= RINGS; i++) for (let j = 0; j < SEGS; j++) heights.push(h(i / RINGS, (j / SEGS) * Math.PI * 2));
  const peak = Math.max(...heights);
  const push = (r, th, y) => {
    const ny = y / peak;
    pos.push(Math.cos(th) * r * MOUNTAIN_RADIUS, ny, Math.sin(th) * r * MOUNTAIN_RADIUS);
    const n = fbm3(Math.cos(th) * r * 6 + seed, ny * 4, Math.sin(th) * r * 6, 2);
    if (ny > 0.68 + (n - 0.5) * 0.25) c.copy(snow);
    else c.copy(scree).lerp(rock, Math.min(1, ny * 1.4 + (n - 0.5) * 0.4));
    col.push(c.r, c.g, c.b);
  };
  push(0, 0, heights[0]);
  let k = 1;
  for (let i = 1; i <= RINGS; i++) for (let j = 0; j < SEGS; j++) push(i / RINGS, (j / SEGS) * Math.PI * 2, heights[k++]);
  for (let j = 0; j < SEGS; j++) push(1.08, (j / SEGS) * Math.PI * 2, -0.25 * peak); // skirt into the ground
  for (let j = 0; j < SEGS; j++) idx.push(0, 1 + ((j + 1) % SEGS), 1 + j);
  for (let i = 1; i <= RINGS; i++) {
    const a0 = 1 + (i - 1) * SEGS, a1 = 1 + i * SEGS;
    for (let j = 0; j < SEGS; j++) {
      const jn = (j + 1) % SEGS;
      idx.push(a0 + j, a0 + jn, a1 + j, a0 + jn, a1 + jn, a1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Glowing ring at each mountain's foot: colour = this week's return (red/yellow/green)
const footRingGeometry = new THREE.RingGeometry(MOUNTAIN_RADIUS * 1.0, MOUNTAIN_RADIUS * 1.14, 48).rotateX(-Math.PI / 2);

// Company names for labels and the info card
const COMPANY_US = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOGL: 'Alphabet', ORCL: 'Oracle',
  JPM: 'JPMorgan Chase', BAC: 'Bank of America', GS: 'Goldman Sachs', MS: 'Morgan Stanley', WFC: 'Wells Fargo',
  XOM: 'ExxonMobil', CVX: 'Chevron', COP: 'ConocoPhillips', SLB: 'SLB', OXY: 'Occidental',
  JNJ: 'Johnson & Johnson', PFE: 'Pfizer', UNH: 'UnitedHealth', MRK: 'Merck', ABT: 'Abbott',
  AMZN: 'Amazon', WMT: 'Walmart', KO: 'Coca-Cola', PG: 'Procter & Gamble', MCD: "McDonald's",
  CAT: 'Caterpillar', BA: 'Boeing', DE: 'Deere', UPS: 'UPS', LMT: 'Lockheed Martin',
};
function makeLabel(text, cls, title) {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  if (title) el.title = title;
  return new CSS2DObject(el);
}

// ───────────────────────────── DATA → WORLD ─────────────────────────────
const data = await fetch(`/${MARKET.world}`).then((r) => r.json());
// Company names: from the data (every market), falling back to the US list
const COMPANY = Object.fromEntries(data.stocks.map((s) => [s.ticker, s.name ?? COMPANY_US[s.ticker] ?? s.ticker]));
const FEAR = data.meta?.fearLabel ?? MARKET.fearLabel ?? 'VIX';
// 'What if?' sandbox betas (optional file; the button hides if it is missing)
const stress = await fetch(`/${MARKET.stress ?? 'stress.json'}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
let tours = []; // filled in the GUIDED TOURS section; declared early so key handlers never hit it uninitialised
const N = data.dates.length;
const stockIndex = Object.fromEntries(data.stocks.map((s) => [s.ticker, s]));

// Fixed continents (no drift) on the six directions of an octahedron, rotated so the default
// view looks at the point between Technology, Financials and Energy.
const VIEW_DIR = new THREE.Vector3(0, 3.2, 15).normalize();
const qTilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 1, 1).normalize(), VIEW_DIR)
  .premultiply(new THREE.Quaternion().setFromAxisAngle(VIEW_DIR, LOOK.spin));   // each market: its own layout
const PLATE_DIRS = [[0, 0, 1], [1, 0, 0], [0, 1, 0], [0, 0, -1], [-1, 0, 0], [0, -1, 0]]
  .map((v) => new THREE.Vector3(...v).applyQuaternion(qTilt));
const continents = data.sectors.map((sector, i) => {
  const seed = i * 13.7 + 3.1;
  const tint = SECTOR_COLORS[sector.name] || '#88aa66';
  const group = new THREE.Group();
  // Invisible pick target: the planet shader draws the land, this mesh only answers clicks
  const land = new THREE.Mesh(makeContinentGeometry(seed, tint, i * 0.004),
    new THREE.MeshBasicMaterial({ visible: false }));
  planetUniforms.uContinentColor.value[i].set(tint);
  const sectorLabel = makeLabel(sector.name, 'sec');
  sectorLabel.position.set(0, 0, R + 0.25); // continent centre (mountains ring around it)
  group.add(sectorLabel);
  land.userData.sector = sector.name;
  group.add(land);
  group.quaternion.setFromUnitVectors(Z, PLATE_DIRS[i % 6]);
  world.add(group);

  // Mountains: one per company, arranged on a small ring around the continent centre
  const mountains = sector.tickers.map((ticker, k) => {
    const theta = (k / sector.tickers.length) * Math.PI * 2 + i;
    const angle = 0.17 + 0.03 * hash3(k, i, 1);
    const d = localDir(angle, theta, new THREE.Vector3());
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0,
      emissive: '#000000', emissiveIntensity: 1 });
    const mesh = new THREE.Mesh(makeMountainGeometry(k * 7.3 + i * 31.1), mat);
    const ring = new THREE.Mesh(footRingGeometry, new THREE.MeshBasicMaterial({
      color: '#ffd23a', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.copy(d).multiplyScalar(R + 0.012);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    group.add(ring);
    // US: tickers are familiar; other markets: company names ("7203.T" means nothing to most people)
    const label = makeLabel(MARKET.id === 'us' ? ticker : COMPANY[ticker], 'tk', `${COMPANY[ticker]} (${ticker})`);
    label.position.set(0, 1.08, 0); // just above the peak; follows the mountain's height
    mesh.add(label);
    mesh.position.copy(d).multiplyScalar(R - 0.02); // shader surface is a sphere of radius R
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    mesh.userData = { ticker, sector: sector.name, stock: stockIndex[ticker], height: 0.2, targetHeight: 0.2, ring, label,
      color: new THREE.Color('#888888'), targetColor: new THREE.Color('#888888'), glow: 0, targetGlow: 0 };
    ring.userData = { ticker, sector: sector.name, companyMesh: mesh };
    mesh.scale.set(1, 0.2, 1);
    group.add(mesh);
    return mesh;
  });
  return { sector, group, land, mountains, sectorLabel };
});
const allMountains = continents.flatMap((c) => c.mountains);
const pickables = [...allMountains, ...allMountains.map((m) => m.userData.ring), ...continents.map((c) => c.land)]; // craters are added below

// ───────────────────────────── MAPPINGS (data → visual targets) ─────────────────────────────
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const RED = new THREE.Color('#ff3030'), YELLOW = new THREE.Color('#ffd23a'), GREEN = new THREE.Color('#2fe36a');
const GREY = new THREE.Color('#777777');
const WHITE = new THREE.Color('#ffffff');

function heightFromGrowth(g) { // log scale: ×10 growth adds perDecade
  const h = CONFIG.height;
  return Math.min(h.max, Math.max(h.min, h.base + h.perDecade * Math.log10(g))) * h.worldScale;
}
function colorFromReturn(ret, out) {
  const t = Math.max(-1, Math.min(1, ret * CONFIG.colorSensitivity));
  return t < 0 ? out.copy(YELLOW).lerp(RED, -t) : out.copy(YELLOW).lerp(GREEN, t);
}
const stormFromVix = (vix) => clamp01((vix - CONFIG.storm.vixCalm) / CONFIG.storm.vixRange);
const seaFromCorr = (c) => CONFIG.sea.normal +
  clamp01((c - CONFIG.sea.corrLow) / (CONFIG.sea.corrHigh - CONFIG.sea.corrLow)) * (CONFIG.sea.lowest - CONFIG.sea.normal);
const SECTOR_NAMES = data.sectors.map((x) => x.name);
function pairCorrAt(a, b, i) {
  const pc = data.market.pairCorr || {};
  const arr = pc[`${SECTOR_NAMES[a]}|${SECTOR_NAMES[b]}`] || pc[`${SECTOR_NAMES[b]}|${SECTOR_NAMES[a]}`];
  return arr ? arr[i] : null;
}

// Meteor strikes for shock days (world.json "shocks"); sound hooks are attached later
const meteorHooks = { launch: null, impact: null };
const audio = createAudio();      // sound: muted until the speaker button is clicked
const meteors = createMeteors({
  world, R, plateDirs: PLATE_DIRS, sectorNames: SECTOR_NAMES, shocks: data.shocks || [],
  onLaunch: (size) => meteorHooks.launch?.(size), onImpact: (size) => meteorHooks.impact?.(size),
});

pickables.unshift(...meteors.craters);

// Smoothed world state (follows the data targets)
const state = {
  week: 0, playing: false, acc: 0,
  storm: 0, targetStorm: 0,
  sea: 0, targetSea: 0,
  sandbox: false, sandboxWeek: 0, stressTarget: new Float32Array(6),
  quake: 0, flash: 0, vix: 15,
  eruption: 0, targetEruption: 0, vents: [0, 1],
  selected: null,
  touring: false, tourStop: 0, rotationPaused: false,
};

function setWeek(i, { quake = true } = {}) {
  if (state.sandbox) return;            // the 'What if?' sandbox freezes the timeline
  i = Math.max(0, Math.min(N - 1, i));
  const prev = state.week;
  state.week = i;
  const m = data.market;
  if (m.vix[i] != null) { state.vix = m.vix[i]; state.targetStorm = stormFromVix(m.vix[i]); }
  if (m.avgCorr[i] != null) state.targetSea = seaFromCorr(m.avgCorr[i]);
  if (quake && i !== prev && m.ret[i] != null && m.ret[i] < CONFIG.quakeRet) {
    state.quake = Math.max(state.quake, Math.min(1, m.ret[i] / -0.15));
    audio.quake(Math.min(1, m.ret[i] / -0.15));
  }
  // Volcanoes erupt in crash weeks, on the two sectors that fell hardest this week
  const r = m.ret[i];
  state.targetEruption = r != null && r < CONFIG.quakeRet
    ? 0.55 + 0.45 * clamp01((CONFIG.quakeRet - r) / 0.08) : 0;
  state.vents = data.sectors.map((sec, k) => [sec.ret[i] ?? 0, k]).sort((a, b) => a[0] - b[0]).slice(0, 2).map((x) => x[1]);
  for (const mesh of allMountains) {
    const u = mesh.userData, s = u.stock;
    const g = s ? s.growth[i] : null;
    mesh.visible = g != null;              // before listing: no mountain
    if (g == null) continue;
    u.targetHeight = heightFromGrowth(g);
    const r = s.ret[i];
    if (r == null) { u.targetColor.copy(GREY); u.targetGlow = 0; }
    else {
      colorFromReturn(r, u.targetColor);
      u.targetGlow = CONFIG.glow.base + CONFIG.glow.perMove * Math.min(1, Math.abs(r * CONFIG.colorSensitivity));
    }
  }
  // Meteors only animate on single forward steps of playback; jumps just show the craters
  meteors.onWeek(i, state.playing && i === prev + 1);
  updateStatsPanel();
  updateInfoPanel();
  if (i !== prev) requestExplanation();
  slider.value = String(i);
  sliderDate.textContent = fmtDate(data.dates[i]).toUpperCase();
  if (document.activeElement !== $('jumpDate')) $('jumpDate').value = data.dates[i];
  updateNeighbors?.(i);
}

// ───────────────────────────── UI ─────────────────────────────
const $ = (id) => document.getElementById(id);
const slider = $('slider'), sliderDate = $('sliderDate'), playBtn = $('play');
slider.max = String(N - 1);
$('weekTotal').textContent = String(N);
const ticks = [];
for (let y = 2007; y <= Number(data.dates[N - 1].slice(0, 4)); y += 2) {
  const w = data.dates.findIndex((d) => d >= `${y}-01-01`);
  if (w === -1) continue;
  const b = document.createElement('button');
  b.textContent = String(y);
  b.style.left = `${(w / (N - 1)) * 100}%`;
  b.addEventListener('click', () => { setPlaying(false); setWeek(w); });
  $('ticks').appendChild(b);
  ticks.push([w, b]);
}
function markTick(i) {
  let cur = null;
  for (const [w, b] of ticks) if (w <= i) cur = b;
  for (const [, b] of ticks) b.classList.toggle('current', b === cur);
}
const pct = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
const cls = (x) => (x == null ? '' : x > 0 ? 'up' : x < 0 ? 'down' : '');
// Nearest week to an ISO date (Gareth): snaps both ways and clamps outside the data range
function nearestWeek(dates, date) {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) return 0;
  let index = 0, best = Infinity;
  dates.forEach((d, i) => { const gap = Math.abs(Date.parse(`${d}T12:00:00Z`) - t); if (gap < best) { best = gap; index = i; } });
  return index;
}
const fmtDate = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB',
  { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function vixLabel(v) {
  if (v == null) return '';
  if (v < 15) return 'calm';
  if (v < 20) return 'normal';
  if (v < 30) return 'nervous';
  if (v < 40) return 'stressed';
  return 'panic';
}
function corrLabel(c) {
  if (c == null) return '';
  if (c <= CONFIG.sea.corrLow) return 'normal';
  if (c < 0.6) return 'falling';
  if (c < CONFIG.sea.corrHigh) return 'low · shores drying';
  return 'lowest · one landmass';
}

// Card headline and phase come straight from the numbers (no invented narrative)
function weekStory(i) {
  const m = data.market, v = m.vix[i], c = m.avgCorr[i], r = m.ret[i];
  if (r != null && r < CONFIG.quakeRet) return { phase: 'Crash week', risk: true, world: 'The erupting world', headline: 'The ground gives way.' };
  if (v != null && v >= 40) return { phase: 'Panic', risk: true, world: 'The storm world', headline: 'Fear everywhere.' };
  if (c != null && c > 0.75) return { phase: 'Everything moves together', risk: true, world: 'The low-tide world', headline: 'No place to hide.' };
  if (v != null && v >= 25) return { phase: 'Stressed', risk: true, world: 'The restless world', headline: 'Clouds gathering.' };
  if (c != null && c < 0.35) return { phase: 'Calm', risk: false, world: 'The open world', headline: 'Every sector on its own path.' };
  return { phase: 'Normal', risk: false, world: 'The steady world', headline: 'Business as usual.' };
}

function updateStatsPanel() {
  const i = state.week, m = data.market;
  const story = weekStory(i);
  $('date').textContent = fmtDate(data.dates[i]);
  $('phase').textContent = story.phase;
  $('phase').classList.toggle('risk', story.risk);
  $('headline').textContent = story.headline;
  $('planetTag').textContent = story.world;
  $('planetTag').classList.toggle('risk', story.risk);
  $('weekNo').textContent = String(i + 1).padStart(4, '0');
  $('counter').textContent = `week ${i + 1} / ${N}`;
  $('weather').innerHTML = `<span class="dot"></span> ${m.vix[i] == null ? '—' : `${vixLabel(m.vix[i])} skies · ${FEAR} ${m.vix[i].toFixed(0)}`}`;
  $('weather').classList.toggle('risk', story.risk);
  markTick(i);
  $('vix').textContent = m.vix[i] == null ? '—' : `${m.vix[i].toFixed(1)} · ${vixLabel(m.vix[i])}`;
  $('fearK').textContent = `Fear (${FEAR})`;
  $('corr').textContent = m.avgCorr[i] == null ? '—' : `${corrLabel(m.avgCorr[i])} · corr ${m.avgCorr[i].toFixed(2)}`;
  const drop = m.avgCorr[i] == null ? null : clamp01((m.avgCorr[i] - CONFIG.sea.corrLow) / (CONFIG.sea.corrHigh - CONFIG.sea.corrLow));
  $('seaDrop').textContent = drop == null ? 'No correlation data · normal sea shown' : `Sea drop: ${Math.round(drop * 100)}% of the visual range`;
  $('seaMeter').value = drop == null ? 0 : Math.round(drop * 100);
  $('mret').innerHTML = `<span class="${cls(m.ret[i])}">${pct(m.ret[i])}</span>`;
  const notes = [];
  if (m.ret[i] != null && m.ret[i] < CONFIG.quakeRet) notes.push('Earthquake: crash week');
  if (m.vix[i] != null && m.vix[i] > CONFIG.lightningVix) notes.push('Lightning: extreme fear');
  if (m.avgCorr[i] != null && m.avgCorr[i] > 0.75) notes.push('Low tide: sectors fall together, diversification failing');
  $('mood').textContent = notes.join(' · ');
}

function row(k, v) { return `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`; }

function updateInfoPanel() {
  const sel = state.selected;
  if (!sel) { $('info').style.display = 'none'; return; }
  const i = state.week;
  $('info').style.display = 'block';
  if (sel.crater) {                       // meteor crater: the shock day
    const c = sel.crater;
    $('infoTitle').textContent = 'Meteor strike';
    $('infoSub').textContent = c.kind === 'market'
      ? `${fmtDate(c.date)} · whole market ${pct(c.ret)} · ${c.sector} hit hardest`
      : `${fmtDate(c.date)} · ${c.sector} ${pct(c.ret)}`;
    $('infoRows').innerHTML =
      row('Day', fmtDate(c.date)) +
      row(c.kind === 'market' ? 'Whole market that day' : `${c.sector} that day`, `<span class="down">${pct(c.ret)}</span>`) +
      row('Hardest-hit sector', c.sector) +
      row('Type', c.kind === 'market' ? 'Market-wide shock (≤ −4%)' : 'Sector shock (≤ −7%)');
    return;
  }
  if (sel.ticker) {
    const s = stockIndex[sel.ticker];
    $('infoTitle').textContent = `${COMPANY[sel.ticker] ?? sel.ticker}`;
    $('infoSub').textContent = `${sel.ticker} · ${s.sector} · ${fmtDate(data.dates[i])}`;
    $('infoRows').innerHTML =
      row('Growth since 2007', s.growth[i] == null ? '—' : `×${s.growth[i].toFixed(2)}`) +
      row('This week', `<span class="${cls(s.ret[i])}">${pct(s.ret[i])}</span>`) +
      row('Volatility (annualised)', s.vol[i] == null ? '—' : `${(s.vol[i] * 100).toFixed(0)}%`) +
      row('Trading activity', s.relVolume[i] == null ? '—' : `${s.relVolume[i].toFixed(2)}× normal`);
  } else {
    const s = data.sectors.find((x) => x.name === sel.sector);
    $('infoTitle').textContent = s.name;
    $('infoSub').textContent = `Sector · ${fmtDate(data.dates[i])}`;
    $('infoRows').innerHTML =
      row('Companies', s.tickers.join(', ')) +
      row('This week (average)', `<span class="${cls(s.ret[i])}">${pct(s.ret[i])}</span>`) +
      row('Volatility (annualised)', s.vol[i] == null ? '—' : `${(s.vol[i] * 100).toFixed(0)}%`);
  }
}

function select(sel) {
  state.selected = sel;
  updateInfoPanel();
  requestExplanation();
}

// ── AI explorer's log: numbers show instantly, then the backend's explanation.
// The server looks up the numbers itself; we only send ticker/sector/week.
let explainSeq = 0, explainTimer = null;
function requestExplanation() {
  const ai = $('ai');
  clearTimeout(explainTimer);
  const sel = state.selected;
  if (!sel) return;
  if (sel.crater || state.playing) { ai.innerHTML = ''; return; } // no AI for craters; no spam during playback
  const seq = ++explainSeq, week = state.week;
  ai.innerHTML = `<span class="label">Explorer's log</span><div>Thinking…</div>`;
  explainTimer = setTimeout(async () => {
    let res = null;
    try {
      const r = await fetch('/api/explain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: sel.ticker, sector: sel.ticker ? null : sel.sector, week, market: MARKET.id }),
      });
      if (r.ok) res = await r.json();
    } catch { /* backend offline: fall through */ }
    if (seq !== explainSeq) return; // a newer click/week replaced this request
    if (!res || !res.text) { ai.innerHTML = ''; return; } // offline: numbers alone are enough
    const label = res.source === 'ai' ? 'Generated by AI · uses only the numbers above' : 'Summary from the data';
    ai.innerHTML = `<span class="label">${label}</span><div></div>`;
    ai.lastElementChild.textContent = res.text;
  }, 250);
}
$('infoClose').addEventListener('click', () => select(null));

function setPlaying(p) {
  if (p && state.sandbox) return;      // no playback inside the sandbox
  state.playing = p;
  if (p && state.week >= N - 1) setWeek(0, { quake: false });
  playBtn.textContent = p ? '❚❚ Pause' : '▶ Play';
  playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
  controls.autoRotate = !p && !state.touring && !state.rotationPaused; // still while playing/touring
  if (!p) requestExplanation();
}
playBtn.addEventListener('click', () => setPlaying(!state.playing));
slider.addEventListener('input', () => setWeek(Number(slider.value)));

// Keyboard: Space play/pause · ←/→ one week · Shift+←/→ one year (52 weeks)
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement
    || (t instanceof HTMLInputElement && t.type !== 'range')) return;
  if (state.sandbox && e.code !== 'Escape') return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!state.playing);
  } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    e.preventDefault(); // stop the focused slider from also moving
    const step = (e.shiftKey ? 52 : 1) * (e.code === 'ArrowRight' ? 1 : -1);
    setWeek(state.week + step);
  } else if (e.code === 'Escape') {
    if (sandbox?.isActive()) sandbox.close(); else if (state.touring) exitTour(); else select(null);
  } else if (/^Digit[1-9]$/.test(e.code) && Number(e.code.slice(5)) <= tours.length) {
    goToStop(Number(e.code.slice(5)) - 1); // demo shortcut: number keys jump to tour stops
  }
});
playBtn.addEventListener('keydown', (e) => { if (e.code === 'Space') e.preventDefault(); }); // no double toggle

// ───────────────────────────── GUIDED TOURS ─────────────────────────────
// public/tours.json: [{ date, title, focus: "market" | sector | ticker, narration, narrationSource }]
// Narrations are pre-generated (python -m server.make_tours) so the tour works offline.
// US: hand-curated tour (with Gareth's sourced chapters). UK/Asia: generated from their own data.
tours = await fetch(`/${MARKET.tours ?? (MARKET.id === 'us' ? 'tours.json' : `tours-${MARKET.id}.json`)}`)
  .then((r) => (r.ok ? r.json() : [])).catch(() => []);
if (!tours.length) for (const id of ['tourBtn', 'prevStop', 'nextStop']) $(id).style.display = 'none';
const AXIS_X = new THREE.Vector3(1, 0, 0);
const tourQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
const fly = { active: false, t: 0, fromDir: new THREE.Vector3(), toDir: new THREE.Vector3(), fromDist: 0, toDist: 0 };

// Where a focus sits on the planet (continents are fixed)
function focusDirection(focus, out) {
  const sectorName = stockIndex[focus]?.sector ?? focus;
  const k = SECTOR_NAMES.indexOf(sectorName);
  if (k === -1) return out.set(0, 3.2, 15).normalize(); // "market": the default overview
  return out.copy(PLATE_DIRS[k]);
}

function startFly(dir, dist, seconds = CONFIG.tour.flySeconds) {
  fly.seconds = seconds;
  fly.fromDist = camera.position.length();
  fly.fromDir.copy(camera.position).normalize();
  fly.toDir.copy(dir).normalize();
  fly.toDist = dist;
  fly.t = 0;
  fly.active = true;
}

function updateFly(dt) {
  if (!fly.active) return;
  fly.t = Math.min(1, fly.t + dt / fly.seconds);
  const e = fly.t < 0.5 ? 2 * fly.t * fly.t : 1 - (-2 * fly.t + 2) ** 2 / 2; // ease in-out
  tmpV.copy(fly.fromDir).lerp(fly.toDir, e).normalize();
  camera.position.copy(tmpV).multiplyScalar(fly.fromDist + (fly.toDist - fly.fromDist) * e);
  if (fly.t >= 1) fly.active = false;
}

function goToStop(i) {
  if (!tours.length) return;
  if (sandbox?.isActive()) sandbox.close();
  state.touring = true;
  state.tourStop = (i + tours.length) % tours.length;
  const t = tours[state.tourStop];
  setPlaying(false);
  const w = data.dates.findIndex((d) => d >= t.date);
  setWeek(w === -1 ? N - 1 : w);
  controls.autoRotate = false;
  if (stockIndex[t.focus]) select({ ticker: t.focus, sector: stockIndex[t.focus].sector });
  else if (data.sectors.some((x) => x.name === t.focus)) select({ ticker: null, sector: t.focus });
  else select(null);
  startFly(focusDirection(t.focus, tmpV), t.focus === 'market' ? CONFIG.tour.marketDistance : CONFIG.tour.focusDistance);

  $('tour').style.display = 'block';
  $('tourNum').textContent = String(state.tourStop + 1).padStart(2, '0');
  $('tourStep').textContent = `Stop ${state.tourStop + 1} of ${tours.length}`;
  $('tourDate').textContent = fmtDate(data.dates[state.week]);
  $('tourPhase').textContent = t.phase || t.title;
  $('tourPhase').classList.toggle('risk', !!t.risk);
  $('tourTitle').textContent = t.headline || t.title;
  $('tourSummary').textContent = t.summary || (t.headline ? t.title : '');
  $('tourSummary').style.display = $('tourSummary').textContent ? '' : 'none';
  $('tourText').textContent = t.narration || '';
  $('tourLabel').textContent = !t.narration ? '' :
    t.narrationSource === 'ai' ? 'What the data shows · generated by AI from the numbers' : 'What the data shows';
  // good/bad and source text are hand-written in public/tours.json (Gareth's sourced chapters)
  $('tourOutcomes').innerHTML = (t.good ? `<div class="outcome"><span class="symbol">↗</span><div><h3>THE GOOD / OPPORTUNITY</h3><p>${t.good}</p></div></div>` : '') +
    (t.bad ? `<div class="outcome bad"><span class="symbol">↘</span><div><h3>THE BAD / PRESSURE</h3><p>${t.bad}</p></div></div>` : '');
  $('tourSource').innerHTML = t.url ? `Source: <a href="${t.url}" target="_blank" rel="noopener noreferrer">${t.source} ↗</a>` : '';
  $('story').scrollTo({ top: 0, behavior: 'smooth' });
}

function exitTour() {
  state.touring = false;
  $('tour').style.display = 'none';
  controls.autoRotate = !state.playing && !state.rotationPaused;
}

$('tourBtn').addEventListener('click', () => goToStop(state.touring ? state.tourStop + 1 : 0));
$('tourNext').addEventListener('click', () => goToStop(state.tourStop + 1));
$('tourPrev').addEventListener('click', () => goToStop(state.tourStop - 1));
$('tourExit').addEventListener('click', exitTour);
$('prevStop').addEventListener('click', () => goToStop(state.touring ? state.tourStop - 1 : tours.length - 1));
$('nextStop').addEventListener('click', () => goToStop(state.touring ? state.tourStop + 1 : 0));

// ── Header: travel to a date (nearest trading week), field guide dialog
const jumpDate = $('jumpDate');
jumpDate.min = data.dates[0];
jumpDate.max = data.dates[N - 1];
$('dateForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!jumpDate.value) return;
  const w = nearestWeek(data.dates, jumpDate.value);
  setPlaying(false);
  setWeek(w === -1 ? N - 1 : w);
});
$('about').addEventListener('click', () => $('aboutDialog').showModal());
$('closeAbout').addEventListener('click', () => $('aboutDialog').close());

// ── View controls: zoom and pause the slow camera spin
function zoomBy(f) {
  const d = THREE.MathUtils.clamp(camera.position.length() * f, controls.minDistance, controls.maxDistance);
  camera.position.setLength(d);
}
$('zoomIn').addEventListener('click', () => zoomBy(0.85));
$('zoomOut').addEventListener('click', () => zoomBy(1.18));
$('rotate').addEventListener('click', () => {
  state.rotationPaused = !state.rotationPaused;
  $('rotate').setAttribute('aria-pressed', String(state.rotationPaused));
  $('rotate').textContent = state.rotationPaused ? '↻' : 'Ⅱ';
  controls.autoRotate = !state.rotationPaused && !state.playing && !state.touring;
});

// Company labels, mountains and rings all resolve to the same selection.
const raycaster = new THREE.Raycaster();
const pickSurface = new THREE.Sphere(new THREE.Vector3(), R * 0.995), pickPoint = new THREE.Vector3();
const pointer = new THREE.Vector2();
const hoverTip = document.createElement('div');
hoverTip.className = 'company-tooltip';
hoverTip.hidden = true;
document.body.append(hoverTip);
let hoveredCompany = null, downAt = null, hoverAt = null, lastHoverTime = 0;

function pickAt(x, y) {
  // Labels sit above the peaks: a ray through their text often hits the sector below.
  // Match the visible label first, using the renderer's stacking order for overlaps.
  const labels = allMountains.filter((m) => {
    const label = m.userData.label, el = label.element;
    if (!m.visible || !label.visible || el.style.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }).sort((a, b) => Number(b.userData.label.element.style.zIndex) - Number(a.userData.label.element.style.zIndex));
  if (labels.length) return labels[0].userData;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  scene.updateMatrixWorld(true);
  raycaster.setFromCamera(pointer, camera);
  pickSurface.center.copy(world.position);
  const ground = raycaster.ray.intersectSphere(pickSurface, pickPoint);
  const groundDist = ground ? raycaster.ray.origin.distanceTo(pickPoint) : Infinity;
  return choosePickHit(raycaster.intersectObjects(pickables, false), groundDist)?.object.userData ?? null;
}
function updateHover() {
  const hit = hoverAt && !downAt ? pickAt(...hoverAt) : null;
  const company = hit?.ticker ? allMountains.find((m) => m.userData.ticker === hit.ticker) : null;
  if (company !== hoveredCompany) {
    hoveredCompany?.userData.label.element.classList.remove('hovered');
    hoveredCompany = company;
    hoveredCompany?.userData.label.element.classList.add('hovered');
  }
  canvas.style.cursor = hit ? 'pointer' : 'grab';
  hoverTip.hidden = !company;
  if (company) {
    const u = company.userData;
    hoverTip.textContent = `${COMPANY[u.ticker]} (${u.ticker}) · ${u.sector}`;
    hoverTip.style.left = `${Math.max(8, Math.min(hoverAt[0] + 14, innerWidth - hoverTip.offsetWidth - 8))}px`;
    hoverTip.style.top = `${Math.max(8, Math.min(hoverAt[1] + 18, innerHeight - hoverTip.offsetHeight - 8))}px`;
  }
}
canvas.addEventListener('pointermove', (e) => { hoverAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerleave', () => { hoverAt = null; updateHover(); });
canvas.addEventListener('pointercancel', () => { downAt = hoverAt = null; updateHover(); });
canvas.addEventListener('pointerdown', (e) => {
  downAt = [e.clientX, e.clientY];
  updateHover();
});
canvas.addEventListener('pointerup', (e) => {
  const start = downAt;
  downAt = null;
  if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
  const u = pickAt(e.clientX, e.clientY);
  if (!u) return;
  if (u.marketId) { goToMarket(u.marketId); return; }
  if (state.sandbox) return;
  if (u.crater) { select({ crater: u.crater }); return; }
  select(u.ticker ? { ticker: u.ticker, sector: u.sector } : { ticker: null, sector: u.sector });
});

new ResizeObserver(() => {
  const [w, h] = viewSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  labelRenderer.setSize(w, h);
}).observe(canvas);

// ───────────────────────────── "WHAT IF?" SANDBOX ─────────────────────────────
// Predicted sector moves are shown with the planet's usual language: mountain colour and glow,
// darker/redder land (uStressTint), eruptions on the two hardest-hit sectors, a tremor scaled to the
// biggest fall. The regime sets weather and sea level the same way real calm/crisis weeks do.
function setHistoryControls(disabled) {
  for (const id of ['slider', 'play', 'tourBtn', 'prevStop', 'nextStop', 'jumpDate']) $(id).disabled = disabled;
}
// Average off-diagonal sector correlation on that regime's days (from stress.json)
function regimeCorr(regime) {
  const c = stress.regimes[regime].corr, v = [];
  for (const a in c) for (const b in c[a]) if (a !== b && Number.isFinite(c[a][b])) v.push(c[a][b]);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0.3;
}
if (stress) {
  const r = stress.regimes;
  $('wiPeriod').textContent = `Simple linear model from ${data.dates[0].slice(0, 4)}–${data.dates.at(-1).slice(0, 4)} data: `
    + `${r.calm.days.toLocaleString()} calm days and ${r.crisis.days.toLocaleString()} crisis days. Not a prediction or financial advice.`;
}
const sandbox = stress ? createSandbox({
  stress, $,
  enter() {
    setPlaying(false);
    if (state.touring) exitTour();
    select(null);
    state.sandboxWeek = state.week;
    state.sandbox = true;
    setHistoryControls(true);
  },
  exit() {
    state.sandbox = false;
    state.stressTarget.fill(0);
    setHistoryControls(false);
    setWeek(state.sandboxWeek, { quake: false });
  },
  apply(moves, regime) {
    const crisis = regime === 'crisis';
    state.targetStorm = crisis ? 0.75 : 0.1;
    state.vix = crisis ? 45 : 14;
    state.targetSea = seaFromCorr(regimeCorr(regime));          // that regime's real average correlation
    const order = SECTOR_NAMES.map((name, k) => [moves[name] ?? 0, k]).sort((a, b) => a[0] - b[0]);
    const worst = order[0][0];
    state.vents = [order[0][1], order[1][1]];
    state.targetEruption = worst < -0.1 ? 0.3 + 0.7 * clamp01(-worst / 0.35) : 0;
    state.quake = Math.max(state.quake, clamp01(-worst / 0.4) * 0.8);
    audio.quake(clamp01(-worst / 0.4));
    continents.forEach((c, k) => {
      const mv = moves[SECTOR_NAMES[k]] ?? 0;
      state.stressTarget[k] = mv < 0 ? clamp01(-mv / 0.35) : 0;
      for (const m of c.mountains) {
        const u = m.userData;
        colorFromReturn(mv / 4, u.targetColor);               // −20% → full red
        const g = u.stock.growth[state.sandboxWeek];             // mountains shrink by the predicted fall
        if (g != null) u.targetHeight = heightFromGrowth(Math.max(1e-5, g * (1 + mv)));
        u.targetGlow = CONFIG.glow.base + CONFIG.glow.perMove * Math.min(1, Math.abs(mv) * 5);
      }
    });
  },
}) : null;
if (!stress) $('whatIfBtn').style.display = 'none';

// ───────────────────────────── SOUND ─────────────────────────────
// Muted by default. The choice is remembered; if it was on, sound starts at the first click/key
// (browsers only allow audio after a user gesture).
meteorHooks.launch = (size) => audio.meteor(size);
meteorHooks.impact = (size) => audio.impact(size);
const soundBtn = $('soundBtn');
function showSound(on) {
  soundBtn.textContent = on ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Mute sound' : 'Turn sound on');
}
function rememberSound(on) { try { localStorage.setItem('mw-sound', on ? '1' : '0'); } catch { /* private mode */ } }
soundBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const on = !audio.isEnabled();
  audio.setEnabled(on);
  showSound(on);
  rememberSound(on);
});
let soundWanted = false;
try { soundWanted = localStorage.getItem('mw-sound') === '1'; } catch { /* storage blocked */ }
showSound(false);
if (soundWanted) {
  const start = () => { if (!audio.isEnabled()) { audio.setEnabled(true); showSound(true); } };
  window.addEventListener('pointerdown', start, { once: true });
  window.addEventListener('keydown', start, { once: true });
}

// ───────────────────────────── MARKET SWITCHER ─────────────────────────────
function goToMarket(id) {
  if (id === MARKET.id) return;
  const q = new URLSearchParams({ market: id, week: data.dates[state.sandbox ? state.sandboxWeek : state.week] });
  document.body.classList.add('switching');              // fade out, then load the other planet
  setTimeout(() => { location.search = q.toString(); }, 350);
}
$('referenceCoast').addEventListener('change', (e) => { planetUniforms.uShowReferenceCoast.value = e.target.checked ? 1 : 0; });
// Each market is its own planet. Switching keeps the date: the new planet opens at the same week.
(function buildSwitcher() {
  const box = $('marketSwitch');
  if (MARKETS.length < 2) { box.style.display = 'none'; return; }
  for (const mk of MARKETS) {
    const b = document.createElement('button');
    b.textContent = mk.short;
    b.title = mk.name;
    b.setAttribute('aria-pressed', String(mk.id === MARKET.id));
    b.addEventListener('click', () => goToMarket(mk.id));
    box.appendChild(b);
  }
  $('marketName').textContent = MARKET.name;
  $('marketNote').textContent = data.meta?.note ?? '';
})();

// ───────────────────────────── NEIGHBOURING WORLDS ─────────────────────────────
// Gareth's idea: the other markets float beside this planet as small live planets, showing their
// own weather and sea level for the same date. They stay at the screen edges (they follow the
// camera) and keep their own market's look. Click one to travel there.
const NEIGHBOR_SCALE = 0.24;
const neighbors = [];
function addNeighbor(mk, w, idx) {
  const look = PLANET_LOOKS[mk.id] ?? PLANET_LOOKS.us;
  const mat = planet.material.clone();
  const u = mat.uniforms;
  u.uProjection.value = camera.projectionMatrix;          // clone() copied it; keep the live one
  u.uStressTint.value = new Float32Array(6);
  u.uWorldRadius.value = R * NEIGHBOR_SCALE;
  u.uQuality.value = 1;
  u.uEruption.value = 0;
  u.uShowReferenceCoast.value = 0;
  u.uWorldSeed.value = look.seed;
  u.uWaterDeep.value.setRGB(...look.waterDeep);
  u.uWaterSurface.value.setRGB(...look.waterSurface);
  u.uOceanPalette.value = planetUniforms.uOceanPalette.value;
  u.uNoiseTexture.value = planetUniforms.uNoiseTexture.value;
  for (let c = 0; c < 6; c++) {                            // continent frames: same layout as this planet
    u.uContinentDir.value[c].copy(Z).applyQuaternion(continents[c].group.quaternion);
    u.uContinentRot.value[c].setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(continents[c].group.quaternion.clone().invert()));
  }
  const mesh = new THREE.Mesh(planet.geometry, mat);
  mesh.scale.setScalar(NEIGHBOR_SCALE);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  mesh.userData.marketId = mk.id;
  scene.add(mesh);
  pickables.push(mesh);
  const label = makeLabel(`${mk.short} · explore`, 'market-label', `Open the ${mk.name} planet`);
  scene.add(label);
  neighbors.push({ mk, w, look, mesh, u, label, side: idx === 0 ? -1 : 1, atmoCalm: new THREE.Color(look.atmo) });
  updateNeighbors(state.week);
}
// Loaded in the background so the main planet never waits for the other markets' data
MARKETS.filter((mk) => mk.id !== MARKET.id).forEach((mk, idx) => {
  fetch(`/${mk.world}`).then((r) => (r.ok ? r.json() : null)).then((w) => { if (w) addNeighbor(mk, w, idx); }).catch(() => {});
});

// Their weather and sea level for the current date (their own data, nearest week)
function updateNeighbors(week) {
  for (const nb of neighbors) {
    const i = nearestWeek(nb.w.dates, data.dates[week]), m = nb.w.market;
    const storm = stormFromVix(m.vix[i] ?? 13);
    nb.u.uStorm.value = nb.u.uStress.value = storm;
    nb.u.uSeaLevel.value = m.avgCorr[i] == null ? 0 : seaFromCorr(m.avgCorr[i]);
    nb.u.uCloudsDensity.value = nb.look.cloudsCalm + (CONFIG.clouds.storm - nb.look.cloudsCalm) * storm;
    nb.u.uAtmosphereColor.value.copy(nb.atmoCalm).lerp(ATMO_STORM, storm);
    nb.u.uAccent.value.copy(nb.u.uAtmosphereColor.value);
    nb.u.uSunIntensity.value = CONFIG.planetLight * (1 - 0.55 * storm);
    nb.u.uAmbientLight.value = 0.05;
  }
}
// Keep them at the left/right edges of the view (camera space), hidden on narrow screens
const nbOffset = new THREE.Vector3();
function placeNeighbors(t) {
  const show = camera.aspect > 1.15;
  for (const nb of neighbors) {
    nb.mesh.visible = nb.label.visible = show;
    if (!show) continue;
    const depth = 24, halfW = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    nbOffset.set(nb.side * halfW * 0.74, nb.side < 0 ? 1.2 : -1.2, -depth).applyMatrix4(camera.matrixWorld);
    nb.mesh.position.copy(nbOffset);
    nb.u.uPlanetPosition.value.copy(nbOffset);
    nb.u.uTime.value = t;
    nb.label.position.copy(nbOffset).addScaledVector(camera.up, -R * NEIGHBOR_SCALE * 1.55);
  }
}
// ───────────────────────────── ASK THE PLANET ─────────────────────────────
createAsk({
  $, data, fmtDate, market: MARKET.id,
  go(weekIndex, focus) {
    if (sandbox?.isActive()) sandbox.close();
    if (state.touring) exitTour();
    setPlaying(false);
    setWeek(weekIndex);
    controls.autoRotate = false;
    startFly(focusDirection(focus, tmpV), focus === 'market' ? CONFIG.tour.marketDistance : CONFIG.tour.focusDistance, 1.5);
  },
});

// ───────────────────────────── ANIMATION ─────────────────────────────
const clock = new THREE.Clock();
const tmpQ = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const FLASH_SKY = new THREE.Color('#3a3550');
const tmpM4 = new THREE.Matrix4();

// Labels only on the visible hemisphere, tickers only when reasonably close
const labelPos = new THREE.Vector3(), toCam = new THREE.Vector3();
function facing(obj) {
  obj.getWorldPosition(labelPos);
  toCam.copy(camera.position).sub(labelPos).normalize();
  return labelPos.sub(world.position).normalize().dot(toCam) > 0.15;
}
function updateLabels() {
  const close = camera.position.length() < 18;
  for (const c of continents) c.sectorLabel.visible = facing(c.sectorLabel);
  for (const m of allMountains) m.userData.label.visible = close && m.visible && facing(m.userData.label);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  const k = 1 - Math.exp(-dt * CONFIG.smoothing);

  // Playback: one frame per trading week
  if (state.playing) {
    state.acc += dt * 1000;
    while (state.acc >= CONFIG.weekMs) {
      state.acc -= CONFIG.weekMs;
      if (state.week >= N - 1) { setPlaying(false); break; }
      setWeek(state.week + 1);
    }
  }

  // Sea level (average correlation), eased smoothly
  const ks = 1 - Math.exp(-dt / CONFIG.sea.seconds * 3);
  state.sea += (state.targetSea - state.sea) * ks;
  planetUniforms.uSeaLevel.value = state.sea;

  // Mountains: height = growth, colour = weekly return
  for (const m of allMountains) {
    const u = m.userData;
    u.height += (u.targetHeight - u.height) * k;
    m.scale.set(0.7 + 0.6 * u.height, u.height, 0.7 + 0.6 * u.height); // big mountains are also broader
    u.ring.scale.setScalar(0.7 + 0.6 * u.height);
    u.color.lerp(u.targetColor, k);
    u.glow += (u.targetGlow - u.glow) * k;
    m.material.color.copy(WHITE).lerp(u.color, 0.08);             // natural rock; the return shows in the foot ring
    m.material.emissive.copy(u.color).multiplyScalar(u.glow * 0.06);
    u.ring.material.color.copy(u.color);                          // the clear signal: glowing foot ring
    u.ring.material.opacity = 0.15 + 0.6 * Math.min(1, u.glow);
    if (m === hoveredCompany) {
      m.material.emissive.copy(GREEN).multiplyScalar(0.3);
      u.ring.material.color.copy(GREEN);
      u.ring.material.opacity = 1;
    }
    u.ring.visible = m.visible;
  }

  // Weather: VIX → sky colour, atmosphere, clouds, sunlight
  state.storm += (state.targetStorm - state.storm) * k;
  const s = state.storm;
  scene.background.copy(SKY_CALM).lerp(SKY_STORM, s);
  const pu = planetUniforms;
  pu.uTime.value = t;
  pu.uStorm.value = s;                                           // dark storm fronts
  pu.uStress.value = s;
  pu.uCloudsDensity.value = CONFIG.clouds.calm + (CONFIG.clouds.storm - CONFIG.clouds.calm) * s;
  pu.uAtmosphereColor.value.copy(ATMO_CALM).lerp(ATMO_STORM, s); // blue → red with fear
  pu.uAccent.value.copy(pu.uAtmosphereColor.value);
  pu.uSunIntensity.value = CONFIG.planetLight * (1 - 0.55 * s);    // storms dim the sun
  pu.uAmbientLight.value = 0.018 + 0.015 * s;   // dark night side
  sun.intensity = 2.4 - 1.1 * s;

  // Continents for the shader: centre direction + world→local rotation (fixed)
  pu.uPlanetPosition.value.copy(world.position);
  const kStress = 1 - Math.exp(-dt * 3);                      // ~1 s to settle
  for (let q = 0; q < 6; q++) pu.uStressTint.value[q] += (state.stressTarget[q] - pu.uStressTint.value[q]) * kStress;
  for (let c = 0; c < continents.length; c++) {
    const q = continents[c].group.quaternion;
    pu.uContinentDir.value[c].copy(Z).applyQuaternion(q);
    tmpM4.makeRotationFromQuaternion(tmpQ.copy(q).invert());
    pu.uContinentRot.value[c].setFromMatrix4(tmpM4);
  }

  // Volcanoes (crash weeks) on the worst-hit sectors' continents
  state.eruption += (state.targetEruption - state.eruption) * k;
  pu.uEruption.value = state.eruption;
  for (let v = 0; v < 2; v++) pu.uVentDir.value[v].copy(pu.uContinentDir.value[state.vents[v]]);

  // Lightning: random flashes while VIX is above the threshold
  if (state.vix > CONFIG.lightningVix && Math.random() < dt * (0.4 + (state.vix - CONFIG.lightningVix) * 0.04)) {
    state.flash = 1;
    audio.thunder();
  }
  state.flash *= Math.exp(-dt * 14);
  pu.uFlash.value = state.flash;
  ambient.intensity = 0.55 + state.flash * 1.5;
  scene.background.lerp(FLASH_SKY, state.flash * 0.6);

  // Earthquake: the planet shakes in crash weeks
  if (state.quake > 0.002) {
    const a = state.quake * 0.14;
    world.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    state.quake *= Math.exp(-dt * 1.6);
  } else if (state.quake > 0) { state.quake = 0; world.position.set(0, 0, 0); }

  meteors.update(dt);
  audio.update(state.storm, clamp01(state.sea / CONFIG.sea.lowest));
  updateFly(dt);
  controls.update(dt);
  camera.updateMatrixWorld();
  placeNeighbors(t);                                  // after the camera moves: no lag
  updateLabels();
  composer.render(dt);
  labelRenderer.render(scene, camera);
  // Recheck during rotation as well as pointer movement, without raycasting every frame.
  if (t - lastHoverTime > 0.1) { updateHover(); lastHoverTime = t; }
  requestAnimationFrame(animate);
}

// Dev-only handle for debugging in the browser console
if (import.meta.env.DEV) window.mw = { scene, camera, controls, continents, planet, planetUniforms, renderer, composer, bloom, state, CONFIG, audio };

// ───────────────────────────── START ─────────────────────────────
function weekFromUrl() {
  const w = new URLSearchParams(location.search).get('week');
  if (!w) return null;
  const i = nearestWeek(data.dates, w);
  return i === -1 ? N - 1 : i;
}
const start = weekFromUrl() ?? data.dates.findIndex((d) => d >= '2007-06-29');
setWeek(start, { quake: false });
// Jump straight to the starting state (no slow fade-in on load)
state.storm = state.targetStorm; state.sea = state.targetSea;
for (const m of allMountains) {
  const u = m.userData; u.height = u.targetHeight; u.color.copy(u.targetColor); u.glow = u.targetGlow;
}
animate();
