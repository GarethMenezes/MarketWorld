// Meteor strikes for shock days (world.json "shocks", built by build_world.py).
// During playback each shock in a new week launches a meteor onto its sector's continent:
// glowing streak (~0.8 s) → flash, expanding shockwave ring, debris → a crater that fades
// over the next CRATER_WEEKS weeks of the timeline (by weeks passed, not seconds).
// Scrubbing/jumping never animates meteors; it only shows the craters already there.
// Everything is pooled: no allocations per frame.
import * as THREE from 'three';

const CRATER_WEEKS = 12;
const MAX_CRATERS = 20;
const MAX_METEORS = 6;
const FLIGHT = 0.8, IMPACT = 1.1;          // seconds
const DEBRIS = 14;

function hash(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; }

export function createMeteors({ world, R, plateDirs, sectorNames, shocks, onLaunch, onImpact }) {
  // ── where each shock lands: a deterministic spot on its sector's continent
  const up = new THREE.Vector3(0, 1, 0), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
  const spots = shocks.map((sh) => {
    const k = Math.max(0, sectorNames.indexOf(sh.sector));
    const a = 0.08 + 0.22 * hash(sh.date + 'r'), t = hash(sh.date + 't') * Math.PI * 2;
    const local = new THREE.Vector3(Math.sin(a) * Math.cos(t), Math.sin(a) * Math.sin(t), Math.cos(a));
    return local.applyQuaternion(tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plateDirs[k])).normalize();
  });
  const byWeek = new Map();
  shocks.forEach((sh, i) => { if (!byWeek.has(sh.week)) byWeek.set(sh.week, []); byWeek.get(sh.week).push(i); });
  const sizeOf = (sh) => Math.min(1, Math.abs(sh.ret) / 0.1);   // −10% day → full size

  // ── craters: dark scorched disc with a faint glowing rim
  const craterGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  const craterMat = () => new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform float uStrength; varying vec2 vUv;
      void main(){ float r = length(vUv);
        float scorch = (1. - smoothstep(.15, .95, r)) * .85;
        float rim = exp(-pow((r - .78) / .09, 2.));
        vec3 col = vec3(.03, .02, .015) * scorch + vec3(2.6, .7, .12) * rim * .55;
        float a = max(scorch, rim * .8) * uStrength * (1. - smoothstep(.92, 1., r));
        gl_FragColor = vec4(col * uStrength, a); }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const craters = [];
  for (let i = 0; i < MAX_CRATERS; i++) {
    const m = new THREE.Mesh(craterGeo, craterMat());
    m.visible = false;
    m.userData = { crater: null };
    world.add(m);
    craters.push(m);
  }
  function placeCrater(m, idx, strength) {
    const sh = shocks[idx], d = spots[idx], s = 0.14 + 0.26 * sizeOf(sh);
    m.position.copy(d).multiplyScalar(R + 0.006);
    m.quaternion.setFromUnitVectors(up, d);
    m.scale.setScalar(s);
    m.material.uniforms.uStrength.value = strength;
    m.userData.crater = sh;
    m.userData.idx = idx;
    m.visible = true;
  }

  // ── meteor slots: head + tail + flash + shockwave ring + debris
  const headGeo = new THREE.SphereGeometry(1, 12, 8);
  const tailGeo = new THREE.CylinderGeometry(0.15, 1, 1, 8, 1, true).translate(0, -0.5, 0);
  const ringGeo = new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
  const slots = [];
  for (let i = 0; i < MAX_METEORS; i++) {
    const head = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.5, 1.5) }));
    const tail = new THREE.Mesh(tailGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3),
      transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    const flash = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 5, 2.5),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.4, 0.6),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const dPos = new Float32Array(DEBRIS * 3);
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
    const debris = new THREE.Points(dGeo, new THREE.PointsMaterial({ color: new THREE.Color(2.2, 1, 0.4), size: 0.05,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    debris.frustumCulled = false;
    for (const o of [head, tail, flash, ring, debris]) { o.visible = false; world.add(o); }
    slots.push({ active: false, t: 0, idx: -1, size: 0, from: new THREE.Vector3(), to: new THREE.Vector3(),
      vel: new Float32Array(DEBRIS * 3), dPos, head, tail, flash, ring, debris });
  }

  let week = -1;
  const inFlight = new Set();      // shock indices whose meteor has not landed yet (no crater yet)

  // Show craters for shocks in the previous CRATER_WEEKS weeks at their faded strength,
  // except those whose meteor is still on its way.
  function refresh(w) {
    week = w;
    let n = 0;
    for (let i = shocks.length - 1; i >= 0 && n < MAX_CRATERS; i--) {
      const age = w - shocks[i].week;
      if (age < 0 || age >= CRATER_WEEKS || inFlight.has(i)) continue;
      placeCrater(craters[n++], i, 1 - age / CRATER_WEEKS);
    }
    for (; n < MAX_CRATERS; n++) { craters[n].visible = false; craters[n].userData.crater = null; }
  }

  // Called by setWeek. animate=true only for single steps of playback.
  function onWeek(w, animate) {
    if (!animate) for (const s of slots) if (s.active) finish(s);   // jumps cancel meteors in flight
    if (animate) {                                                   // meteors keep flying across weeks
      let launched = 0;
      for (const idx of byWeek.get(w) || []) {
        const s = slots.find((x) => !x.active);
        if (!s) break;                                                // cap: no flood
        launch(s, idx, launched++ * 0.18);
      }
    }
    refresh(w);
  }

  function launch(s, idx, delay) {
    s.active = true; s.idx = idx; s.t = -delay; s.size = sizeOf(shocks[idx]); s.landed = false;
    inFlight.add(idx);
    s.to.copy(spots[idx]).multiplyScalar(R);
    // come in from space at an angle, offset along a tangent
    tmpV.set(hash(shocks[idx].date + 'x') - 0.5, hash(shocks[idx].date + 'y') - 0.5, hash(shocks[idx].date + 'z') - 0.5);
    s.from.copy(spots[idx]).multiplyScalar(R * 2.4).addScaledVector(tmpV.normalize(), R * 0.9);
    if (onLaunch) onLaunch(s.size);
  }

  function finish(s) {
    s.active = false;
    inFlight.delete(s.idx);
    for (const o of [s.head, s.tail, s.flash, s.ring, s.debris]) o.visible = false;
  }

  const dir = new THREE.Vector3(), pos = new THREE.Vector3();
  function update(dt) {
    for (const s of slots) {
      if (!s.active) continue;
      s.t += dt;
      if (s.t < 0) continue;
      if (s.t < FLIGHT) {                                   // streak in from space
        const e = s.t / FLIGHT, ease = e * e;
        pos.lerpVectors(s.from, s.to, ease);
        dir.subVectors(s.to, s.from).normalize();
        const r = 0.035 + 0.05 * s.size;
        s.head.visible = s.tail.visible = true;
        s.head.position.copy(pos); s.head.scale.setScalar(r);
        s.tail.position.copy(pos);
        s.tail.quaternion.setFromUnitVectors(up, dir.negate());
        s.tail.scale.set(r * 0.9, 0.6 + 1.6 * ease, r * 0.9);
        continue;
      }
      if (!s.landed) {                                      // impact
        s.landed = true;
        s.head.visible = s.tail.visible = false;
        s.flash.visible = s.ring.visible = s.debris.visible = true;
        s.flash.position.copy(s.to);
        s.ring.position.copy(s.to).multiplyScalar(1.002);
        s.ring.quaternion.setFromUnitVectors(up, dir.copy(s.to).normalize());
        const n = dir;                                      // surface normal
        for (let i = 0; i < DEBRIS; i++) {
          s.dPos[i * 3] = s.to.x; s.dPos[i * 3 + 1] = s.to.y; s.dPos[i * 3 + 2] = s.to.z;
          const sp = 0.6 + Math.random() * 0.9;
          s.vel[i * 3] = (n.x + (Math.random() - 0.5) * 1.6) * sp;
          s.vel[i * 3 + 1] = (n.y + (Math.random() - 0.5) * 1.6) * sp;
          s.vel[i * 3 + 2] = (n.z + (Math.random() - 0.5) * 1.6) * sp;
        }
        inFlight.delete(s.idx);
        refresh(week);                                      // the crater appears now
        if (onImpact) onImpact(s.size);
      }
      const e = (s.t - FLIGHT) / IMPACT;
      if (e >= 1) { finish(s); continue; }
      s.flash.scale.setScalar((0.08 + 0.22 * s.size) * (0.4 + 1.6 * Math.sqrt(e)));
      s.flash.material.opacity = (1 - e) ** 2;
      s.ring.scale.setScalar(0.05 + (0.35 + 0.5 * s.size) * e);
      s.ring.material.opacity = (1 - e) * 0.9;
      const g = 1.5 * dt;                                   // pull debris back towards the planet
      for (let i = 0; i < DEBRIS; i++) {
        const o = i * 3;
        s.dPos[o] += s.vel[o] * dt * 0.6; s.dPos[o + 1] += s.vel[o + 1] * dt * 0.6; s.dPos[o + 2] += s.vel[o + 2] * dt * 0.6;
        s.vel[o] -= s.to.x / R * g; s.vel[o + 1] -= s.to.y / R * g; s.vel[o + 2] -= s.to.z / R * g;
      }
      s.debris.geometry.attributes.position.needsUpdate = true;
      s.debris.material.opacity = 1 - e;
    }
  }

  return { onWeek, update, craters };
}
