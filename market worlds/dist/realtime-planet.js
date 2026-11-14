/*
 * Market Worlds adapter for Julien Sulpis' realtime-planet-shader.
 * GPL-3.0; see licenses/realtime-planet-shader.txt and source.zip.
 * Uses the actual adapted procedural GLSL in shaders/procedural.fragment.glsl.
 * Planet/Moon orbital positions retain the MIT Planet3D model.
 */
(function(global){
"use strict";
const vertexSource=`#version 300 es
precision highp float;
in vec2 position;
uniform vec2 uResolution;
uniform float uZoom;
out vec2 uv;
out vec3 uSunDirection;
void main(){
 uv=position*uResolution/min(uResolution.x,uResolution.y)*.5*uZoom;
 uSunDirection=normalize(vec3(-.8,.6,.6));
 gl_Position=vec4(position,0.,1.);
}`;
class RealtimePlanetView {
 static async create(canvas) {
   const response=await fetch("shaders/procedural.fragment.glsl");
   if(!response.ok)throw Error("Planet shader could not be loaded");
   return new RealtimePlanetView(canvas,await response.text());
 }
 constructor(canvas,fragmentSource){
   this.canvas=canvas;this.fragmentSource=fragmentSource;
   this.gl=canvas.getContext("webgl2",{alpha:false,antialias:false});
   if(!this.gl)throw Error("WebGL 2 is unavailable");
   this.yaw=.6;this.tilt=.2;this.zoomLevel=1;this.time=0;this.activeIndex=-1;this.dragging=false;this.lost=false;
   this.setup();
   this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);
   let lastX=0,lastY=0;
   canvas.addEventListener("pointerdown",e=>{this.dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
   canvas.addEventListener("pointermove",e=>{if(!this.dragging)return;this.yaw+=(e.clientX-lastX)*.008;
     if(e.pointerType!=="touch")this.tilt=Math.max(-1,Math.min(1,this.tilt+(e.clientY-lastY)*.005));lastX=e.clientX;lastY=e.clientY;});
   for(const event of ["pointerup","pointercancel","lostpointercapture"])canvas.addEventListener(event,()=>this.dragging=false);
   canvas.addEventListener("keydown",e=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","=","-"].includes(e.key))return;e.preventDefault();
     if(e.key==="ArrowLeft")this.yaw-=.15;if(e.key==="ArrowRight")this.yaw+=.15;
     if(e.key==="ArrowUp")this.tilt=Math.min(1,this.tilt+.1);if(e.key==="ArrowDown")this.tilt=Math.max(-1,this.tilt-.1);
     if(e.key==="+"||e.key==="=")this.zoom(-.25);if(e.key==="-")this.zoom(.25);});
   canvas.addEventListener("webglcontextlost",e=>{e.preventDefault();this.lost=true;canvas.dispatchEvent(new CustomEvent("planet3d-unavailable"));});
   canvas.addEventListener("webglcontextrestored",()=>{try{this.setup();this.lost=false;canvas.dispatchEvent(new CustomEvent("planet3d-ready"));}catch(error){console.warn(error.message);}});
   canvas.dataset.renderer="jsulpis-realtime-planet-shader";
 }
 setup(){
   const gl=this.gl;
   const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(error);}return shader;};
   const vs=compile(gl.VERTEX_SHADER,vertexSource),fs=compile(gl.FRAGMENT_SHADER,this.fragmentSource);
   this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
   if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
   gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(this.program);this.uniforms={};
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
   const position=gl.getAttribLocation(this.program,"position");gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
   // Deterministic local noise replaces the upstream third-party binary texture.
   const bytes=new Uint8Array(32*32*32);let seed=74777;
   for(let i=0;i<bytes.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;bytes[i]=seed>>>24;}
   this.noiseTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,this.noiseTexture);
   gl.texImage3D(gl.TEXTURE_3D,0,gl.R8,32,32,32,0,gl.RED,gl.UNSIGNED_BYTE,bytes);
   for(const key of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,key,gl.REPEAT);
   gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   gl.uniform1i(this.location("uNoiseTexture"),0);this.resize();
 }
 location(name){if(!(name in this.uniforms))this.uniforms[name]=this.gl.getUniformLocation(this.program,name);return this.uniforms[name];}
 float(name,v){this.gl.uniform1f(this.location(name),v);}
 vec3(name,v){this.gl.uniform3fv(this.location(name),v);}
 resize(){const r=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,innerWidth<=800?1.25:1.5);
   this.canvas.width=Math.max(1,Math.round(r.width*dpr));this.canvas.height=Math.max(1,Math.round(r.height*dpr));this.gl.viewport(0,0,this.canvas.width,this.canvas.height);}
 zoom(delta){this.zoomLevel=Math.max(.72,Math.min(1.4,this.zoomLevel+delta*.2));}
 setWorld(spec,index){if(this.activeIndex===index&&this.spec?.visualMode===spec.visualMode)return;this.spec=spec;this.activeIndex=index;
   this.planet=new Planet3D.Planet(spec.name,2,0,.07,spec.land);this.planet.add_ring(spec.ringRadius,spec.ringWidth,spec.accent,.36);
   spec.moons.forEach(m=>{this.planet.add_moon(m.name,m.radius,m.orbit,m.speed,m.color).angle=m.angle;});
   this.canvas.dataset.world=String(index);this.canvas.dataset.effect=spec.visualMode;
 }
 render(seconds,moving=true){
   if(this.lost||!this.spec)return;
   if(moving&&!this.dragging){this.time+=seconds;this.planet.update(seconds);}
   const gl=this.gl,s=this.spec;gl.useProgram(this.program);
   gl.uniform2f(this.location("uResolution"),this.canvas.width,this.canvas.height);
   this.float("uTime",this.time);this.float("uRotationOffset",this.yaw);this.float("uTilt",this.tilt);this.float("uZoom",this.zoomLevel);
   this.float("uQuality",innerWidth<=800?1:2);this.vec3("uPlanetPosition",[0,0,0]);this.float("uPlanetRadius",2);
   this.float("uNoiseStrength",s.stress>.8?.19:.17);this.float("uTerrainScale",.72+(s.seed%2)*.12);
   this.float("uEruption",s.eruption);this.float("uStorm",s.storm);this.float("uCloudsDensity",Math.max(currentClouds(this.activeIndex),s.storm*.85));this.float("uCloudsScale",1);this.float("uCloudsSpeed",1.4);
   this.vec3("uAtmosphereColor",s.accent);this.float("uAtmosphereDensity",.30);this.float("uSunIntensity",3-s.storm*1.65);this.float("uAmbientLight",.055+s.storm*.025);
   this.vec3("uWaterDeep",s.ocean.map(v=>v*.2));this.vec3("uWaterSurface",s.ocean.map(v=>v*.6));this.vec3("uTreeColor",s.land.map(v=>v*.35));
   this.vec3("uRockColor",s.land.map(v=>v*.65));this.vec3("uAccent",s.accent);this.float("uStress",s.stress);this.float("uSeed",s.seed);
   this.float("uRingRadius",s.ringRadius*2);this.float("uRingWidth",s.ringWidth*2*(1-s.eruption*.75));
   this.planet.moons.forEach((m,i)=>{const p=m.position(),a=.35+this.tilt*.3;const pos=[p[0]*2,p[2]*Math.sin(a)*2,p[2]*Math.cos(a)*2];
     this.vec3("uMoonPositions["+i+"]",pos);this.float("uMoonRadii["+i+"]",m.radius*2);this.vec3("uMoonColors["+i+"]",m.color);});
   gl.drawArrays(gl.TRIANGLES,0,3);
 }
}
function currentClouds(i){return [ .32,.08,.28,.65,.25,.12,.26 ][i];}
global.RealtimePlanetView=RealtimePlanetView;
})(window);
