// Market soundscape, generated entirely with the Web Audio API (no audio files).
// Muted by default; the AudioContext is created only after a user click (autoplay rules).
// One master gain; every parameter change uses setTargetAtTime so nothing clicks or pops.
//
//   Ambient drone : 2 detuned low oscillators → low-pass   · lower and darker as VIX rises
//   Wind          : looping noise → band-pass, random sweep · louder/faster with storm (VIX)
//   Waves         : noise → low-pass with a slow swell      · quieter as the sea goes out (correlation)
//   Earthquake    : low noise burst + ~40 Hz sine           · crash weeks, scaled by the fall
//   Thunder       : noise → low-pass, long decay            · 0.3–1.5 s after each lightning flash
//   Meteor        : falling whoosh + impact thud            · each meteor (Feature 3)

const MASTER = 0.55;              // overall level: gentle
const QUAKE_GAP = 0.5, THUNDER_GAP = 0.3, MAX_METEOR_SOUNDS = 3;

export function createAudio() {
  let ac = null, master, noise;
  let droneA, droneB, droneFilter, windFilter, windGain, waveGain;
  let enabled = false, lastUpdate = 0, nextSweep = 0;
  let lastQuake = -1, lastThunder = -1, meteorSounds = 0;
  const params = { storm: 0, seaFall: 0 };

  function init() {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);

    // 2 s of white noise, shared by every noise layer
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;

    // Ambient drone
    droneFilter = ac.createBiquadFilter();
    droneFilter.type = 'lowpass'; droneFilter.frequency.value = 700; droneFilter.Q.value = 0.7;
    const droneGain = ac.createGain(); droneGain.gain.value = 0.1;
    droneA = ac.createOscillator(); droneA.type = 'sawtooth'; droneA.frequency.value = 55;
    droneB = ac.createOscillator(); droneB.type = 'triangle'; droneB.frequency.value = 55; droneB.detune.value = 7;
    droneA.connect(droneFilter); droneB.connect(droneFilter);
    droneFilter.connect(droneGain).connect(master);
    droneA.start(); droneB.start();

    // Wind
    const windSrc = loop();
    windFilter = ac.createBiquadFilter();
    windFilter.type = 'bandpass'; windFilter.frequency.value = 500; windFilter.Q.value = 1.4;
    windGain = ac.createGain(); windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(master);

    // Waves: low-passed noise with a slow swell (LFO on a gain)
    const waveSrc = loop();
    const waveFilter = ac.createBiquadFilter();
    waveFilter.type = 'lowpass'; waveFilter.frequency.value = 420;
    const swell = ac.createGain(); swell.gain.value = 0.5;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.11;
    const lfoDepth = ac.createGain(); lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth).connect(swell.gain); lfo.start();
    waveGain = ac.createGain(); waveGain.gain.value = 0;
    waveSrc.connect(waveFilter).connect(swell).connect(waveGain).connect(master);
  }

  function loop() {
    const src = ac.createBufferSource();
    src.buffer = noise; src.loop = true;
    src.loopStart = Math.random(); src.start(0, Math.random() * 2);
    return src;
  }
  const set = (param, value, tau = 0.4) => param.setTargetAtTime(value, ac.currentTime, tau);

  // One-shot noise burst through a filter, with an attack/decay envelope
  function burst({ type = 'lowpass', freq = 200, freqEnd = null, q = 0.8, level, attack = 0.02, decay = 1, delay = 0 }) {
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource(); src.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random()); src.stop(t + attack + decay + 0.1);
  }
  function tone({ freq, freqEnd, level, attack = 0.01, decay = 0.6, delay = 0 }) {
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + attack + decay + 0.1);
  }

  // ── public API
  function setEnabled(on) {
    if (on && !ac) init();
    enabled = on;
    if (!ac) return;
    if (on && ac.state === 'suspended') ac.resume();
    set(master.gain, on ? MASTER : 0, 0.3);
  }

  // Continuous layers follow the data; called every frame, applied ~10× a second
  function update(storm, seaFall) {
    params.storm = storm; params.seaFall = seaFall;
    if (!enabled || !ac) return;
    const now = ac.currentTime;
    if (now - lastUpdate < 0.1) return;
    lastUpdate = now;
    set(droneA.frequency, 55 - 14 * storm, 1.5);           // lower pitch with fear
    set(droneB.frequency, 55 - 14 * storm, 1.5);
    set(droneFilter.frequency, 700 - 470 * storm, 1.5);     // darker
    set(windGain.gain, 0.015 + 0.3 * storm ** 1.5, 0.8);
    if (now > nextSweep) {                                  // slow random sweep, faster in storms
      set(windFilter.frequency, 250 + Math.random() * (500 + 900 * storm), 0.8 - 0.5 * storm);
      nextSweep = now + 2.5 - 1.8 * storm + Math.random();
    }
    set(waveGain.gain, 0.16 * (1 - 0.85 * seaFall), 1.2);  // tide goes out → quieter waves
  }

  function quake(size) {
    if (!enabled || !ac || ac.currentTime - lastQuake < QUAKE_GAP) return;
    lastQuake = ac.currentTime;
    const s = 0.35 + 0.65 * Math.min(1, size);
    burst({ freq: 140, level: 0.5 * s, attack: 0.03, decay: 1.4 });
    tone({ freq: 42, freqEnd: 30, level: 0.45 * s, attack: 0.02, decay: 1.1 });
  }

  function thunder() {
    if (!enabled || !ac || ac.currentTime - lastThunder < THUNDER_GAP) return;
    lastThunder = ac.currentTime;
    burst({ freq: 900, freqEnd: 120, level: 0.22 + Math.random() * 0.12, attack: 0.04,
      decay: 2.2 + Math.random(), delay: 0.3 + Math.random() * 1.2 });
  }

  function meteor(size) {
    if (!enabled || !ac || meteorSounds >= MAX_METEOR_SOUNDS) return;
    meteorSounds++;
    setTimeout(() => { meteorSounds--; }, 1600);
    const s = 0.4 + 0.6 * Math.min(1, size);
    burst({ type: 'bandpass', freq: 2400, freqEnd: 220, q: 3, level: 0.12 * s, attack: 0.25, decay: 0.55 });
  }
  function impact(size) {
    if (!enabled || !ac) return;
    const s = 0.4 + 0.6 * Math.min(1, size);
    tone({ freq: 75, freqEnd: 32, level: 0.35 * s, attack: 0.005, decay: 0.7 });
    burst({ freq: 400, freqEnd: 90, level: 0.2 * s, attack: 0.005, decay: 0.6 });
  }

  return { setEnabled, isEnabled: () => enabled, update, quake, thunder, meteor, impact };
}
