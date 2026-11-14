# Third-party code and licences

## Realtime planet shader — `shaders/planet.frag.glsl`

Author: Julien Sulpis (@jsulpis) — https://github.com/jsulpis/realtime-planet-shader
Upstream revision: cfa2776033d31250bb826b677e4539c4cecbd4be
Licence: GNU GPL-3.0 (`public/licenses/realtime-planet-shader.txt`)

Adapted for Market Worlds by Gareth Menezes (gareth branch, 14 Nov 2026): palettes, local
generated noise, tangent-frame normals, volcanoes, storm cover, safeguards.
Further adapted on the sota branch (14 Nov 2026): runs inside a Three.js ShaderMaterial with
camera rays and gl_FragDepth, land limited to six fixed sector continents (sea level, not drift, shows correlation), weather and
volcanoes driven by market data, rings/moons/spin and in-shader tone mapping removed.

Because this file is GPL-3.0, a distributed build of Market Worlds that includes it is
covered by GPL-3.0. Unmodified upstream snapshots are on the `gareth` branch under
`market worlds/vendor/`.

## TerraForge3D volcano profile (inside `shaders/planet.frag.glsl`)

Copyright (c) 2022 Jaysmito Mukherjee — https://github.com/Jaysmito101/TerraForge3D
Upstream revision: ac3b66085021848eb375bec39adda40cb04b4f28
Licence: MIT (`public/licenses/TerraForge3D.txt`)

## Sea Level Explorer
Copyright (c) 2026 Piergiorgio Borgogno — MIT.
Repository: https://github.com/archimedix/sea-level-explorer
Revision: 5ddc898a7f4a0f088f3a196c99d9bc8f9c99986b
Licence: public/licenses/sea-level-explorer.txt; source snapshot: vendor/sea-level-explorer/app.js.

Adapted SEA_STOPS, linear palette interpolation and the dark-cased, three-quarter-white reference coastline in ocean-palette.js and shaders/planet.frag.glsl. Classification uses elevation relative to the current waterline. The palette domain is rescaled to illustrative units, not metres. Leaflet, elevation tiles and geographic borders are not used.

## Three.js Water and Sky
MIT, Copyright © 2010–2024 three.js authors. Three.js version 0.170.0.
Source: https://github.com/mrdoob/three.js/tree/r170/examples/jsm/objects
Licence: public/licenses/three.txt; snapshots: vendor/three/Water.js and Sky.js.

The planet shader adapts Water.js's Fresnel reflectance and view-direction sun reflection, plus Sky.js's Rayleigh and Henyey-Greenstein phase functions. The bounded spherical atmosphere integration, procedural waves and market-driven weather are Market Worlds adaptations.
