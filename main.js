// Market Worlds — the stock market as a planet.
// Every visual is driven by a number in public/world.json (see CLAUDE.md, section 1).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
  drift: { corrLow: 0.25, corrHigh: 0.82, homeAngle: [0.95, 1.35], supercontinentAngle: 0.4 },

  // Weather from VIX: storm = (vix - vixCalm) / vixRange, clamped to [0, 1]
  //   VIX 13 → clear blue sky · VIX 58+ → red sky, thick dark clouds
  storm: { vixCalm: 13, vixRange: 45 },
  clouds: { calm: 0.25, storm: 0.6 },           // cloud coverage at storm 0 and 1
  lightningVix: 40,                             // lightning flashes above this VIX

  quakeRet: -0.07,                              // earthquake if market weekly return below this
  weekMs: 120,                                  // playback speed: ms per trading week
  smoothing: 4,                                 // higher = visuals follow data faster
  autoRotateSpeed: 0.35,

  // Performance: render-resolution cap. Measured on Intel Arc iGPU at 2008-10-10:
  // 1.0 → 6.3 ms/frame, 1.5 → 8.6 ms, 2.0 → 13.8 ms. 1.5 keeps 60 fps with headroom.
  maxPixelRatio: 1.5,
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
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.45, 0.82);
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

const ocean = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64),
  new THREE.MeshStandardMaterial({ color: '#0b3c6e', roughness: 0.6, metalness: 0.05 }));
world.add(ocean);

// Faint latitude/longitude grid
(function makeGrid() {
  const pts = [];
  const r = R * 1.002;
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = 0; lon < 360; lon += 4) {
      for (const l of [lon, lon + 4]) {
        const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(l);
        pts.push(r * Math.cos(a) * Math.sin(b), r * Math.sin(a), r * Math.cos(a) * Math.cos(b));
      }
    }
  }
  for (let lon = 0; lon < 180; lon += 30) {
    for (let lat = 0; lat < 360; lat += 4) {
      for (const l of [lat, lat + 4]) {
        const a = THREE.MathUtils.degToRad(l), b = THREE.MathUtils.degToRad(lon);
        pts.push(r * Math.cos(a) * Math.sin(b), r * Math.sin(a), r * Math.cos(a) * Math.cos(b));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  world.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#7fb0ff', transparent: true, opacity: 0.07 })));
})();

// Atmosphere rim: colour blue (calm) → red (fear)
const ATMO_CALM = new THREE.Color('#4aa8ff');
const ATMO_STORM = new THREE.Color('#ff3a2a');
const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 64, 48), new THREE.ShaderMaterial({
  uniforms: { uColor: { value: ATMO_CALM.clone() }, uIntensity: { value: 1.0 } },
  vertexShader: `varying vec3 vNormal;
    void main() { vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uIntensity; varying vec3 vNormal;
    void main() { float i = pow(clamp(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 4.0);
      gl_FragColor = vec4(uColor * i * uIntensity * 1.1, 1.0); }`,
  side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
}));
world.add(atmosphere);

// Procedural clouds: coverage and darkness from VIX, flash from lightning
const clouds = new THREE.Mesh(new THREE.SphereGeometry(R + 0.5, 96, 64), new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 }, uCoverage: { value: 0.3 }, uDark: { value: 0 },
    uFlash: { value: 0 }, uSunDir: { value: sunDir },
  },
  vertexShader: `varying vec3 vPos; varying vec3 vN;
    void main() { vPos = position; vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime, uCoverage, uDark, uFlash; uniform vec3 uSunDir;
    varying vec3 vPos; varying vec3 vN;
    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s / 0.94; }
    void main() {
      vec3 p = normalize(vPos);
      float n = fbm(p * 3.2 + vec3(uTime * 0.015, 0.0, uTime * 0.008));
      float edge = 1.0 - uCoverage;
      float a = smoothstep(edge, edge + 0.22, n);
      float light = clamp(dot(vN, uSunDir) * 0.75 + 0.4, 0.12, 1.0);
      vec3 col = mix(vec3(1.0), vec3(0.16, 0.14, 0.17), uDark) * light;
      col += uFlash * vec3(0.55, 0.6, 0.8) * a;
      gl_FragColor = vec4(col, a * mix(0.7, 0.62, uDark));
    }`,
  transparent: true, depthWrite: false,
}));
world.add(clouds);

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
const N = data.dates.length;
const stockIndex = Object.fromEntries(data.stocks.map((s) => [s.ticker, s]));

// Continent placement: each sector sits on its own azimuth around a shared
// "supercontinent" point. Drift only changes how far it is from that point.
const qCenter = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.15);
const continents = data.sectors.map((sector, i) => {
  const seed = i * 13.7 + 3.1;
  const tint = SECTOR_COLORS[sector.name] || '#88aa66';
  const group = new THREE.Group();
  const land = new THREE.Mesh(makeContinentGeometry(seed, tint, i * 0.004),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
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
    const f = angle / coastRadius(theta, seed);
    const ground = groundElevation(d, f, seed) + i * 0.004;
    const mat = new THREE.MeshStandardMaterial({ color: '#ffd23a', roughness: 0.7, flatShading: true,
      emissive: '#000000', emissiveIntensity: 1 });
    const mesh = new THREE.Mesh(makeMountainGeometry(k + i * 10), mat);
    mesh.position.copy(d).multiplyScalar(R + ground - 0.03);
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
  selected: null,
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
  controls.autoRotate = !p; // camera holds still while history plays
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
    select(null);
  }
});
playBtn.addEventListener('keydown', (e) => { if (e.code === 'Space') e.preventDefault(); }); // no double toggle

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
  atmosphere.material.uniforms.uColor.value.copy(ATMO_CALM).lerp(ATMO_STORM, s);
  atmosphere.material.uniforms.uIntensity.value = 0.9 + 0.6 * s;
  const cu = clouds.material.uniforms;
  cu.uTime.value = t;
  cu.uCoverage.value = CONFIG.clouds.calm + (CONFIG.clouds.storm - CONFIG.clouds.calm) * s;
  cu.uDark.value = Math.min(1, s * 1.2);
  sun.intensity = 2.4 - 1.1 * s;

  // Lightning: random flashes while VIX is above the threshold
  if (state.vix > CONFIG.lightningVix && Math.random() < dt * (0.4 + (state.vix - CONFIG.lightningVix) * 0.04)) {
    state.flash = 1;
  }
  state.flash *= Math.exp(-dt * 14);
  cu.uFlash.value = state.flash;
  ambient.intensity = 0.55 + state.flash * 1.5;
  scene.background.lerp(FLASH_SKY, state.flash * 0.6);

  // Earthquake: the planet shakes in crash weeks
  if (state.quake > 0.002) {
    const a = state.quake * 0.14;
    world.position.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    state.quake *= Math.exp(-dt * 1.6);
  } else if (state.quake > 0) { state.quake = 0; world.position.set(0, 0, 0); }

  controls.update(dt);
  composer.render(dt);
  requestAnimationFrame(animate);
}

// Dev-only handle for debugging in the browser console
if (import.meta.env.DEV) window.mw = { scene, renderer, composer, bloom, clouds, atmosphere, state, CONFIG };

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
