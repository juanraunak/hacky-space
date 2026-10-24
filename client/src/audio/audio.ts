// Everything synthesised with WebAudio: no files, no licences.
// A drone, an engine hum whose pitch follows your clock rate, a rumble near
// wells, beacon pings, the star's pulse (a thud that quickens), a swell for
// the supernova. Starts on the first user gesture.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
let rumble: { gain: GainNode; filter: BiquadFilterNode } | null = null;
let muted = (() => { try { return localStorage.getItem('hackyspace.muted') === '1'; } catch { return false; } })();

function noiseBuffer(c: AudioContext) {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  return b;
}

function start() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.6;
  master.connect(ctx.destination);

  // Drone: two detuned low saws through a slow lowpass.
  const dg = ctx.createGain(); dg.gain.value = 0.05;
  const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 220;
  for (const f of [55, 55.4, 82.4]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(df); o.start();
  }
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
  const lg = ctx.createGain(); lg.gain.value = 90; lfo.connect(lg); lg.connect(df.frequency); lfo.start();
  df.connect(dg); dg.connect(master);

  // Engine hum.
  const eg = ctx.createGain(); eg.gain.value = 0;
  const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 600;
  const eo = ctx.createOscillator(); eo.type = 'sawtooth'; eo.frequency.value = 70;
  const eo2 = ctx.createOscillator(); eo2.type = 'square'; eo2.frequency.value = 35;
  eo.connect(ef); eo2.connect(ef); ef.connect(eg); eg.connect(master); eo.start(); eo2.start();
  engine = { osc: eo, osc2: eo2, gain: eg, filter: ef };

  // Rumble near wells: brown noise through a lowpass.
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.loop = true;
  const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 120;
  const rg = ctx.createGain(); rg.gain.value = 0;
  src.connect(rf); rf.connect(rg); rg.connect(master); src.start();
  rumble = { gain: rg, filter: rf };
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, start, { passive: true });
}

function tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}

export const audio = {
  isMuted: () => muted,
  toggleMute() {
    muted = !muted;
    try { localStorage.setItem('hackyspace.muted', muted ? '1' : '0'); } catch { /* fine */ }
    start();
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.6, ctx.currentTime, 0.05);
    return muted;
  },
  /** Called every frame. rate = own clock rate; thrust 0..2; well 0..1. */
  update(rate: number, thrust: number, well: number) {
    if (!ctx || !engine || !rumble) return;
    const t = ctx.currentTime;
    const pitch = 0.45 + 0.55 * rate; // a slower clock sounds lower
    engine.osc.frequency.setTargetAtTime(70 * pitch * (1 + thrust * 0.3), t, 0.1);
    engine.osc2.frequency.setTargetAtTime(35 * pitch, t, 0.1);
    engine.filter.frequency.setTargetAtTime(300 + thrust * 700 * pitch, t, 0.1);
    engine.gain.gain.setTargetAtTime(0.03 + thrust * 0.05, t, 0.15);
    rumble.gain.gain.setTargetAtTime(well * 0.5, t, 0.3);
    rumble.filter.frequency.setTargetAtTime(60 + well * 140, t, 0.3);
  },
  ping() { tone(1320, 0.35, 0.05, 'sine', 1300); },
  blip(f = 520) { tone(f, 0.12, 0.08, 'triangle'); },
  hit() { tone(140, 0.4, 0.25, 'sawtooth', 50); },
  thud(strength = 0.5) { tone(48, 0.9, 0.2 + strength * 0.35, 'sine', 30); },
  whoosh() { tone(200, 1.0, 0.15, 'sawtooth', 1600); },
  swell() {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    for (const f of [41, 55, 82, 110, 165]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 3); g.gain.exponentialRampToValueAtTime(0.0001, t + 9);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 9.5);
    }
  },
};
