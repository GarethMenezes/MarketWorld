/* Sea Level Explorer
 * ------------------------------------------------------------------
 * A navigable map (Leaflet) of "Terrarium" elevation tiles. Each PNG
 * tile encodes elevation in its RGB channels:
 *     elevation_m = (R * 256 + G + B / 256) - 32768
 * Tiles are decoded once into an Int16Array; repainting as the slider
 * moves is a simple LUT lookup, so shifting the sea level is instant
 * even full screen.
 *
 * Inspired by heightmapper — https://tangrams.github.io/heightmapper/ — which
 * is where the idea of using Terrarium tiles as an elevation source comes from.
 * There the sea level is fixed: being able to move it, and watch the coastlines
 * redraw, is what this project adds.
 *
 * Data sources, all keyless:
 *   elevation  https://registry.opendata.aws/terrain-tiles/  (SRTM/ETOPO1/GMTED)
 *   names      https://carto.com/basemaps/                   (© OpenStreetMap)
 *   borders    https://www.naturalearthdata.com/             (1:50m, in data/)
 */

'use strict';

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const LABELS_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png';

const TS = 256;              // tile side in pixels
const ELEV_MIN = -11000;     // Mariana Trench
const ELEV_MAX = 9000;       // Everest
const LUT_SIZE = ELEV_MAX - ELEV_MIN + 1;
const NO_DATA = -32768;
const MAX_TILES = 200;       // cap on the decoded-tile cache

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Application state
const state = {
  sea: 0,
  showChange: false,
  shade: true,
  coastRef: true,
};

// ------------------------------------------------------------------
// Palette
// ------------------------------------------------------------------

// Elevations relative to the current sea level. Negative = seabed.
const SEA_STOPS = [
  [-11000, 0x03, 0x0b, 0x1c],
  [-6000,  0x06, 0x1c, 0x36],
  [-3000,  0x0e, 0x33, 0x58],
  [-1000,  0x1b, 0x50, 0x82],
  [-400,   0x27, 0x69, 0xa4],
  [-120,   0x38, 0x87, 0xc0],
  [-40,    0x55, 0xa6, 0xd6],
  [-8,     0x82, 0xc6, 0xe6],
  [0,      0xa9, 0xdc, 0xf0],
];

const LAND_STOPS = [
  [0,     0x2f, 0x6b, 0x3c],   // coast: deep green
  [60,    0x40, 0x83, 0x45],
  [200,   0x63, 0x9c, 0x4e],   // plains and hills
  [450,   0x94, 0xac, 0x54],
  [800,   0xbd, 0xa9, 0x5b],   // ochre
  [1300,  0xb4, 0x87, 0x4c],
  [2000,  0x96, 0x66, 0x40],   // brown: mountains
  [2800,  0x7e, 0x58, 0x42],
  [3500,  0x8f, 0x86, 0x82],   // bare rock
  [4200,  0xc4, 0xc2, 0xc2],
  [5000,  0xff, 0xff, 0xff],   // permanent snow
  [9000,  0xff, 0xff, 0xff],
];

function buildLUT() {
  const lut = new Uint8Array(LUT_SIZE * 3);
  const write = (h, r, g, b) => {
    const i = (h - ELEV_MIN) * 3;
    lut[i] = r; lut[i + 1] = g; lut[i + 2] = b;
  };
  const fill = (stops) => {
    for (let s = 0; s < stops.length - 1; s++) {
      const [h0, r0, g0, b0] = stops[s];
      const [h1, r1, g1, b1] = stops[s + 1];
      const span = h1 - h0;
      for (let h = h0; h <= h1; h++) {
        const t = span === 0 ? 0 : (h - h0) / span;
        write(h, r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t);
      }
    }
  };
  fill(SEA_STOPS);
  fill(LAND_STOPS);
  return lut;
}

const LUT = buildLUT();

// 32-bit version of the palette, so a pixel can be written in a single
// operation. Byte order depends on the machine's endianness.
const LITTLE_ENDIAN = (() => {
  const b = new ArrayBuffer(4);
  new Uint32Array(b)[0] = 1;
  return new Uint8Array(b)[0] === 1;
})();

const LUT32 = (() => {
  const a = new Uint32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const r = LUT[i * 3], g = LUT[i * 3 + 1], b = LUT[i * 3 + 2];
    a[i] = LITTLE_ENDIAN
      ? (255 << 24) | (b << 16) | (g << 8) | r
      : (r << 24) | (g << 16) | (b << 8) | 255;
  }
  return a;
})();

/** Alternative palette: areas that change state are tinted red or green. */
function tintedLUT(toward) {
  const a = new Uint32Array(LUT_SIZE);
  const [tr, tg, tb] = toward;
  for (let i = 0; i < LUT_SIZE; i++) {
    const r = (LUT[i * 3] + tr) >> 1;
    const g = (LUT[i * 3 + 1] + tg) >> 1;
    const b = (LUT[i * 3 + 2] + tb) >> 1;
    a[i] = LITTLE_ENDIAN
      ? (255 << 24) | (b << 16) | (g << 8) | r
      : (r << 24) | (g << 16) | (b << 8) | 255;
  }
  return a;
}

const LUT32_LOST = tintedLUT([255, 46, 52]);    // submerged land
const LUT32_GAIN = tintedLUT([150, 255, 90]);   // emerged land

/* Today's coastline gets the same treatment as the borders: a light core plus a
 * dark halo on the neighbouring pixels. Without the halo the line vanishes just
 * where it is needed most — over freshly flooded areas, which being shallow are
 * pale blue, almost the colour of the line itself.
 *
 * The core lightens three quarters of the way toward white rather than covering:
 * on a flat, zero-elevation coastal plain — lagoons, reclaimed land, deltas —
 * the outline of emerged land is genuinely jagged and produces thousands of
 * micro-coastlines, which at full tint would turn into a blotch. */
const mixToward = (target, num, den) => (LITTLE_ENDIAN
  ? (c) => (255 << 24)
      | ((((c >> 16) & 255) * (den - num) + target * num) / den << 16)
      | ((((c >> 8) & 255) * (den - num) + target * num) / den << 8)
      | (((c & 255) * (den - num) + target * num) / den)
  : (c) => ((((c >>> 24) & 255) * (den - num) + target * num) / den << 24)
      | ((((c >> 16) & 255) * (den - num) + target * num) / den << 16)
      | ((((c >> 8) & 255) * (den - num) + target * num) / den << 8)
      | 255);

const coastCore = mixToward(255, 3, 4);   // core: 3/4 toward white
const coastHalo = mixToward(10, 1, 2);    // halo: halfway toward black

// Indices of the coast pixels in the tile being processed, so the halo pass
// does not have to scan the whole tile again.
const coastIdx = new Int32Array(TS * TS);

// Work buffer reused by every tile: avoids 256 KB of allocations on each
// repaint, and therefore garbage-collector pauses while dragging.
const scratch = new ImageData(TS, TS);
const scratch32 = new Uint32Array(scratch.data.buffer);

/** CSS colour for a relative elevation (used by the legend and the cursor box). */
function colorAt(h) {
  const i = (clamp(Math.round(h), ELEV_MIN, ELEV_MAX) - ELEV_MIN) * 3;
  return `rgb(${LUT[i]},${LUT[i + 1]},${LUT[i + 2]})`;
}

// ------------------------------------------------------------------
// Elevation layer
// ------------------------------------------------------------------

const TerrainLayer = L.GridLayer.extend({

  initialize(opts) {
    L.GridLayer.prototype.initialize.call(this, opts);
    this._cache = new Map();   // "z/x/y" -> {elev, shade, weight}
    this._stats = new Map();   // "z/x/y" -> {land, water, changed}
  },

  createTile(coords, done) {
    const canvas = L.DomUtil.create('canvas', 'leaflet-tile');
    canvas.width = TS;
    canvas.height = TS;

    const key = `${coords.z}/${coords.x}/${coords.y}`;
    const cached = this._cache.get(key);
    if (cached) {
      this._paint(canvas, cached, key);
      setTimeout(() => done(null, canvas), 0);
      return canvas;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      let data;
      try {
        data = this._decode(img, coords);
      } catch (err) {
        done(err, canvas);
        return;
      }
      this._cache.set(key, data);
      this._prune();
      this._paint(canvas, data, key);
      done(null, canvas);
      scheduleStats();
    };

    img.onerror = () => {
      // Zoom beyond the dataset's coverage, or a missing tile: blank tile.
      canvas._noData = true;
      done(null, canvas);
    };

    img.src = TILE_URL
      .replace('{z}', coords.z)
      .replace('{x}', coords.x)
      .replace('{y}', coords.y);

    return canvas;
  },

  /** Terrarium PNG -> elevations (Int16) + hillshade + per-row area weight. */
  _decode(img, coords) {
    const off = document.createElement('canvas');
    off.width = TS; off.height = TS;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, TS, TS);
    const px = ctx.getImageData(0, 0, TS, TS).data;

    const elev = new Int16Array(TS * TS);
    for (let i = 0, p = 0; i < elev.length; i++, p += 4) {
      // (R*256 + G + B/256) - 32768, rounded to the metre
      elev[i] = (px[p] << 8) + px[p + 1] + (px[p + 2] > 127 ? 1 : 0) - 32768;
    }

    // Per-row area weight: in Web Mercator the real area of a pixel is
    // proportional to cos²(lat). Needed for undistorted statistics.
    const n = Math.pow(2, coords.z);
    const weight = new Float32Array(TS);
    for (let y = 0; y < TS; y++) {
      const yw = (coords.y + (y + 0.5) / TS) / n;         // 0..1 from the north pole
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * yw)));
      const c = Math.cos(lat);
      weight[y] = c * c;
    }

    return { elev, shade: this._hillshade(elev, coords), weight };
  },

  /* Hillshading from a grazing light to the NW. It does not depend on the sea
   * level: it is computed once and kept as a canvas, to be composited in
   * "overlay" (grey 128 = neutral). The GPU does the compositing, so repainting
   * as the slider moves stays cheap. */
  _hillshade(elev, coords) {
    const shade = new Uint8ClampedArray(TS * TS * 4);
    // Pixel side in metres: 156543.034 · cos(lat) / 2^z  (256 px tile).
    const n = Math.pow(2, coords.z);
    const latC = Math.atan(Math.sinh(Math.PI * (1 - 2 * (coords.y + 0.5) / n)));
    const px = Math.max(1, 156543.03392 * Math.cos(latC) / n);
    const zf = 1.4;   // vertical exaggeration

    for (let y = 0; y < TS; y++) {
      const ym = y > 0 ? y - 1 : 0;
      const yp = y < TS - 1 ? y + 1 : TS - 1;
      for (let x = 0; x < TS; x++) {
        const xm = x > 0 ? x - 1 : 0;
        const xp = x < TS - 1 ? x + 1 : TS - 1;
        const dzdx = (elev[y * TS + xp] - elev[y * TS + xm]) / ((xp - xm) * px) * zf;
        const dzdy = (elev[yp * TS + x] - elev[ym * TS + x]) / ((yp - ym) * px) * zf;
        // light from the NW, 45° elevation
        const nz = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        const nx = -dzdx * nz, ny = -dzdy * nz;
        let l = (-nx * 0.5 - ny * -0.5 + nz * 0.7071);
        l = clamp(l, 0, 1.3);
        const v = clamp(Math.round(128 + (l - 0.62) * 175), 0, 255);
        const p = (y * TS + x) << 2;
        shade[p] = shade[p + 1] = shade[p + 2] = v;
        shade[p + 3] = 255;
      }
    }

    const c = document.createElement('canvas');
    c.width = TS; c.height = TS;
    c.getContext('2d').putImageData(new ImageData(shade, TS, TS), 0, 0);
    return c;
  },

  /** Colours a canvas from the cached data, at the current sea level. */
  _paint(canvas, data, key) {
    const ctx = canvas.getContext('2d');
    const { elev, shade, weight } = data;

    const sea = state.sea;
    const off = -ELEV_MIN - sea;               // LUT index = elevation + off
    const lo = ELEV_MIN + sea, hi = ELEV_MAX + sea;   // representable elevations
    // When highlighting the change, areas that change state use a tinted
    // palette: just pick the table, no branch inside the loop.
    const tint = state.showChange ? (sea > 0 ? LUT32_LOST : LUT32_GAIN) : null;

    let land = 0, water = 0, changed = 0;

    for (let y = 0; y < TS; y++) {
      const w = weight[y];
      const row = y * TS;
      for (let x = 0; x < TS; x++) {
        const i = row + x;
        const e = elev[i];
        const idx = (e < lo ? lo : e > hi ? hi : e) + off;

        const isLand = e > sea;
        if (isLand) land += w; else water += w;

        if ((e > 0) !== isLand) {          // changes state relative to today
          changed += w;
          scratch32[i] = (tint || LUT32)[idx];
        } else {
          scratch32[i] = LUT32[idx];
        }
      }
    }

    /* Today's coastline. Natural Earth borders are only the *land* borders
     * between states: the perimeter of a coastal country is closed by the
     * coastline, which here moves with the slider, and without that stretch the
     * border stays open onto the sea. Today's coast is derived from the same
     * data — the positive-elevation land pixels that border zero or negative
     * elevation — so it matches the zero-level map exactly, which a line taken
     * from another source never would. It is drawn only once the sea has moved:
     * at level zero it would coincide with the edge already visible. */
    if (state.coastRef && sea !== 0) {
      /* Keep only what is genuinely an edge. On a zero-elevation plain the
       * "emerged land" outline is full of isolated pixels — one-pixel bumps and
       * pools — and with the halo each would become a dark dot: a salt-and-pepper
       * that covers the map instead of describing it. A true coast pixel has 3
       * to 6 land neighbours out of the surrounding 8; below that it is a speck,
       * above it is inland. */
      let n = 0;
      for (let y = 1; y < TS - 1; y++) {
        const row = y * TS;
        for (let x = 1; x < TS - 1; x++) {
          const i = row + x;
          if (elev[i] <= 0) continue;
          if (elev[i + 1] > 0 && elev[i + TS] > 0 && elev[i - 1] > 0 && elev[i - TS] > 0) continue;

          let land = 0;
          if (elev[i - TS - 1] > 0) land++;
          if (elev[i - TS] > 0) land++;
          if (elev[i - TS + 1] > 0) land++;
          if (elev[i - 1] > 0) land++;
          if (elev[i + 1] > 0) land++;
          if (elev[i + TS - 1] > 0) land++;
          if (elev[i + TS] > 0) land++;
          if (elev[i + TS + 1] > 0) land++;

          if (land >= 3 && land <= 6) coastIdx[n++] = i;
        }
      }
      // The halo comes before the core, or it would darken already-lightened pixels.
      for (let k = 0; k < n; k++) {
        const i = coastIdx[k];
        const x = i % TS;
        if (x > 0) scratch32[i - 1] = coastHalo(scratch32[i - 1]);
        if (x < TS - 1) scratch32[i + 1] = coastHalo(scratch32[i + 1]);
        if (i >= TS) scratch32[i - TS] = coastHalo(scratch32[i - TS]);
        if (i < TS * (TS - 1)) scratch32[i + TS] = coastHalo(scratch32[i + TS]);
      }
      for (let k = 0; k < n; k++) {
        scratch32[coastIdx[k]] = coastCore(scratch32[coastIdx[k]]);
      }
    }

    ctx.putImageData(scratch, 0, 0);

    if (state.shade) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(shade, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }

    if (key) this._stats.set(key, { land, water, changed });
  },

  /* Each cached tile weighs about 400 KB between elevations and the hillshade
   * canvas: without a cap, a long exploration would grow to hundreds of
   * megabytes. The oldest off-screen tiles are discarded (Map preserves
   * insertion order). */
  _prune() {
    if (this._cache.size <= MAX_TILES) return;
    const visible = new Set();
    for (const k in this._tiles) visible.add(this._key(this._tiles[k].coords));
    for (const key of this._cache.keys()) {
      if (this._cache.size <= MAX_TILES) break;
      if (visible.has(key)) continue;
      this._cache.delete(key);
      this._stats.delete(key);
    }
  },

  /** Cache key: coordinates are wrapped back into the canonical world. */
  _key(coords) {
    const c = this._wrapCoords(coords);
    return `${c.z}/${c.x}/${c.y}`;
  },

  /** Repaints every visible tile without downloading anything again. */
  repaint() {
    for (const k in this._tiles) {
      const t = this._tiles[k];
      if (!t.el || t.el._noData) continue;
      const key = this._key(t.coords);
      const data = this._cache.get(key);
      if (data) this._paint(t.el, data, key);
    }
  },

  /** Elevation (m) at the given geographic point, from the cached tiles. */
  elevationAt(latlng, zoom) {
    const z = Math.min(Math.round(zoom), this.options.maxNativeZoom);
    const p = map.project(latlng.wrap(), z);
    const tx = Math.floor(p.x / TS), ty = Math.floor(p.y / TS);
    const data = this._cache.get(this._key({ z, x: tx, y: ty }));
    if (!data) return null;
    const px = Math.floor(p.x - tx * TS), py = Math.floor(p.y - ty * TS);
    const v = data.elev[py * TS + px];
    return v <= NO_DATA + 1 ? null : v;
  },

  /** Aggregates the area statistics over the currently visible tiles. */
  aggregate() {
    let land = 0, water = 0, changed = 0;
    for (const k in this._tiles) {
      const t = this._tiles[k];
      if (!t.el || t.el._noData) continue;
      const s = this._stats.get(this._key(t.coords));
      if (s) { land += s.land; water += s.water; changed += s.changed; }
    }
    return { land, water, changed, total: land + water };
  },
});

// ------------------------------------------------------------------
// Map
// ------------------------------------------------------------------

const map = L.map('map', {
  center: [30, 15],
  zoom: 3,
  minZoom: 2,
  maxZoom: 15,
  zoomControl: false,
  worldCopyJump: true,
  preferCanvas: true,
});

L.control.zoom({ position: 'topright' }).addTo(map);

const terrain = new TerrainLayer({
  tileSize: TS,
  minZoom: 0,
  maxNativeZoom: 13,
  maxZoom: 15,
  keepBuffer: 2,
  updateWhenZooming: false,
  noWrap: false,
  attribution: 'Terrain Tiles',
}).addTo(map);

// Labels live in their own pane just above the tiles, transparent to events.
map.createPane('labels');
map.getPane('labels').style.zIndex = 450;
map.getPane('labels').style.pointerEvents = 'none';

const labels = L.tileLayer(LABELS_URL, {
  subdomains: 'abcd',
  maxZoom: 20,
  opacity: 0.9,
  detectRetina: true,
  pane: 'labels',
});
labels.addTo(map);

/* National borders (Natural Earth 1:50m, local). The CARTO label layer carries
 * only the names: the borders live in its base map, which is not used here
 * because it would cover the terrain. These are land borders between states,
 * not coastlines: the coastline must stay the computed one, which is the point. */
let borders = null;

/* Dashed yellow, so as not to confuse them with the solid white line of today's
 * coastline, which is data of a different nature.
 *
 * Each border is drawn twice: first a thicker dark halo, then the light line on
 * top. This is the "casing" of classic cartography, and it matters because the
 * background here changes constantly — green, ochre, blue, white — and no single
 * colour holds contrast over all of them: over the ochre of the mountains the
 * yellow alone disappears. With the halo the border stays legible everywhere.
 * The dashes of the two layers line up: same geometry and same dashArray. */
const BORDER_DASH = '6,4';
const borderWeight = () => (map.getZoom() < 5 ? 1.2 : map.getZoom() < 9 ? 1.7 : 2.3);

const haloStyle = () => ({
  color: '#0d141c',
  weight: borderWeight() + 2.5,
  opacity: 0.5,
  dashArray: BORDER_DASH,
  lineCap: 'butt',
  interactive: false,
});

const lineStyle = () => ({
  color: '#ffd23f',
  weight: borderWeight(),
  opacity: 1,
  dashArray: BORDER_DASH,
  lineCap: 'butt',
  interactive: false,
});

fetch('data/borders.geojson')
  .then((r) => r.json())
  .then((geo) => {
    const halo = L.geoJSON(geo, { style: haloStyle, pane: 'labels' });
    const line = L.geoJSON(geo, { style: lineStyle, pane: 'labels' });
    borders = L.layerGroup([halo, line]);      // the halo must be added first
    if ($('tglLabels').checked) borders.addTo(map);
    map.on('zoomend', () => {
      halo.setStyle(haloStyle());
      line.setStyle(lineStyle());
    });
  })
  .catch(() => { /* without borders the app stays fully usable */ });

// ------------------------------------------------------------------
// Scenarios
// ------------------------------------------------------------------

const SCENARIOS = [
  { v: -120, label: 'Last Glacial Maximum', note: 'About 20,000 years ago: −120 m. Doggerland emerges in the North Sea, the Bering land bridge appears, and Sundaland joins Sumatra, Java and Borneo to the mainland.' },
  { v: -50,  label: 'Last ice age, late phase', note: 'About 12,000 years ago. The continental shelves are still largely dry: the Gulf of Thailand is a plain.' },
  { v: 0,    label: 'Today', note: 'Present-day mean sea level. Land makes up about 29% of the planet’s surface.' },
  { v: 1,    label: '+1 m — end of century (high)', note: 'High-end IPCC scenario for 2100. Permanent high tides over the Mekong Delta, Bangladesh, southern Florida and the Venice lagoon.' },
  { v: 3,    label: '+3 m — West Antarctica', note: 'Collapse of the West Antarctic ice sheet: about +3.3 m. The Dutch coastal plains and the Asian deltas become untenable.' },
  { v: 7,    label: '+7 m — Greenland', note: 'Full melt of the Greenland ice sheet: about +7 m. Much of the coastal Po Valley and the Po delta disappear.' },
  { v: 66,   label: '+66 m — all the ice', note: 'Melt of every land-based ice mass, Antarctica included. This is the physical maximum: about +66 m. The Po Valley, the North German Plain and the coastal Amazon go under.' },
  { v: -500, label: '−500 m — retreating oceans', note: 'An imaginary scenario: the continental shelves and the shallower ridges emerge. The Mediterranean breaks apart.' },
  { v: -3800,label: 'Oceans drained', note: 'Science fiction: below the mean ocean depth (−3,800 m) the Mid-Atlantic Ridge stands exposed, the longest mountain range on the planet.' },
];

const PLACES = [
  { label: 'Global view', lat: 30, lng: 15, z: 3 },
  { label: 'Mediterranean', lat: 40.5, lng: 12, z: 5 },
  { label: 'Venice and the North Adriatic', lat: 45.3, lng: 12.4, z: 8 },
  { label: 'Po Valley', lat: 45.0, lng: 10.5, z: 7 },
  { label: 'Lunigiana and Castevoli', lat: 44.31, lng: 9.90, z: 11 },
  { label: 'Turin and the Lanzo Valleys', lat: 45.25, lng: 7.45, z: 9 },
  { label: 'The Netherlands', lat: 52.2, lng: 5.0, z: 7 },
  { label: 'North Sea and Doggerland', lat: 55.0, lng: 3.5, z: 6 },
  { label: 'Gulf of Thailand and Bangkok', lat: 12.5, lng: 100.5, z: 6 },
  { label: 'Sunda Shelf', lat: 2.0, lng: 107.0, z: 5 },
  { label: 'Ganges Delta and Bangladesh', lat: 23.0, lng: 90.0, z: 7 },
  { label: 'Florida', lat: 27.5, lng: -81.5, z: 6 },
  { label: 'Maldives', lat: 3.5, lng: 73.2, z: 8 },
  { label: 'Bering Strait', lat: 65.0, lng: -169.0, z: 5 },
  { label: 'Caspian Sea and Caspian Depression', lat: 44.0, lng: 50.0, z: 5 },
  { label: 'Danakil Depression', lat: 14.2, lng: 40.3, z: 8 },
  { label: 'Himalaya and Everest', lat: 28.0, lng: 86.9, z: 8 },
  { label: 'Mid-Atlantic Ridge', lat: 30.0, lng: -40.0, z: 4 },
  { label: 'Mariana Trench', lat: 11.35, lng: 142.2, z: 7 },
];

// ------------------------------------------------------------------
// Interface
// ------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const els = {
  slider: $('levelSlider'),
  value: $('levelValue'),
  tag: $('levelTag'),
  scaleMin: $('scaleMin'),
  scaleMax: $('scaleMax'),
  scenarios: $('scenarios'),
  note: $('scenarioNote'),
  pctLand: $('pctLand'),
  pctSea: $('pctSea'),
  barLand: $('barLand'),
  delta: $('deltaLine'),
  places: $('places'),
  cursor: $('cursor'),
  legend: $('legend'),
  panel: $('panel'),
};

// --- scenarios and places ---------------------------------------------

SCENARIOS.forEach((s) => {
  const b = document.createElement('button');
  b.className = 'scenario';
  b.dataset.v = s.v;
  b.innerHTML = `<span class="val">${s.v > 0 ? '+' : ''}${s.v}</span><span class="lbl">${s.label}</span>`;
  b.addEventListener('click', () => {
    ensureRange(s.v);
    setLevel(s.v);
    els.note.textContent = s.note;
  });
  els.scenarios.appendChild(b);
});

PLACES.forEach((p, i) => {
  const o = document.createElement('option');
  o.value = i;
  o.textContent = p.label;
  els.places.appendChild(o);
});
els.places.addEventListener('change', (e) => {
  const p = PLACES[+e.target.value];
  map.flyTo([p.lat, p.lng], p.z, { duration: 1.1 });
});

// --- legend ------------------------------------------------------------

(function buildLegend() {
  const stops = [];
  const pts = [-8000, -4000, -2000, -600, -150, -20, 0, 300, 900, 1800, 3000, 4500, 6000];
  pts.forEach((h, i) => {
    stops.push(`${colorAt(h)} ${(i / (pts.length - 1) * 100).toFixed(1)}%`);
  });
  els.legend.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
})();

// --- slider -----------------------------------------------------------

const RANGES = {
  real: { min: -200, max: 100 },
  extreme: { min: -6000, max: 3000 },
};
let rangeMode = 'real';

function applyRange(mode) {
  rangeMode = mode;
  const r = RANGES[mode];
  els.slider.min = r.min;
  els.slider.max = r.max;
  els.slider.step = mode === 'real' ? 1 : 10;
  els.scaleMin.textContent = fmt(r.min);
  els.scaleMax.textContent = fmt(r.max);
  document.querySelectorAll('[data-range]').forEach((b) =>
    b.classList.toggle('active', b.dataset.range === mode));
  setLevel(clamp(state.sea, r.min, r.max));
}

/** Picks the range able to hold the requested value. */
function ensureRange(v) {
  const r = RANGES.real;
  const want = v >= r.min && v <= r.max ? 'real' : 'extreme';
  if (want !== rangeMode) applyRange(want);
}

const fmt = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US');

function setLevel(v, fromSlider) {
  state.sea = Math.round(v);
  if (!fromSlider) els.slider.value = clamp(state.sea, +els.slider.min, +els.slider.max);
  els.value.textContent = fmt(state.sea);
  els.tag.textContent = state.sea === 0 ? 'current level'
    : state.sea > 0 ? 'higher sea' : 'lower sea';
  document.querySelectorAll('.scenario').forEach((b) =>
    b.classList.toggle('active', +b.dataset.v === state.sea));
  schedulePaint();
  updateHash();
}

let paintPending = false;
function schedulePaint() {
  if (paintPending) return;
  paintPending = true;
  requestAnimationFrame(() => {
    paintPending = false;
    terrain.repaint();
    updateStats();
    updateCursorBox();
  });
}

els.slider.addEventListener('input', (e) => setLevel(+e.target.value, true));
$('btnMinus').addEventListener('click', () => setLevel(state.sea - (rangeMode === 'real' ? 1 : 50)));
$('btnPlus').addEventListener('click', () => setLevel(state.sea + (rangeMode === 'real' ? 1 : 50)));
$('btnReset').addEventListener('click', () => { setLevel(0); els.note.textContent = ''; });
document.querySelectorAll('[data-range]').forEach((b) =>
  b.addEventListener('click', () => applyRange(b.dataset.range)));

// --- toggles ----------------------------------------------------------

$('tglChange').addEventListener('change', (e) => { state.showChange = e.target.checked; schedulePaint(); });
$('tglShade').addEventListener('change', (e) => { state.shade = e.target.checked; schedulePaint(); });
$('tglCoast').addEventListener('change', (e) => { state.coastRef = e.target.checked; schedulePaint(); });
$('tglLabels').addEventListener('change', (e) => {
  if (e.target.checked) {
    labels.addTo(map);
    if (borders) borders.addTo(map);
  } else {
    map.removeLayer(labels);
    if (borders) map.removeLayer(borders);
  }
});

$('panelToggle').addEventListener('click', () => els.panel.classList.remove('hidden'));
els.panel.addEventListener('dblclick', (e) => {
  if (e.target.closest('input,button,select,label,a')) return;
  els.panel.classList.add('hidden');
});

// shortcuts: left/right arrows for the sea level
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,select')) return;
  const stepBase = rangeMode === 'real' ? 1 : 50;
  const step = e.shiftKey ? stepBase * 10 : stepBase;
  if (e.key === 'ArrowLeft') { setLevel(state.sea - step); e.preventDefault(); }
  if (e.key === 'ArrowRight') { setLevel(state.sea + step); e.preventDefault(); }
  if (e.key === '0') setLevel(0);
  if (e.key === 'h') els.panel.classList.toggle('hidden');
});

// ------------------------------------------------------------------
// Statistics
// ------------------------------------------------------------------

let statsPending = false;
function scheduleStats() {
  if (statsPending) return;
  statsPending = true;
  setTimeout(() => { statsPending = false; updateStats(); }, 220);
}

function updateStats() {
  const a = terrain.aggregate();
  if (!a.total) {
    els.pctLand.textContent = els.pctSea.textContent = '—';
    els.delta.textContent = 'Loading elevation data…';
    return;
  }
  const land = a.land / a.total * 100;
  els.pctLand.textContent = land.toFixed(1) + '%';
  els.pctSea.textContent = (100 - land).toFixed(1) + '%';
  els.barLand.style.width = land.toFixed(2) + '%';

  if (state.sea === 0) {
    els.delta.innerHTML = 'Present-day coastlines: this is the baseline for comparison.';
    return;
  }
  const changedPct = a.changed / a.total * 100;
  const baseLand = state.sea > 0 ? a.land + a.changed : a.land - a.changed;
  const relative = baseLand > 0 ? a.changed / baseLand * 100 : 0;
  if (state.sea > 0) {
    els.delta.innerHTML = `<b>${changedPct.toFixed(1)}%</b> of the view submerged: ` +
      `<b>${relative.toFixed(1)}%</b> of the land now above water here would disappear.`;
  } else {
    els.delta.innerHTML = `<b class="gain">${changedPct.toFixed(1)}%</b> of the view emerged: ` +
      `land above water up by <b class="gain">${relative.toFixed(1)}%</b>.`;
  }
}

map.on('moveend zoomend', scheduleStats);

// ------------------------------------------------------------------
// Cursor box
// ------------------------------------------------------------------

let lastLatLng = null;

map.on('mousemove', (e) => { lastLatLng = e.latlng; updateCursorBox(); });
map.on('mouseout', () => { lastLatLng = null; updateCursorBox(); });

function updateCursorBox() {
  if (!lastLatLng) {
    els.cursor.innerHTML = '<span class="ph">Move the mouse over the map</span>';
    return;
  }
  const e = terrain.elevationAt(lastLatLng, map.getZoom());
  if (e === null) {
    els.cursor.innerHTML = '<span class="ph">No data at this point</span>';
    return;
  }
  const h = e - state.sea;
  const wasLand = e > 0, isLand = h > 0;

  let stateLine;
  if (isLand && wasLand) {
    stateLine = `<span class="k">Dry land</span> · ${fmt(Math.round(h))} m above sea`;
  } else if (!isLand && !wasLand) {
    stateLine = `<span class="k">Seabed</span> · ${Math.abs(Math.round(h)).toLocaleString('en-US')} m deep`;
  } else if (!isLand && wasLand) {
    stateLine = `<span class="submerged">◆ Submerged</span> · today at ${fmt(e)} m`;
  } else {
    stateLine = `<span class="emerged">◆ New land</span> · today ${Math.abs(e)} m underwater`;
  }

  els.cursor.innerHTML =
    `<div class="row"><span class="k">Actual elevation</span><span class="v">${fmt(e)} m</span></div>` +
    `<div class="row"><span class="k">Coordinates</span><span class="v">${lastLatLng.lat.toFixed(3)}, ${lastLatLng.wrap().lng.toFixed(3)}</span></div>` +
    `<div class="state">${stateLine}</div>`;
}

// ------------------------------------------------------------------
// Permalink: #level/zoom/lat/lng
// ------------------------------------------------------------------

let hashTimer = null;
function updateHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const c = map.getCenter().wrap();
    const h = `#${state.sea}/${map.getZoom()}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`;
    history.replaceState(null, '', h);
  }, 400);
}

function readHash() {
  const m = location.hash.match(/^#(-?\d+)\/(\d+)\/(-?[\d.]+)\/(-?[\d.]+)$/);
  if (!m) return false;
  const [, sea, z, lat, lng] = m;
  // without animate:false the framing would be undone: on a freshly created
  // map the zoom animation kicks in and overwrites the requested position
  map.setView([+lat, +lng], +z, { animate: false });
  ensureRange(+sea);
  setLevel(+sea);
  return true;
}

map.on('moveend zoomend', updateHash);

// ------------------------------------------------------------------
// Startup
// ------------------------------------------------------------------

applyRange('real');
if (!readHash()) {
  setLevel(0);
  els.note.textContent = SCENARIOS.find((s) => s.v === 0).note;
}
