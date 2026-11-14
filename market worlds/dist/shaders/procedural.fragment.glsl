#version 300 es
//=======================================================================================//
//
// Procedural Blue Planet
// by Julien Sulpis (https://twitter.com/jsulpis)      
// https://www.shadertoy.com/view/Ds3XRl
//
//=======================================================================================//


// Modified for Market Worlds, 14 Nov 2026. GPL-3.0.
// Changes: chapter palettes, seeded noise, external moon positions, rings,
// zoom/tilt input and numerical safeguards. Original author credit above.


precision highp float;
precision mediump int;
precision mediump sampler3D;

in vec2 uv;
out vec4 fragColor;

//===================//
//  Global uniforms  //
//===================//

uniform float uTime;
uniform float uEruption, uStorm;
uniform float uRotationOffset;
uniform float uTilt, uStress, uSeed, uRingRadius, uRingWidth;
uniform vec3 uWaterDeep, uWaterSurface, uTreeColor, uRockColor, uAccent;
uniform vec3 uMoonPositions[3], uMoonColors[3];
uniform float uMoonRadii[3];
uniform vec2 uResolution;
uniform sampler3D uNoiseTexture;

//==========================//
//  Controllable  uniforms  //
//==========================//

uniform float uQuality;
uniform vec3 uPlanetPosition;
uniform float uPlanetRadius;
uniform float uNoiseStrength;
uniform float uCloudsDensity;
uniform float uCloudsScale;
uniform float uCloudsSpeed;
uniform float uTerrainScale;
uniform vec3 uAtmosphereColor;
uniform float uAtmosphereDensity;
uniform float uSunIntensity;
uniform float uAmbientLight;
in vec3 uSunDirection;

//==========================================================//
//  Constants (could be turned into controllable uniforms)  //
//==========================================================//

// Planets geometry
#define ROTATION_SPEED .1
#define PLANET_ROTATION (rotate3d(vec3(1.,0.,0.),uTilt) * rotateY(uTime * ROTATION_SPEED + uRotationOffset))

#define MOON_RADIUS .08
#define MOON_ROTATION_SPEED - ROTATION_SPEED * 5.
#define MOON_OFFSET vec3(uPlanetRadius * 1.2, uPlanetRadius / 4., 0.)
#define MOON_ROTATION_AXIS (MOON_OFFSET - uPlanetPosition) * rotateZ(PI/2.)

// Planet colors
#define WATER_COLOR_DEEP uWaterDeep
#define WATER_COLOR_SURFACE uWaterSurface
#define SAND_COLOR vec3(1.0, 1.0, 0.85)
#define TREE_COLOR uTreeColor
#define ROCK_COLOR uRockColor
#define ICE_COLOR mix(vec3(.8,.9,.9),uRockColor*.6,uStress)
#define CLOUD_COLOR  vec3(1., 1., 1.)

#define WATER_SURFACE_LEVEL 0.0
#define SAND_LEVEL .028
#define TREE_LEVEL .03
#define ROCK_LEVEL .1
#define ICE_LEVEL .15
#define TRANSITION .02

// Lighting
#define SUN_COLOR vec3(1.0, 1.0, 0.9)
#define DEEP_SPACE vec3(0., 0., 0.001)

// Ray tracing
#define EPSILON 1e-3
#define INFINITY 1e10
#define CAMERA_POSITION vec3(0., 0., 6.0)

#define PI acos(-1.)

//=========//
//  Types  //
//=========//

struct Material {
  vec3 color;
  float diffuse;
  float specular;
};

struct Hit {
  float len;
  vec3 normal;
  Material material;
};

struct Sphere {
  vec3 position;
  float radius;
};

// Note: I had created a struct for Ray but then deleted it because it caused artifacts on some mobile devices
// because of a precision issue with struct (https://github.com/KhronosGroup/WebGL/issues/3351)
// I use ro and rd instead in this shader.

Hit miss = Hit(INFINITY, vec3(0.), Material(vec3(0.), -1., -1.));

Sphere getPlanet() {
  return Sphere(uPlanetPosition, uPlanetRadius);
}

//===============================================//
//  Generic utilities stolen from smarter people //
//===============================================//

float inverseLerp(float v, float minValue, float maxValue) {
  return (v - minValue) / (maxValue - minValue);
}

float remap(float v, float inMin, float inMax, float outMin, float outMax) {
  float t = inverseLerp(v, inMin, inMax);
  return mix(outMin, outMax, t);
}

float noise(vec3 p) {
  return texture(uNoiseTexture, p * .05 + vec3(uSeed*.07,0.,uSeed*.03)).r;
}

// https://iquilezles.org/articles/intersectors/
float sphIntersect(in vec3 ro, in vec3 rd, in Sphere sphere) {
  vec3 oc = ro - sphere.position;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - sphere.radius * sphere.radius;
  float h = b * b - c;
  if(h < 0.0)
    return -1.; // no intersection
  return -b - sqrt(h);
}

// Comes from a course by SimonDev (https://www.youtube.com/channel/UCEwhtpXrg5MmwlH04ANpL8A)
// https://simondev.teachable.com/p/glsl-shaders-from-scratch
float fbm(vec3 p, int octaves, float persistence, float lacunarity, float exponentiation) {
  float amplitude = 0.5;
  float frequency = 3.0;
  float total = 0.0;
  float normalization = 0.0;
  int qualityDegradation = 2 - int(floor(uQuality)); // 0 when quality=optimal, 2 when quality=low
  int octavesWithQuality = max(octaves - qualityDegradation, 1);

  for(int i = 0; i < octavesWithQuality; ++i) {
    float noiseValue = noise(p * frequency);
    total += noiseValue * amplitude;
    normalization += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  total /= normalization;
  total = total * 0.8 + 0.1;
  total = pow(total, exponentiation);

  return total;
}

mat3 rotateY(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat3(//
    vec3(c, 0, s),//
    vec3(0, 1, 0),//
    vec3(-s, 0, c)//
  );
}

mat3 rotateZ(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat3(//
    vec3(c, -s, 0),//
    vec3(s, c, 0),//
    vec3(0, 0, 1)//
  );
}

// https://github.com/dmnsgn/glsl-rotate/blob/main/rotation-3d.glsl
mat3 rotate3d(vec3 axis, float angle) {
  axis = normalize(axis);
  float s = sin(angle);
  float c = cos(angle);
  float oc = 1.0 - c;

  return mat3(//
    oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s,//
    oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s,//
    oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c//
  );
}

// nimitz - https://www.shadertoy.com/view/XsyGWV
// I reused the 3D noise texture instead of nimitz's hash function for better performance
vec3 stars(in vec3 p) {
  vec3 c = vec3(0.);
  float res = uResolution.x * uQuality * 0.8;

  for(float i = 0.; i < 3.; i++) {
    vec3 q = fract(p * (.15 * res)) - 0.5;
    vec3 id = floor(p * (.15 * res));
    vec2 rn = vec2(noise(id/2.), noise(id.zyx*2.))*.03;
    float c2 = 1. - smoothstep(0., .6, length(q));
    c2 *= step(rn.x, .003 + i * 0.0005);
    c += c2 * (mix(vec3(1.0, 0.49, 0.1), vec3(0.75, 0.9, 1.), rn.y) * 0.25 + 1.2);
    p *= 1.8;
  }
  return c * c;
}

// Comes from a course by SimonDev (https://www.youtube.com/channel/UCEwhtpXrg5MmwlH04ANpL8A)
// https://simondev.teachable.com/p/glsl-shaders-from-scratch
float domainWarpingFBM(vec3 p, int octaves, float persistence, float lacunarity, float exponentiation) {
  vec3 offset = vec3(//
    fbm(p, octaves, persistence, lacunarity, exponentiation), //
    fbm(p + vec3(43.235, 23.112, 0.0), octaves, persistence, lacunarity, exponentiation), //
    0.0//
  );

  return fbm(p + 1. * offset, 2, persistence, lacunarity, exponentiation);
}

// Zavie - https://www.shadertoy.com/view/lslGzl
vec3 simpleReinhardToneMapping(vec3 color) {
  float exposure = 1.5;
  color *= exposure / (1. + color / exposure);
  color = pow(color, vec3(1. / 2.4));
  return color;
}


//========//
//  Misc  //
//========//

float planetNoise(vec3 p) {
  float fbm = fbm(p * uTerrainScale, 6, .5, 2., 5.) * uNoiseStrength;

  // Flatten the noise on the oceans
  return mix(//
    fbm / 3. + uNoiseStrength / 50., //
    fbm, //
    smoothstep(SAND_LEVEL, SAND_LEVEL + TRANSITION / 2., fbm * 5.)//
  );
}

/**
* Standard ray-sphere intersection but with fbm noise added on the radius.
* Probably not exact (especially near the edges), but it looks good enough
*/
float planetDist(in vec3 ro, in vec3 rd) {
  float smoothSphereDist = sphIntersect(ro, rd, getPlanet());

  vec3 intersection = ro + smoothSphereDist * rd;
  vec3 intersectionWithRotation = PLANET_ROTATION * (intersection - uPlanetPosition) + uPlanetPosition;

  return sphIntersect(ro, rd, Sphere(uPlanetPosition, uPlanetRadius + planetNoise(intersectionWithRotation)));
}

// Market Worlds: finite differences along the surface tangent frame avoid
// the upstream normal estimate depending on a non-unit intersection ray.
vec3 planetNormal(vec3 p) {
  vec3 n=normalize(p-uPlanetPosition);
  vec3 axis=abs(n.y)>.95?vec3(1.,0.,0.):vec3(0.,1.,0.);
  vec3 t=normalize(cross(axis,n));
  vec3 b=cross(n,t);
  float e=.015;
  float h=planetNoise(PLANET_ROTATION*(p-uPlanetPosition)+uPlanetPosition);
  float ht=planetNoise(PLANET_ROTATION*(p+t*e-uPlanetPosition)+uPlanetPosition);
  float hb=planetNoise(PLANET_ROTATION*(p+b*e-uPlanetPosition)+uPlanetPosition);
  return normalize(n-t*(ht-h)/e-b*(hb-h)/e);
}

vec3 currentMoonPosition() { return uMoonPositions[0]; }

vec3 spaceColor(vec3 direction) {
  mat3 backgroundRotation = rotateY(uTime * ROTATION_SPEED / 4.);
  vec3 backgroundCoord = direction * backgroundRotation;
  float spaceNoise = fbm(backgroundCoord * 3., 4, .5, 2., 6.);

  vec3 clearSky=stars(backgroundCoord)*.45 + mix(DEEP_SPACE,uAtmosphereColor/24.,spaceNoise);
  float fog=fbm(direction*4.+vec3(uTime*.013,0.,0.),4,.5,2.,1.);
  vec3 gloomy=mix(vec3(.002,.004,.007),vec3(.025,.032,.043),fog);
  return mix(clearSky,gloomy,uStorm*.94);
}

vec3 atmosphereColor(vec3 ro, vec3 rd, float spaceMask, Hit firstHit) {
  vec3 position = ro + firstHit.len * rd;
  
  float distCameraToPlanetOrigin = length(uPlanetPosition - CAMERA_POSITION);
  float distCameraToPlanetEdge = sqrt(distCameraToPlanetOrigin * distCameraToPlanetOrigin - uPlanetRadius * uPlanetRadius);
  float nearestMoon = 0.;
  float nearestDistance = INFINITY;
  for(int i=0;i<3;i++) {
    float d=length(position-uMoonPositions[i]);
    if(d<nearestDistance){nearestDistance=d;nearestMoon=float(i);}
  }
  float distCameraToMoon = length(uMoonPositions[int(nearestMoon)] - CAMERA_POSITION);
  float isMoonInFront = smoothstep(-uPlanetRadius/2., uPlanetRadius/2., distCameraToPlanetEdge - distCameraToMoon);

  float moonMask = (1.0 - spaceMask) * step(uPlanetRadius + EPSILON, length(position - uPlanetPosition));
  float planetMask = 1.0 - spaceMask - moonMask;

  vec3 coordFromCenter = (ro + rd * distCameraToPlanetEdge) - uPlanetPosition;
  float distFromEdge = abs(length(coordFromCenter) - uPlanetRadius);
  float planetEdge = max(uPlanetRadius - distFromEdge, 0.) / uPlanetRadius;
  float atmosphereMask = pow(max(0., remap(dot(uSunDirection, coordFromCenter), -uPlanetRadius, uPlanetRadius / 2., 0., 1.)), 5.);
  atmosphereMask *= uAtmosphereDensity * uPlanetRadius * uSunIntensity;

  vec3 atmosphere = vec3(pow(planetEdge, 120.)) * .5;
  atmosphere += pow(planetEdge, 50.) * .3 * (1.5 - planetMask);
  atmosphere += pow(planetEdge, 15.) * .03;
  atmosphere += pow(planetEdge, 5.) * .04 * planetMask;

  return atmosphere * uAtmosphereColor * atmosphereMask * (1. - moonMask * isMoonInFront);
}


// Volcanic cones, lava channels and ash volumes — Market Worlds additions.
vec3 ventAxis(int i) {
  return normalize(i==0?vec3(-.42,.52,.74):vec3(.43,-.12,.89));
}
vec3 toWorld(vec3 p) { return transpose(PLANET_ROTATION)*p+uPlanetPosition; }
vec3 toLocal(vec3 p) { return PLANET_ROTATION*(p-uPlanetPosition); }
// Volcano height profile adapted from TerraForge3D's volcano/shape.glsl.
// Copyright (c) 2022 Jaysmito Mukherjee. MIT; see licenses/TerraForge3D.txt.
// Browser adaptation: tangent-plane coordinates, local texture noise and
// conservative height-field marching in place of the desktop compute pipeline.
float coneSDF(vec3 p,int i) {
  vec3 n=ventAxis(i),q=p-n*(uPlanetRadius-.045);
  float h=dot(q,n),radius=length(q-n*h);
  float distortion=(noise(q*24.)-.5)*.018;
  float r=max(0.,radius+distortion);
  float craterRadius=.067, mountainOuter=.29;
  float mountainMask=1.-smoothstep(craterRadius*.5,mountainOuter,r);
  float craterMask=1.-smoothstep(0.,craterRadius,r);
  float height=.34*mountainMask-.34*.9*.3*craterMask;
  float outsideMask=smoothstep(craterRadius,mountainOuter,r);
  height+=(noise(q*60.)-.5)*.018*outsideMask*mountainMask;
  return max(max(h-height,-h),radius-mountainOuter)*.38;
}
vec3 lavaEmission(vec3 world) {
  if(uEruption<.01)return vec3(0.);
  vec3 p=toLocal(world);float glow=0.;
  for(int i=0;i<2;i++){
    vec3 n=ventAxis(i),q=p-n*uPlanetRadius;
    vec3 t=normalize(cross(n,vec3(0.,1.,0.))),b=cross(n,t);
    float r=length(q-n*dot(q,n));
    float angle=atan(dot(q,b),dot(q,t));
    float flow=sin(angle*7.+r*16.+noise(p*9.)*7.-uTime*.9);
    float channel=1.-smoothstep(.035,.14,abs(flow));
    float pool=1.-smoothstep(.035,.12,r);
    glow+=max(channel*.7,pool)*exp(-r*3.8)*step(r,.95);
  }
  return mix(vec3(5.,.17,.008),vec3(8.,1.9,.09),clamp(glow,0.,1.))*glow*uEruption;
}
Hit intersectVolcano(vec3 ro,vec3 rd) {
  if(uEruption<.01)return miss;
  Hit result=miss;
  for(int i=0;i<2;i++){
    vec3 center=toWorld(ventAxis(i)*(uPlanetRadius+.12));
    float start=sphIntersect(ro,rd,Sphere(center,.48));
    if(start<0.)continue;
    float t=start;
    for(int j=0;j<28;j++){
      vec3 p=toLocal(ro+rd*t);float d=coneSDF(p,i);
      if(d<.002){
        vec2 e=vec2(.003,0.);
        vec3 n=normalize(vec3(coneSDF(p+e.xyy,i)-coneSDF(p-e.xyy,i),
          coneSDF(p+e.yxy,i)-coneSDF(p-e.yxy,i),coneSDF(p+e.yyx,i)-coneSDF(p-e.yyx,i)));
        if(t<result.len)result=Hit(t,transpose(PLANET_ROTATION)*n,Material(vec3(.055,.032,.022),1.,.05));
        break;
      }
      t+=max(d,.004);if(t>start+.98)break;
    }
  }
  return result;
}
vec3 volcanicAtmosphere(vec3 ro,vec3 rd,vec3 background,float sceneDepth) {
  if(uEruption<.01)return background;
  vec3 result=background;
  for(int i=0;i<2;i++){
    vec3 axis=ventAxis(i),vent=axis*(uPlanetRadius+.30);
    vec3 bound=toWorld(vent+axis*.48);
    float start=sphIntersect(ro,rd,Sphere(bound,.77));
    if(start<0.)continue;
    vec3 smoke=vec3(0.);float alpha=0.;
    for(int j=0;j<22;j++){
      float t=start+float(j)*.065;if(t>=sceneDepth)break;
      vec3 p=toLocal(ro+rd*t)-vent;
      float h=dot(p,axis);
      vec3 drift=vec3(.15,0.,-.05)*h*h;
      float radius=length(p-axis*h-drift);
      float width=.055+max(h,0.)*.26;
      float shape=(1.-smoothstep(width*.35,width,radius))*smoothstep(-.08,.06,h)*(1.-smoothstep(.85,1.15,h));
      float turbulence=fbm(p*6.-axis*uTime*.65,3,.5,2.,1.);
      float density=shape*smoothstep(.22,.65,turbulence)*uEruption;
      float a=1.-exp(-density*.5);
      float heat=exp(-max(h,0.)*8.)*(1.-smoothstep(.01,.1,radius));
      vec3 smokeColor=mix(vec3(.055,.059,.063),vec3(.19,.17,.15),turbulence);
      smokeColor+=vec3(7.,1.15,.025)*heat;
      smoke+=(1.-alpha)*a*smokeColor;alpha+=(1.-alpha)*a;
    }
    result=result*(1.-alpha)+smoke;
    // Ejected glowing fragments on ballistic paths around the vent.
    for(int k=0;k<12;k++){
      float id=float(k),life=fract(uTime*.42+id*.0833);
      float angle=id*2.39996;
      vec3 tangent=normalize(cross(axis,vec3(0.,1.,0.))),bitangent=cross(axis,tangent);
      vec3 particle=vent+axis*(life*1.45-life*life*1.65)+
        (tangent*cos(angle)+bitangent*sin(angle))*life*.36;
      float hit=sphIntersect(ro,rd,Sphere(toWorld(particle),.009*(1.-life)+.004));
      if(hit>0.&&hit<sceneDepth)result+=vec3(5.,.8,.015)*(1.-life)*uEruption;
    }
  }
  return result;
}

//===============//
//  Ray Tracing  //
//===============//

Hit intersectPlanet(vec3 ro, vec3 rd) {
  float len = sphIntersect(ro, rd, getPlanet());

  if(len < 0.) {
    return miss;
  }

  vec3 position = ro + len * rd;
  vec3 rotatedCoord = PLANET_ROTATION * (position - uPlanetPosition) + uPlanetPosition;
  float altitude = 5. * planetNoise(rotatedCoord);

  vec3 normal = planetNormal(position);

  vec3 color = mix(WATER_COLOR_DEEP, WATER_COLOR_SURFACE, smoothstep(WATER_SURFACE_LEVEL, WATER_SURFACE_LEVEL + TRANSITION, altitude));
  color = mix(color, SAND_COLOR, smoothstep(SAND_LEVEL, SAND_LEVEL + TRANSITION / 2., altitude));
  color = mix(color, TREE_COLOR, smoothstep(TREE_LEVEL, TREE_LEVEL + TRANSITION, altitude));
  color = mix(color, ROCK_COLOR, smoothstep(ROCK_LEVEL, ROCK_LEVEL + TRANSITION, altitude));
  color = mix(color, ICE_COLOR, smoothstep(ICE_LEVEL, ICE_LEVEL + TRANSITION, altitude));

  vec3 cloudsCoord = (rotatedCoord + vec3(uTime * .008 * uCloudsSpeed)) * uCloudsScale;
  float cloudsDensity = remap(domainWarpingFBM(cloudsCoord, 3, .3, 5., uCloudsScale), -1.0, 1.0, 0.0, 1.0);
  float cloudsThreshold = 1. - uCloudsDensity * .5;
  cloudsDensity *= smoothstep(cloudsThreshold, cloudsThreshold + .1, cloudsDensity);
  cloudsDensity *= (1. - smoothstep((ROCK_LEVEL + TREE_LEVEL) / 2., ROCK_LEVEL, altitude));
  vec3 cloudColor=mix(CLOUD_COLOR,vec3(.10,.13,.17),uStorm*.88);
  color = mix(color,cloudColor,cloudsDensity);
  float front=fbm(rotatedCoord*2.+vec3(uTime*.014,0.,0.),4,.55,2.,1.);
  float stormCover=smoothstep(.35,.66,front)*uStorm;
  color=mix(color,cloudColor,stormCover*.83);
  float lightning=exp(-pow((fract(uTime/9.)-.7)*80.,2.));
  color+=vec3(.2,.3,.5)*lightning*stormCover*.22;
  float coastGlow = 1. - smoothstep(.002,.012,abs(altitude-SAND_LEVEL));
  color += uAccent * coastGlow * uStress * .18;

  float specular = (1. - smoothstep(SAND_LEVEL, SAND_LEVEL + TRANSITION, altitude));

  return Hit(len, normal, Material(color, 1., specular));
}

Hit intersectMoon(vec3 ro, vec3 rd) {
  Hit nearest = miss;
  for(int i=0;i<3;i++) {
    vec3 moonPosition = uMoonPositions[i];
    float len = sphIntersect(ro,rd,Sphere(moonPosition,uMoonRadii[i]));
    if(len < 0. || len >= nearest.len) continue;
    vec3 position = ro + len * rd;
    vec3 normal = normalize(position-moonPosition);
    float textureValue=sqrt(fbm(normal*12.,6,.5,2.,5.));
    nearest=Hit(len,normal,Material(uMoonColors[i]*(.25+textureValue),1.,0.));
  }
  return nearest;
}

// Market Worlds addition: a raycast annulus, driven by the Planet3D ring model.
Hit intersectRing(vec3 ro, vec3 rd) {
  vec3 normal=normalize(vec3(.1,1.,.35));
  float denominator=dot(rd,normal);
  if(abs(denominator)<.0001) return miss;
  float len=dot(uPlanetPosition-ro,normal)/denominator;
  if(len<0.) return miss;
  vec3 p=ro+len*rd-uPlanetPosition;
  float radius=length(p);
  if(abs(radius-uRingRadius)>uRingWidth*.5) return miss;
  float band=.2+.4*pow(.5+.5*sin(radius*170.),2.);
  return Hit(len,normal,Material(uAccent*band,1.,0.));
}

Hit intersectScene(vec3 ro, vec3 rd) {
  Hit planetHit = intersectPlanet(ro, rd);
  Hit moonHit = intersectMoon(ro, rd);
  Hit eruptionHit=intersectVolcano(ro,rd);
  if(eruptionHit.len<planetHit.len)planetHit=eruptionHit;
  Hit ringHit = intersectRing(ro, rd);
  if(ringHit.len < planetHit.len) planetHit=ringHit;

  if(moonHit.len < planetHit.len) {
    return moonHit;
  }

  return planetHit;
}

vec3 radiance(vec3 ro, vec3 rd) {
  vec3 color = vec3(0.);
  float spaceMask = 1.;
  Hit hit = intersectScene(ro, rd);

  if(hit.len < INFINITY) {
    spaceMask = 0.;

    vec3 hitPosition = ro + hit.len * rd;
    Hit shadowHit = intersectScene(hitPosition + EPSILON * uSunDirection, uSunDirection);
    float hitDirectLight = clamp(
      step(INFINITY, shadowHit.len) 
      + step(length(hitPosition - uPlanetPosition) - uPlanetRadius, .1), // don't cast shadow on the planet, only the moon
      0., 
      1.
    );

    // Diffuse
    float directLightIntensity = pow(clamp(dot(hit.normal, uSunDirection), 0.0, 1.0), 2.) * uSunIntensity; // the power softens the shadow. Not physically accurate but it looks better to me
    vec3 diffuseLight = hitDirectLight * directLightIntensity * SUN_COLOR;
    vec3 diffuseColor = hit.material.color.rgb * (uAmbientLight + diffuseLight);

    // Phong specular
    vec3 reflected = normalize(reflect(-uSunDirection, hit.normal));
    float phongValue = pow(max(0.0, dot(rd, reflected)), 10.) * .2 * uSunIntensity;
    vec3 specularColor = hit.material.specular * vec3(phongValue);

    color = diffuseColor + specularColor;
    if(length(hitPosition-uPlanetPosition)<uPlanetRadius+.4)color+=lavaEmission(hitPosition);
  } else {
    color = spaceColor(rd);
  }
  
  color+=atmosphereColor(ro,rd,spaceMask,hit)*(1.-uStorm*.55);
  return volcanicAtmosphere(ro,rd,color,hit.len);
}

//========//
//  Main  //
//========//

void main() {
  vec3 ro = vec3(CAMERA_POSITION);
  vec3 rd = normalize(vec3(uv, -1));

  vec3 color = radiance(ro, rd);

  // color grading
  color = simpleReinhardToneMapping(color);

  // vignette
  color *= 1. - 0.5 * pow(length(uv), 3.);

  vec2 screen = gl_FragCoord.xy / uResolution;
  float edge = min(min(screen.x,1.-screen.x),min(screen.y,1.-screen.y));
  color = mix(vec3(.035294,.07451,.062745),color,smoothstep(0.,.12,edge));
  fragColor = vec4(color, 1.0);
}