//=======================================================================================//
//
// Procedural Blue Planet
// by Julien Sulpis (https://twitter.com/jsulpis)
// https://www.shadertoy.com/view/Ds3XRl
// https://github.com/jsulpis/realtime-planet-shader  (GPL-3.0)
//
//=======================================================================================//
//
// Modified for Market Worlds by Gareth Menezes, 14 Nov 2026 (gareth branch): palettes,
// seeded local noise, tangent-frame bump normals, volcanoes (TerraForge3D-derived, MIT),
// storm cover, numerical safeguards.
//
// Further modified for Market Worlds (sota branch), 14 Nov 2026:
//  - runs inside a Three.js ShaderMaterial on a back-faced sphere; rays come from the
//    Three.js camera and the shader writes gl_FragDepth so mesh mountains sit on it
//  - land only inside six FIXED sector continents (uContinentDir/Rot/Color)
//  - sea level uniform (uSeaLevel) replaces the constant water level; deep ocean floor with
//    narrow continental shelves; organic, irregular continents with offshore islands;
//    polar ice, ocean sun glint, atmospheric haze, thin atmosphere rim;
//    exposed seabed drawn as wet sand / salt flats, foam at the shore, ring at the normal shoreline
//  - storm, eruption, flash, atmosphere colour are driven by market data in main.js
//  - rings, moons and the planet's own spin removed (not data-driven)
//  - tone mapping/gamma removed: Three.js OutputPass applies ACES + sRGB
// GPL-3.0 — see licenses/realtime-planet-shader.txt and NOTICES.md.

precision highp float;
precision highp sampler3D;

in vec3 vWorldPos;
out vec4 fragColor;

uniform float uTime;
uniform vec3 uPlanetPosition;   // world-space centre (moves during earthquakes)
uniform float uWorldRadius;     // world-space radius of the planet
uniform vec3 uSunDirection;
uniform sampler3D uNoiseTexture;
uniform float uQuality;

uniform float uNoiseStrength;
uniform float uTerrainScale;
uniform float uCloudsDensity;
uniform float uCloudsScale;
uniform float uCloudsSpeed;
uniform vec3 uAtmosphereColor;
uniform float uAtmosphereDensity;
uniform float uSunIntensity;
uniform float uAmbientLight;
uniform float uStorm, uEruption, uFlash, uStress;
uniform vec3 uWaterDeep, uWaterSurface, uRockColor, uAccent;

uniform vec3 uContinentDir[6];  // continent centres (unit vectors, world)
uniform mat3 uContinentRot[6];  // world → continent-local rotation
uniform vec3 uContinentColor[6];
uniform float uContinentCap;    // continent angular radius (radians)
uniform vec3 uVentDir[2];       // volcano axes (unit vectors, world)
uniform float uSeaLevel;        // current sea level in altitude units (0 = normal); falls with correlation
uniform float uStressTint[6];   // 'What if?' sandbox: predicted fall per continent → darker, redder land

// Shader works in the original units: planet radius 2 at the origin.
#define R_PLANET 2.0
#define SAND_COLOR vec3(1.0, 1.0, 0.85)
#define ICE_COLOR mix(vec3(.8,.9,.9),uRockColor*.6,uStress)
#define CLOUD_COLOR vec3(1.)
#define WATER_SURFACE_LEVEL 0.0
#define SAND_LEVEL .028
#define TREE_LEVEL .03
#define ROCK_LEVEL .1
#define ICE_LEVEL .15
#define TRANSITION .02
#define SUN_COLOR vec3(1.0, 1.0, 0.9)
#define INFINITY 1e10
#define PI 3.14159265

struct Material { vec3 color; float diffuse; float specular; };
struct Hit { float len; vec3 normal; Material material; };
Hit miss = Hit(INFINITY, vec3(0.), Material(vec3(0.), -1., -1.));

float inverseLerp(float v, float a, float b) { return (v - a) / (b - a); }
float remap(float v, float a, float b, float c, float d) { return mix(c, d, inverseLerp(v, a, b)); }

float noise(vec3 p) { return texture(uNoiseTexture, p * .05).r; }

// https://iquilezles.org/articles/intersectors/
float sphIntersect(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - r * r);
  if(h < 0.0) return -1.;
  return -b - sqrt(h);
}

// SimonDev — https://simondev.teachable.com/p/glsl-shaders-from-scratch
float fbm(vec3 p, int octaves, float persistence, float lacunarity, float exponentiation) {
  float amplitude = 0.5, frequency = 3.0, total = 0.0, normalization = 0.0;
  int n = max(octaves - (2 - int(floor(uQuality))), 1);
  for(int i = 0; i < n; ++i) {
    total += noise(p * frequency) * amplitude;
    normalization += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  total = total / normalization * 0.8 + 0.1;
  return pow(total, exponentiation);
}

float domainWarpingFBM(vec3 p, int octaves, float persistence, float lacunarity, float exponentiation) {
  vec3 offset = vec3(fbm(p, octaves, persistence, lacunarity, exponentiation),
                     fbm(p + vec3(43.235, 23.112, 0.0), octaves, persistence, lacunarity, exponentiation), 0.0);
  return fbm(p + offset, 2, persistence, lacunarity, exponentiation);
}

//===================== Market Worlds: sector continents =====================//
// Nearest continent to direction n (index), its land mask (0 ocean .. 1 land).
int nearestContinent(vec3 n, out float bestDot) {
  int best = 0; bestDot = -2.;
  for(int i = 0; i < 6; i++) {
    float d = dot(n, uContinentDir[i]);
    if(d > bestDot) { bestDot = d; best = i; }
  }
  return best;
}

// Organic continent shape. Each continent gets its own size, stretch and orientation, then
// its coastline is domain-warped into bays and peninsulas (the centre stays solid so the
// mountains always stand on land). Small offshore islands are scattered near the coast.
float hash1(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
float continentShape(vec3 local, int i, out float islands) {
  float fi = float(i);
  vec3 seed = vec3(fi * 17.3, fi * 5.1, fi * 2.7);
  float size = .82 + .36 * hash1(fi + 1.);               // continents differ in size
  float stretch = .68 + .64 * hash1(fi + 7.);            // and in elongation
  float rot = hash1(fi + 3.) * 6.2832;
  vec2 t = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * local.xy;
  t = vec2(t.x * stretch, t.y / stretch);
  float r0 = length(t);
  float edgeWeight = smoothstep(.06, .3, r0);             // warp the coast, not the heartland
  vec2 w1 = vec2(noise(local * 3.2 + seed), noise(local * 3.2 + seed + 19.)) - .5;
  vec2 w2 = vec2(noise(local * 8.5 + seed + 5.), noise(local * 8.5 + seed + 41.)) - .5;
  t += (w1 * .42 + w2 * .12) * edgeWeight;
  float d = length(t) / (sin(uContinentCap) * size);
  d += ((noise(local * 24. + seed) - .5) * .1 + (noise(local * 60. + seed) - .5) * .04) * edgeWeight;
  // Islands: noise peaks in a band just offshore
  float band = smoothstep(1.0, 1.06, d) * (1. - smoothstep(1.18, 1.32, d));   // just offshore only
  islands = smoothstep(.78, .83, noise(local * 14. + seed + 7.)) * band;        // a few, not a scatter
  return d;   // < 1 inside the coastline
}

// Altitude in the original shader's units (land > SAND_LEVEL)
float terrainAltitude(vec3 n, out int best) {
  float bd;
  best = nearestContinent(n, bd);
  vec3 local = uContinentRot[best] * n;                // continent frame (centre = +Z)
  vec3 seed = vec3(float(best) * 17.3, float(best) * 5.1, 0.);
  float islands;
  float ang = continentShape(local, best, islands);
  float mask = max(1. - smoothstep(.9, 1.0, ang), islands);
  float h = fbm(local * R_PLANET * uTerrainScale + seed, 6, .5, 2., 5.) * uNoiseStrength * 5.;
  float land = SAND_LEVEL + .008 + h * 1.25 * max(smoothstep(1.0, .55, ang), islands * .4); // flatter near the coast
  // Ocean floor: deep, rising to a narrow continental shelf near the coast (exposed when the sea falls)
  float floorNoise = (noise(n * 7. + 2.) - .5) * .03;
  float ocean = mix(-.15 + floorNoise, -.034, smoothstep(1.22, 1.0, ang));
  return mix(ocean, land, mask);
}
float planetNoise(vec3 p) { int b; return terrainAltitude(normalize(p), b) / 5.; }

// Tangent-frame finite differences (Gareth's numerically safer normal)
vec3 planetNormal(vec3 p) {
  vec3 n = normalize(p);
  vec3 axis = abs(n.y) > .95 ? vec3(1., 0., 0.) : vec3(0., 1., 0.);
  vec3 t = normalize(cross(axis, n)), b = cross(n, t);
  float e = .015;
  float h = planetNoise(p), ht = planetNoise(p + t * e), hb = planetNoise(p + b * e);
  return normalize(n - t * (ht - h) / e - b * (hb - h) / e);
}

vec3 atmosphereColor(vec3 ro, vec3 rd, float spaceMask) {
  float distCam = length(ro);
  float distEdge = sqrt(max(distCam * distCam - R_PLANET * R_PLANET, 0.));
  vec3 coordFromCenter = ro + rd * distEdge;
  float distFromEdge = abs(length(coordFromCenter) - R_PLANET);
  float planetEdge = max(R_PLANET - distFromEdge, 0.) / R_PLANET;
  float planetMask = 1.0 - spaceMask;
  float atmosphereMask = pow(max(0., remap(dot(uSunDirection, coordFromCenter), -R_PLANET, R_PLANET / 2., 0., 1.)), 5.);
  atmosphereMask = max(atmosphereMask, .18) * uAtmosphereDensity * R_PLANET * uSunIntensity; // keep a faint rim on the night side
  vec3 a = vec3(pow(planetEdge, 120.)) * .5;
  a += pow(planetEdge, 50.) * .3 * (1.5 - planetMask);
  a += pow(planetEdge, 22.) * .025;    // thin rim
  return a * uAtmosphereColor * atmosphereMask;
}

//=========== Volcanoes — Gareth's additions; profile adapted from TerraForge3D ===========//
// TerraForge3D volcano/shape.glsl, Copyright (c) 2022 Jaysmito Mukherjee, MIT.
float coneSDF(vec3 p, int i) {
  vec3 n = uVentDir[i], q = p - n * (R_PLANET - .045);
  float h = dot(q, n), radius = length(q - n * h);
  float r = max(0., radius + (noise(q * 24.) - .5) * .018);
  float craterRadius = .067, mountainOuter = .29;
  float mountainMask = 1. - smoothstep(craterRadius * .5, mountainOuter, r);
  float craterMask = 1. - smoothstep(0., craterRadius, r);
  float height = .34 * mountainMask - .34 * .9 * .3 * craterMask;
  height += (noise(q * 60.) - .5) * .018 * smoothstep(craterRadius, mountainOuter, r) * mountainMask;
  return max(max(h - height * uEruption, -h), radius - mountainOuter) * .38;
}
vec3 lavaEmission(vec3 p) {
  if(uEruption < .01) return vec3(0.);
  float glow = 0.;
  for(int i = 0; i < 2; i++) {
    vec3 n = uVentDir[i], q = p - n * R_PLANET;
    vec3 t = normalize(cross(n, abs(n.y) > .95 ? vec3(1., 0., 0.) : vec3(0., 1., 0.))), b = cross(n, t);
    float r = length(q - n * dot(q, n));
    float flow = sin(atan(dot(q, b), dot(q, t)) * 7. + r * 16. + noise(p * 9.) * 7. - uTime * .9);
    float channel = 1. - smoothstep(.035, .14, abs(flow));
    float pool = 1. - smoothstep(.035, .12, r);
    glow += max(channel * .7, pool) * exp(-r * 3.8) * step(r, .95);
  }
  return mix(vec3(5., .17, .008), vec3(8., 1.9, .09), clamp(glow, 0., 1.)) * glow * uEruption;
}
Hit intersectVolcano(vec3 ro, vec3 rd) {
  if(uEruption < .01) return miss;
  Hit result = miss;
  for(int i = 0; i < 2; i++) {
    float start = sphIntersect(ro, rd, uVentDir[i] * (R_PLANET + .12), .48);
    if(start < 0.) continue;
    float t = start;
    for(int j = 0; j < 28; j++) {
      vec3 p = ro + rd * t;
      float d = coneSDF(p, i);
      if(d < .002) {
        vec2 e = vec2(.003, 0.);
        vec3 n = normalize(vec3(coneSDF(p + e.xyy, i) - coneSDF(p - e.xyy, i),
          coneSDF(p + e.yxy, i) - coneSDF(p - e.yxy, i), coneSDF(p + e.yyx, i) - coneSDF(p - e.yyx, i)));
        if(t < result.len) result = Hit(t, n, Material(vec3(.055, .032, .022), 1., .05));
        break;
      }
      t += max(d, .004);
      if(t > start + .98) break;
    }
  }
  return result;
}
// Returns colour over `background`; alpha accumulates ash opacity for see-through space.
vec4 volcanicAtmosphere(vec3 ro, vec3 rd, vec4 background, float sceneDepth) {
  if(uEruption < .01) return background;
  vec4 result = background;
  for(int i = 0; i < 2; i++) {
    vec3 axis = uVentDir[i], vent = axis * (R_PLANET + .30);
    float start = sphIntersect(ro, rd, vent + axis * .48, .77);
    if(start < 0.) continue;
    vec3 smoke = vec3(0.); float alpha = 0.;
    for(int j = 0; j < 22; j++) {
      float t = start + float(j) * .065;
      if(t >= sceneDepth) break;
      vec3 p = ro + rd * t - vent;
      float h = dot(p, axis);
      float radius = length(p - axis * h - vec3(.15, 0., -.05) * h * h);
      float width = .055 + max(h, 0.) * .26;
      float shape = (1. - smoothstep(width * .35, width, radius)) * smoothstep(-.08, .06, h) * (1. - smoothstep(.85, 1.15, h));
      float turbulence = fbm(p * 6. - axis * uTime * .65, 3, .5, 2., 1.);
      float density = shape * smoothstep(.22, .65, turbulence) * uEruption;
      float a = 1. - exp(-density * .5);
      float heat = exp(-max(h, 0.) * 8.) * (1. - smoothstep(.01, .1, radius));
      vec3 smokeColor = mix(vec3(.055, .059, .063), vec3(.19, .17, .15), turbulence) + vec3(7., 1.15, .025) * heat;
      smoke += (1. - alpha) * a * smokeColor;
      alpha += (1. - alpha) * a;
    }
    result.rgb = result.rgb * (1. - alpha) + smoke;
    result.a = result.a + (1. - result.a) * alpha;
    // Ejected glowing fragments on ballistic paths around the vent
    vec3 tangent = normalize(cross(axis, abs(axis.y) > .95 ? vec3(1., 0., 0.) : vec3(0., 1., 0.))), bitangent = cross(axis, tangent);
    for(int k = 0; k < 12; k++) {
      float id = float(k), life = fract(uTime * .42 + id * .0833), angle = id * 2.39996;
      vec3 particle = vent + axis * (life * 1.45 - life * life * 1.65) + (tangent * cos(angle) + bitangent * sin(angle)) * life * .36;
      float hit = sphIntersect(ro, rd, particle, .009 * (1. - life) + .004);
      if(hit > 0. && hit < sceneDepth) { result.rgb += vec3(5., .8, .015) * (1. - life) * uEruption; result.a = 1.; }
    }
  }
  return result;
}

//========================== Ray tracing ==========================//
Hit intersectPlanet(vec3 ro, vec3 rd) {
  float len = sphIntersect(ro, rd, vec3(0.), R_PLANET);
  if(len < 0.) return miss;
  vec3 position = ro + len * rd;
  vec3 n = normalize(position);
  int best;
  float altitude = terrainAltitude(n, best);
  vec3 normal = planetNormal(position);

  vec3 tree = uContinentColor[best] * .35;                       // each sector its own colour
  vec3 rock = mix(uRockColor, uContinentColor[best] * .5, .35);
  // ── Sea level: water where the terrain is below uSeaLevel, coloured by depth
  float depth = uSeaLevel - altitude;                                  // > 0 under water
  vec3 color = mix(uWaterSurface, uWaterDeep, smoothstep(0., .09, depth));
  float above = smoothstep(.0008, -.0008, depth);                      // 1 = above the current sea
  float seabed = 1. - smoothstep(-.003, .003, altitude - WATER_SURFACE_LEVEL); // 1 = below the normal shoreline

  // Exposed seabed: wet sand at the waterline drying to white salt flats (distinct from land)
  float dryness = smoothstep(0., .03, -depth) * (.55 + .45 * noise(n * 34.));
  vec3 flats = mix(vec3(.30, .26, .19), vec3(.80, .74, .6), dryness);       // wet sand → pale salt flats
  color = mix(color, flats, above * seabed);

  // Continents above the normal shoreline keep their normal colours
  vec3 landCol = mix(SAND_COLOR, tree, smoothstep(TREE_LEVEL, TREE_LEVEL + TRANSITION, altitude));
  landCol = mix(landCol, rock, smoothstep(ROCK_LEVEL, ROCK_LEVEL + TRANSITION, altitude));
  landCol = mix(landCol, ICE_COLOR, smoothstep(ICE_LEVEL, ICE_LEVEL + TRANSITION, altitude));
  color = mix(color, landCol, above * (1. - seabed));
  float stressed = uStressTint[best] * above * (1. - seabed);
  color = mix(color, color * vec3(.5, .16, .1) + vec3(.06, .008, 0.), stressed * .85);

  // Foam line where the sea meets the shore, and a faint ring at the normal shoreline
  float foam = (1. - smoothstep(0., .0035, abs(depth))) * (.55 + .45 * noise(n * 70. + uTime * .25));
  color = mix(color, vec3(.95, .97, 1.), foam * .85);
  float lowered = smoothstep(-.002, -.012, uSeaLevel);
  float normalShore = (1. - smoothstep(0., .0025, abs(altitude - WATER_SURFACE_LEVEL))) * lowered * above;
  color = mix(color, vec3(.7, .82, .95), normalShore * .35);

  // Polar ice caps (planet axis = world Y), ragged edges
  float ice = smoothstep(.84, .9, abs(n.y) + (noise(n * 9.) - .5) * .12 + (noise(n * 31.) - .5) * .04);
  color = mix(color, vec3(.86, .91, .96), ice);

  // Clouds: density from VIX (uCloudsDensity), darker with storm
  vec3 cloudsCoord = (n * R_PLANET + vec3(uTime * .008 * uCloudsSpeed)) * uCloudsScale;
  float clouds = remap(domainWarpingFBM(cloudsCoord, 3, .3, 5., uCloudsScale), -1.0, 1.0, 0.0, 1.0);
  float threshold = 1. - uCloudsDensity * .5;
  clouds *= smoothstep(threshold, threshold + .1, clouds);
  vec3 cloudColor = mix(CLOUD_COLOR, vec3(.10, .13, .17), uStorm * .88);
  color = mix(color, cloudColor, clouds);
  float front = fbm(n * R_PLANET * 2. + vec3(uTime * .014, 0., 0.), 4, .55, 2., 1.);
  float stormCover = smoothstep(.35, .66, front) * uStorm;
  color = mix(color, cloudColor, stormCover * .83);
  color += vec3(.35, .45, .7) * uFlash * max(stormCover, clouds) * 1.2;     // lightning (VIX > 40)
  float coastGlow = 1. - smoothstep(.002, .012, abs(altitude - SAND_LEVEL));
  color += uAccent * coastGlow * uStress * .18;

  float specular = (1. - above) * (1. - ice);                     // only open water reflects the sun
  return Hit(len, normal, Material(color, 1., specular * (1. - stormCover)));
}

void main() {
  // Ray from the Three.js camera, converted into planet units (radius 2 at origin)
  float k = R_PLANET / uWorldRadius;
  vec3 ro = (cameraPosition - uPlanetPosition) * k;
  vec3 rd = normalize(vWorldPos - cameraPosition);

  Hit hit = intersectPlanet(ro, rd);
  Hit volcano = intersectVolcano(ro, rd);
  if(volcano.len < hit.len) hit = volcano;

  vec4 color = vec4(0.);
  float spaceMask = 1.;
  if(hit.len < INFINITY) {
    spaceMask = 0.;
    vec3 hitPosition = ro + hit.len * rd;
    float direct = pow(clamp(dot(hit.normal, uSunDirection), 0.0, 1.0), 2.) * uSunIntensity;
    vec3 diffuse = hit.material.color * (uAmbientLight + direct * SUN_COLOR);
    vec3 reflected = normalize(reflect(-uSunDirection, hit.normal));
    float spec = max(0.0, dot(rd, reflected));
    float glint = pow(spec, 120.) * 1.6 + pow(spec, 14.) * .06;         // sunlight glinting off the ocean
    color = vec4(diffuse + hit.material.specular * glint * uSunIntensity * SUN_COLOR, 1.);
    // Atmospheric haze: thicker towards the limb, on the day side (gives the planet depth)
    vec3 sphereN = normalize(hitPosition);
    float limb = pow(1. - max(dot(sphereN, -rd), 0.), 2.5);
    float day = smoothstep(-.15, .35, dot(sphereN, uSunDirection));
    color.rgb += uAtmosphereColor * limb * day * .28 * uSunIntensity / 1.5;
    if(length(hitPosition) < R_PLANET + .4) color.rgb += lavaEmission(hitPosition);
  }
  color.rgb += atmosphereColor(ro, rd, spaceMask) * (1. - uStorm * .55);
  color = volcanicAtmosphere(ro, rd, color, hit.len);

  // Depth: real planet surface depth so mesh mountains are hidden/visible correctly
  if(hit.len < INFINITY) {
    vec3 worldHit = uPlanetPosition + (ro + rd * hit.len) / k;
    vec4 clip = projectionMatrix * viewMatrix * vec4(worldHit, 1.);
    gl_FragDepth = clip.z / clip.w * .5 + .5;
  } else {
    gl_FragDepth = 1.0;                 // atmosphere/ash over space: never occludes
    if(dot(color.rgb, vec3(1.)) < .002 && color.a < .01) discard;
  }
  // Premultiplied: rgb added on top of space, alpha hides what is behind (planet/ash)
  fragColor = color;
}
