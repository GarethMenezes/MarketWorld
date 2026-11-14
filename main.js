// Market Worlds — the stock market as a planet.
// Every visual is driven by a number in public/world.json (see CLAUDE.md, section 1).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import planetFragment from './shaders/planet.frag.glsl?raw';

// ───────────────────────────── TUNABLE VALUES ─────────────────────────────
// Tuned on real data 2007–2026 (see check_world.py output).
const CONFIG = {
  planetRadius: 5,

  // Mountain height = growth since 2007 on a log scale:
  //   h = base + perDecade * log10(growth), clamped, then * worldScale
  height: { base: 0.6, perDecade: 0.7, min: 0.12, max: 3, worldScale: 0.45 },

  // Mountain colour: t = weeklyReturn * colorSensitivity, clamped to [-1, 1]
  //   -1 red · 0 yellow · +1 green.  20 → a 5% weekly move is full colour.
  colorSensitivity: 20,
  glow: { base: 0.12, perMove: 1.4 },          // emissive = base + perMove * |t|

  // Continental drift from average sector correlation (30-day window).
  //   pull = (corr - corrLow) / (corrHigh - corrLow), clamped to [0, 1]
  //   2017 ≈ 0.1 → spread out · Oct 2008 ≈ 0.77 · Mar 2020 ≈ 0.86 → supercontinent
  drift: { corrLow: 0.25, corrHigh: 0.82, homeAngle: [0.85, 1.2], supercontinentAngle: 0.4 },

  // Weather from VIX: storm = (vix - vixCalm) / vixRange, clamped to [0, 1]
  //   VIX 13 → clear blue sky · VIX 58+ → red sky, thick dark clouds
  storm: { vixCalm: 13, vixRange: 45 },
  clouds: { calm: 0.25, storm: 0.6 },           // cloud coverage at storm 0 and 1
  lightningVix: 40,                             // lightning flashes above this VIX

  quakeRet: -0.07,                              // earthquake if market weekly return below this
  weekMs: 120,                                  // playback speed: ms per trading week
  smoothing: 4,                                 // higher = visuals follow data faster
  autoRotateSpeed: 0.35,
  tour: { flySeconds: 2, marketDistance: 16, focusDistance: 12 },

  // Performance: render-resolution cap. Measured on Intel Arc iGPU at 2008-10-10:
  // 1.0 → 6.3 ms/frame, 1.5 → 8.6 ms, 2.0 → 13.8 ms. 1.5 keeps 60 fps with headroom.
  maxPixelRatio: 1.5,
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

// ───────────────────────────── SETUP ─────────────────────────────
const R = CONFIG.planetRadius;
const canvas = document.getElementById('scene');
// antialias off: the bloom composer renders to its own targets, so MSAA here would be wasted work
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const SKY_CALM = new THREE.Color('#02040a');
const SKY_STORM = new THREE.Color('#2a0508');
scene.background = SKY_CALM.clone();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 5, 17);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 7.5;
controls.maxDistance = 35;
controls.autoRotate = true;
controls.autoRotateSpeed = CONFIG.autoRotateSpeed;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Lights (atmosphere only)
const sunDir = new THREE.Vector3(1, 0.5, 0.8).normalize();
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.position.copy(sunDir).multiplyScalar(50);
scene.add(sun);
const ambient = new THREE.HemisphereLight('#9fb8ff', '#1a1020', 0.55);
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
function makeStars() {
  const n = 3000, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(150 + Math.random() * 100);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: '#cfd8ff', size: 0.6, sizeAttenuation: true }));
}
scene.add(makeStars());

const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 16),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3.5) }));
sunGlow.position.copy(sunDir).multiplyScalar(140);
scene.add(sunGlow);

// Planet surface, ocean, clouds, atmosphere and volcanoes: Julien Sulpis' realtime planet
// shader as adapted by Gareth (GPL-3.0, see NOTICES.md), driven by market data below.
// Drawn on a back-faced sphere big enough to hold the atmosphere and ash plumes; the
// shader ray-traces the real planet and writes depth so mesh mountains sit on it.
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
const ATMO_CALM = new THREE.Color('#4aa8ff');
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
  uWaterDeep: { value: new THREE.Color(0.02, 0.05, 0.1) },
  uWaterSurface: { value: new THREE.Color(0.05, 0.16, 0.3) },
  uRockColor: { value: new THREE.Color(0.32, 0.29, 0.26) },
  uAccent: { value: ATMO_CALM.clone() },
  uContinentDir: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0, 0, 1)) },
  uContinentRot: { value: Array.from({ length: 6 }, () => new THREE.Matrix3()) },
  uContinentColor: { value: Array.from({ length: 6 }, () => new THREE.Color()) },
  uContinentCap: { value: 0.45 },
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

// Low-poly rocky mountain, base at y=0, height 1
function makeMountainGeometry(seed) {
  const g = new THREE.ConeGeometry(0.24, 1, 7, 3);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > 0.99) continue; // keep the peak
    const j = (hash3(i, seed, 7) - 0.5) * 0.09 * (1 - y);
    p.setXYZ(i, p.getX(i) * (1 + j * 3), y + (hash3(i, seed, 3) - 0.5) * 0.06 * y, p.getZ(i) * (1 + j * 3));
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// ───────────────────────────── DATA → WORLD ─────────────────────────────
const data = await fetch('/world.json').then((r) => r.json());
let tours = []; // filled in the GUIDED TOURS section; declared early so key handlers never hit it uninitialised
const N = data.dates.length;
const stockIndex = Object.fromEntries(data.stocks.map((s) => [s.ticker, s]));

// Continent placement: each sector sits on its own azimuth around a shared
// "supercontinent" point. Drift only changes how far it is from that point.
const qCenter = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.15);
const continents = data.sectors.map((sector, i) => {
  const seed = i * 13.7 + 3.1;
  const tint = SECTOR_COLORS[sector.name] || '#88aa66';
  const group = new THREE.Group();
  // Invisible pick target: the planet shader draws the land, this mesh only answers clicks
  const land = new THREE.Mesh(makeContinentGeometry(seed, tint, i * 0.004),
    new THREE.MeshBasicMaterial({ visible: false }));
  planetUniforms.uContinentColor.value[i].set(tint);
  land.userData.sector = sector.name;
  group.add(land);
  world.add(group);

  const azimuth = (i / data.sectors.length) * Math.PI * 2;
  const qAz = qCenter.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Z, azimuth));
  const home = CONFIG.drift.homeAngle[i % 2];

  // Mountains: one per company, arranged on a small ring around the continent centre
  const mountains = sector.tickers.map((ticker, k) => {
    const theta = (k / sector.tickers.length) * Math.PI * 2 + i;
    const angle = 0.17 + 0.03 * hash3(k, i, 1);
    const d = localDir(angle, theta, new THREE.Vector3());
    const mat = new THREE.MeshStandardMaterial({ color: '#ffd23a', roughness: 0.7, flatShading: true,
      emissive: '#000000', emissiveIntensity: 1 });
    const mesh = new THREE.Mesh(makeMountainGeometry(k + i * 10), mat);
    mesh.position.copy(d).multiplyScalar(R - 0.02); // shader surface is a sphere of radius R
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    mesh.userData = { ticker, sector: sector.name, stock: stockIndex[ticker], height: 0.2, targetHeight: 0.2,
      color: new THREE.Color('#888888'), targetColor: new THREE.Color('#888888'), glow: 0, targetGlow: 0 };
    mesh.scale.set(1, 0.2, 1);
    group.add(mesh);
    return mesh;
  });
  return { sector, group, land, qAz, home, mountains };
});
const allMountains = continents.flatMap((c) => c.mountains);
const pickables = [...allMountains, ...continents.map((c) => c.land)];

// ───────────────────────────── MAPPINGS (data → visual targets) ─────────────────────────────
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const RED = new THREE.Color('#ff3030'), YELLOW = new THREE.Color('#ffd23a'), GREEN = new THREE.Color('#2fe36a');
const GREY = new THREE.Color('#777777');

function heightFromGrowth(g) { // log scale: ×10 growth adds perDecade
  const h = CONFIG.height;
  return Math.min(h.max, Math.max(h.min, h.base + h.perDecade * Math.log10(g))) * h.worldScale;
}
function colorFromReturn(ret, out) {
  const t = Math.max(-1, Math.min(1, ret * CONFIG.colorSensitivity));
  return t < 0 ? out.copy(YELLOW).lerp(RED, -t) : out.copy(YELLOW).lerp(GREEN, t);
}
const stormFromVix = (vix) => clamp01((vix - CONFIG.storm.vixCalm) / CONFIG.storm.vixRange);
const driftFromCorr = (c) => clamp01((c - CONFIG.drift.corrLow) / (CONFIG.drift.corrHigh - CONFIG.drift.corrLow));

// Smoothed world state (follows the data targets)
const state = {
  week: 0, playing: false, acc: 0,
  storm: 0, targetStorm: 0,
  drift: 0, targetDrift: 0,
  quake: 0, flash: 0, vix: 15,
  eruption: 0, targetEruption: 0, vents: [0, 1],
  selected: null,
  touring: false, tourStop: 0,
};

function setWeek(i, { quake = true } = {}) {
  i = Math.max(0, Math.min(N - 1, i));
  const prev = state.week;
  state.week = i;
  const m = data.market;
  if (m.vix[i] != null) { state.vix = m.vix[i]; state.targetStorm = stormFromVix(m.vix[i]); }
  if (m.avgCorr[i] != null) state.targetDrift = driftFromCorr(m.avgCorr[i]);
  if (quake && i !== prev && m.ret[i] != null && m.ret[i] < CONFIG.quakeRet) {
    state.quake = Math.max(state.quake, Math.min(1, m.ret[i] / -0.15));
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
  updateStatsPanel();
  updateInfoPanel();
  if (i !== prev) requestExplanation();
  slider.value = String(i);
  sliderDate.textContent = data.dates[i];
}

// ───────────────────────────── UI ─────────────────────────────
const $ = (id) => document.getElementById(id);
const slider = $('slider'), sliderDate = $('sliderDate'), playBtn = $('play');
slider.max = String(N - 1);
const pct = (x, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
const cls = (x) => (x == null ? '' : x > 0 ? 'up' : x < 0 ? 'down' : '');
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
  if (c < 0.35) return 'moving independently';
  if (c < 0.6) return 'loosely linked';
  if (c < 0.75) return 'drifting together';
  return 'supercontinent';
}

function updateStatsPanel() {
  const i = state.week, m = data.market;
  $('date').textContent = `Week of ${fmtDate(data.dates[i])}`;
  $('vix').textContent = m.vix[i] == null ? '—' : `${m.vix[i].toFixed(1)} · ${vixLabel(m.vix[i])}`;
  $('corr').textContent = m.avgCorr[i] == null ? '—' : `${m.avgCorr[i].toFixed(2)} · ${corrLabel(m.avgCorr[i])}`;
  $('mret').innerHTML = `<span class="${cls(m.ret[i])}">${pct(m.ret[i])}</span>`;
  const notes = [];
  if (m.ret[i] != null && m.ret[i] < CONFIG.quakeRet) notes.push('Earthquake: crash week');
  if (m.vix[i] != null && m.vix[i] > CONFIG.lightningVix) notes.push('Lightning: extreme fear');
  if (m.avgCorr[i] != null && m.avgCorr[i] > 0.75) notes.push('Diversification failing: sectors fall together');
  $('mood').textContent = notes.join(' · ');
}

function row(k, v) { return `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`; }

function updateInfoPanel() {
  const sel = state.selected;
  if (!sel) { $('info').style.display = 'none'; return; }
  const i = state.week;
  $('info').style.display = 'block';
  if (sel.ticker) {
    const s = stockIndex[sel.ticker];
    $('infoTitle').textContent = sel.ticker;
    $('infoSub').textContent = `${s.sector} · week of ${fmtDate(data.dates[i])}`;
    $('infoRows').innerHTML =
      row('Growth since 2007', s.growth[i] == null ? '—' : `×${s.growth[i].toFixed(2)}`) +
      row('This week', `<span class="${cls(s.ret[i])}">${pct(s.ret[i])}</span>`) +
      row('Volatility (annualised)', s.vol[i] == null ? '—' : `${(s.vol[i] * 100).toFixed(0)}%`) +
      row('Trading activity', s.relVolume[i] == null ? '—' : `${s.relVolume[i].toFixed(2)}× normal`);
  } else {
    const s = data.sectors.find((x) => x.name === sel.sector);
    $('infoTitle').textContent = s.name;
    $('infoSub').textContent = `Sector · week of ${fmtDate(data.dates[i])}`;
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
  if (state.playing) { ai.innerHTML = ''; return; } // don't spam the backend during playback
  const seq = ++explainSeq, week = state.week;
  ai.innerHTML = `<span class="label">Explorer's log</span><div>Thinking…</div>`;
  explainTimer = setTimeout(async () => {
    let res = null;
    try {
      const r = await fetch('/api/explain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: sel.ticker, sector: sel.ticker ? null : sel.sector, week }),
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
  state.playing = p;
  if (p && state.week >= N - 1) setWeek(0, { quake: false });
  playBtn.textContent = p ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
  controls.autoRotate = !p && !state.touring; // camera holds still while history plays or touring
  if (!p) requestExplanation();
}
playBtn.addEventListener('click', () => setPlaying(!state.playing));
slider.addEventListener('input', () => setWeek(Number(slider.value)));

// Keyboard: Space play/pause · ←/→ one week · Shift+←/→ one year (52 weeks)
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!state.playing);
  } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    e.preventDefault(); // stop the focused slider from also moving
    const step = (e.shiftKey ? 52 : 1) * (e.code === 'ArrowRight' ? 1 : -1);
    setWeek(state.week + step);
  } else if (e.code === 'Escape') {
    if (state.touring) exitTour(); else select(null);
  } else if (/^Digit[1-9]$/.test(e.code) && Number(e.code.slice(5)) <= tours.length) {
    goToStop(Number(e.code.slice(5)) - 1); // demo shortcut: number keys jump to tour stops
  }
});
playBtn.addEventListener('keydown', (e) => { if (e.code === 'Space') e.preventDefault(); }); // no double toggle

// ───────────────────────────── GUIDED TOURS ─────────────────────────────
// public/tours.json: [{ date, title, focus: "market" | sector | ticker, narration, narrationSource }]
// Narrations are pre-generated (python -m server.make_tours) so the tour works offline.
tours = await fetch('/tours.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const tourQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
const fly = { active: false, t: 0, fromDir: new THREE.Vector3(), toDir: new THREE.Vector3(), fromDist: 0, toDist: 0 };

// Where a focus sits on the planet once drift reaches this week's target
function focusDirection(focus, out) {
  const sectorName = stockIndex[focus]?.sector ?? focus;
  const c = continents.find((x) => x.sector.name === sectorName);
  if (!c) return out.copy(Z).applyQuaternion(qCenter); // "market": the supercontinent point
  const angle = c.home + (CONFIG.drift.supercontinentAngle - c.home) * state.targetDrift;
  tourQ.multiplyQuaternions(c.qAz, tourQ.setFromAxisAngle(AXIS_X, angle));
  return out.copy(Z).applyQuaternion(tourQ);
}

function startFly(dir, dist) {
  fly.fromDist = camera.position.length();
  fly.fromDir.copy(camera.position).normalize();
  fly.toDir.copy(dir).normalize();
  fly.toDist = dist;
  fly.t = 0;
  fly.active = true;
}

function updateFly(dt) {
  if (!fly.active) return;
  fly.t = Math.min(1, fly.t + dt / CONFIG.tour.flySeconds);
  const e = fly.t < 0.5 ? 2 * fly.t * fly.t : 1 - (-2 * fly.t + 2) ** 2 / 2; // ease in-out
  tmpV.copy(fly.fromDir).lerp(fly.toDir, e).normalize();
  camera.position.copy(tmpV).multiplyScalar(fly.fromDist + (fly.toDist - fly.fromDist) * e);
  if (fly.t >= 1) fly.active = false;
}

function goToStop(i) {
  if (!tours.length) return;
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
  $('tourStep').textContent = `Tour stop ${state.tourStop + 1} of ${tours.length}`;
  $('tourTitle').textContent = t.title;
  $('tourDate').textContent = `Week of ${fmtDate(data.dates[state.week])}`;
  $('tourText').textContent = t.narration || '';
  $('tourLabel').textContent = !t.narration ? '' :
    t.narrationSource === 'ai' ? 'Generated by AI · uses only the numbers shown' : 'Summary from the data';
}

function exitTour() {
  state.touring = false;
  $('tour').style.display = 'none';
  controls.autoRotate = !state.playing;
}

$('tourBtn').addEventListener('click', () => goToStop(state.touring ? state.tourStop + 1 : 0));
$('tourNext').addEventListener('click', () => goToStop(state.tourStop + 1));
$('tourPrev').addEventListener('click', () => goToStop(state.tourStop - 1));
$('tourExit').addEventListener('click', exitTour);

// Click picking (ignore drags)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickables, false).find((h) => h.object.visible);
  if (!hit) return;
  const u = hit.object.userData;
  select(u.ticker ? { ticker: u.ticker, sector: u.sector } : { ticker: null, sector: u.sector });
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ───────────────────────────── ANIMATION ─────────────────────────────
const clock = new THREE.Clock();
const tmpQ = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const FLASH_SKY = new THREE.Color('#3a3550');
const tmpM4 = new THREE.Matrix4();

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

  // Continental drift: correlation pulls every continent toward the supercontinent point
  state.drift += (state.targetDrift - state.drift) * k * 0.6;
  for (const c of continents) {
    const angle = c.home + (CONFIG.drift.supercontinentAngle - c.home) * state.drift;
    tmpQ.setFromAxisAngle(X, angle);
    c.group.quaternion.multiplyQuaternions(c.qAz, tmpQ);
  }

  // Mountains: height = growth, colour = weekly return
  for (const m of allMountains) {
    const u = m.userData;
    u.height += (u.targetHeight - u.height) * k;
    m.scale.y = u.height;
    u.color.lerp(u.targetColor, k);
    u.glow += (u.targetGlow - u.glow) * k;
    m.material.color.copy(u.color);
    m.material.emissive.copy(u.color).multiplyScalar(u.glow);
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
  pu.uAmbientLight.value = 0.055 + 0.025 * s;
  sun.intensity = 2.4 - 1.1 * s;

  // Continents for the shader: centre direction + world→local rotation (terrain drifts with them)
  pu.uPlanetPosition.value.copy(world.position);
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

  updateFly(dt);
  controls.update(dt);
  composer.render(dt);
  requestAnimationFrame(animate);
}

// Dev-only handle for debugging in the browser console
if (import.meta.env.DEV) window.mw = { scene, camera, controls, continents, planet, planetUniforms, renderer, composer, bloom, state, CONFIG };

// ───────────────────────────── START ─────────────────────────────
function weekFromUrl() {
  const w = new URLSearchParams(location.search).get('week');
  if (!w) return null;
  const i = data.dates.findIndex((d) => d >= w);
  return i === -1 ? N - 1 : i;
}
const start = weekFromUrl() ?? data.dates.findIndex((d) => d >= '2007-06-29');
setWeek(start, { quake: false });
// Jump straight to the starting state (no slow fade-in on load)
state.storm = state.targetStorm; state.drift = state.targetDrift;
for (const m of allMountains) {
  const u = m.userData; u.height = u.targetHeight; u.color.copy(u.targetColor); u.glow = u.targetGlow;
}
animate();
