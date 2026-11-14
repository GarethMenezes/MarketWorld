# Copyright, attribution and changes

## Realtime planet shader

Author: Julien Sulpis (@jsulpis).
Repository: https://github.com/jsulpis/realtime-planet-shader
Upstream revision: cfa2776033d31250bb826b677e4539c4cecbd4be
Licence: GNU General Public License version 3 (GPL-3.0), included in LICENSE and dist/licenses/realtime-planet-shader.txt.

The original shader attribution comments, including credited mathematical and shading references, are retained. Unmodified shader snapshots are in vendor/realtime-planet-shader/shaders/.

Modified for Market Worlds on 14 November 2026: chapter palettes and terrain/cloud settings; generated local noise texture; Planet3D-driven satellite positions; annular ring intersections; tilt/zoom uniforms; tangent-frame bump normals; numerical safeguards; page-background blending; and a standalone WebGL 2 JavaScript adapter. Modified runtime files are distributed with their complete editable source. This program is supplied without warranty under the included GPL.

## Planet3D

Copyright (c) 2023 Ishan Oshada.
Repository: https://github.com/Ishanoshada/Planet3D
Upstream revision: 601ac0a26b895ab67da8873d8015f8526bc7f1c7
Licence: MIT, retained in vendor/Planet3D/LICENSE and dist/licenses/Planet3D.txt.

The JavaScript model adapts Planet/Moon properties, circular orbit equations, parent-relative satellites, add_moon and add_ring. Motion uses elapsed time and independent moon angles. The unchanged Python source is retained in vendor/Planet3D/.

## Corresponding source

The combined demo and its modifications are distributed under GPL-3.0 while retaining the permissive notices above. dist/source.zip contains the application source, shader source, licences, upstream snapshots, run instructions, packaging script and regression tests. It excludes deployment credentials, Git metadata and its own generated ZIP. No build tools or undistributed assets are required to run the included application with a local HTTP server.
