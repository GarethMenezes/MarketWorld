# Market Worlds — realtime planet shader

An interactive DurHack 2026 market-history journey using [Julien Sulpis’ realtime-planet-shader](https://github.com/jsulpis/realtime-planet-shader) for the visuals and the [Planet3D](https://github.com/Ishanoshada/Planet3D) scene model for satellite motion.

## Run

```sh
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173 in a WebGL 2 browser. Use a web server rather than opening the HTML as a file: the renderer loads its GLSL source from a local URL. All runtime assets are included. No CDN, API key, package installation or internet connection is required after downloading the source.

## Explore

Scroll through seven dated historical chapters, use the up/down buttons or date slider, or select Play journey (10 seconds per chapter). Drag the world with a mouse or horizontally on a touchscreen. Use +/− to zoom. Focus the canvas for arrow-key rotation and keyboard zoom. The globe pause button freezes rotation, cloud motion and moon orbits. Reduced-motion preferences disable automatic scene animation initially.

Each chapter changes the planet palette, terrain, cloud density, atmosphere and ring width. Three satellites represent opportunity, pressure and uncertainty. Geometry and colours are illustrative, not measured prices, returns, VIX or correlations. Historical narratives link to primary sources. This is a seven-event prototype (2007–2023), not the weekly-data or AI backend in the original brief.

Deep links support `?date=2020-03-23`; `?week=` selects the next curated event. If WebGL 2 is unavailable, the dated text journey remains usable. An interrupted graphics context displays a fallback and restores the scene when the browser recovers it.

## Integration

The runtime uses the actual upstream procedural GLSL, adapted in `dist/shaders/procedural.fragment.glsl`, rather than approximating the appearance with a separate shader. The original analytic sphere intersections, fractal terrain, domain-warped clouds, ocean lighting, atmospheric glow and tone mapping are retained.

`dist/realtime-planet.js` supplies WebGL 2 setup, uniforms, local deterministic 3D noise, mouse/touch/keyboard controls and graphics-context recovery. It replaces the upstream Astro/Four wrapper without requiring a build tool. Changes to GLSL add dated world palettes, seeded noise, external moon positions, raycast rings, tilt and zoom, tangent-frame bump normals, numerical safeguards, and background blending. The generated noise replaces the upstream Shadertoy binary; no texture photographs or external binary assets are used.

`dist/planet3d.js` retains the previously adapted `Planet`/`Moon` data model and orbit equations, now used by the new shader adapter. Its earlier mesh renderer has been removed. Unchanged upstream source snapshots and commit IDs are preserved under `vendor/`.

## Licences and source

This combined demo is distributed under GPL-3.0, without warranty. See `LICENSE` and `NOTICES.md`. The original Planet3D source retains its MIT notice. Credits, licence links and a complete corresponding-source ZIP are available in the field guide and footer.

Upstream shader commit: `cfa2776033d31250bb826b677e4539c4cecbd4be`.
Planet3D commit: `601ac0a26b895ab67da8873d8015f8526bc7f1c7`.

After edits, regenerate the downloadable source before publishing:

```sh
python3 tools/package_source.py
node --test tests/planet3d.test.cjs
```

No compilation is required. Browser validation covers GLSL compilation, all seven world/date mappings, controls, mobile layout, touch input, graphics recovery and fallback navigation.
