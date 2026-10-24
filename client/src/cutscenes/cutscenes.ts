// Three hand-made cutscenes as code. Each is evaluated from
// t = serverNow - startAt, so every client plays it frame-aligned, and a late
// joiner simply lands at the right moment. No general event system.

import * as THREE from 'three';
import { net } from '../net';
import { game, ship, DOCK } from '../play/game';
import { sayExact, FINAL_LINE } from '../play/einstein';
import { mothershipFx } from '../render/craft';
import { MOTHERSHIP, INTRO_S } from '../game/constants';
import { bridgeLocal } from '../render/Bridge';
import { add, mul, norm, sub, v, type Vec } from '../universe/bodies';
import { audio } from '../audio/audio';
import { view } from '../play/view';
import { COCKPIT_EYE } from '../render/ship';

export interface Shot { pos: Vec; look: Vec; fov: number; cockpit?: boolean }

export const fx = {
  active: '' as '' | 'intro' | 'reunion' | 'ending',
  t: 0,
  anger: 0, // the dying star, 0..1
  shockwave: -1, // seconds since the opening shockwave, or -1
  supernova: -1, // seconds since the supernova, or -1
  whiteout: 0, // 0..1 full-screen white
  bigPortrait: false,
  skipped: false,
  // the bridge
  bridge: false,
  bridgeAll: false,
  einsteinOnBridge: false,
  einsteinTurn: 0,
  einsteinAt: { x: 0, z: -6.5 },
  einsteinLooks: false,
  crewFall: 0,
  alarm: 0,
  shake: 0,
  waveId: -1,
  forceCockpit: false,
};

function resetBridge() {
  fx.bridge = false; fx.bridgeAll = false; fx.einsteinOnBridge = false; fx.einsteinTurn = 0;
  fx.einsteinAt = { x: 0, z: -6.5 }; fx.einsteinLooks = false; fx.crewFall = 0; fx.alarm = 0; fx.shake = 0; fx.waveId = -1; fx.forceCockpit = false;
}
const B = (x: number, y: number, z: number): Vec => bridgeLocal(x, y, z);

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const MS = v(MOTHERSHIP.x, MOTHERSHIP.y, MOTHERSHIP.z);

// --- opening ----------------------------------------------------------------

const said = new Set<string>();
function once(key: string, f: () => void) { if (!said.has(key)) { said.add(key); f(); } }
export function resetCutscenes() { said.clear(); fx.skipped = false; }

/** Where pods are during the opening: flung out from the mothership. */
export function introPod(id: number, t: number): Vec | null {
  if (t < 0 || t > INTRO_S) return null;
  const p = game.pods.get(id);
  if (!p) return null;
  if (t < 10.5) return { x: MS.x + (id % 3 - 1) * 4, y: MS.y + 3, z: MS.z + 20 + (id % 4) * 3 };
  const k = 1 - Math.pow(1 - Math.min(1, (t - 10.5) / 9), 3);
  return lerp(add(MS, v(0, 3, 20)), p.poi.podStart, k);
}

function firstHole() {
  return game.pods.size ? [...game.pods.values()].find(p => p.poi.kind === 'black_hole' && !p.crew.isEinstein) : undefined;
}

function introShot(t: number): Shot {
  resetBridge();
  fx.anger = t < 8 ? 0.35 + t * 0.05 : t < 11 ? 1 : 0.6;
  fx.shockwave = t >= 10.6 ? t - 10.6 : -1;
  fx.whiteout = t > 9.7 && t < 11.2 ? 1 - Math.abs(t - 10.4) / 0.8 : 0;
  mothershipFx.damaged = t > 10.5;
  once('i1', () => sayExact("Beautiful, isn't she? A little restless today."));
  if (t > 5.6) once('i2', () => sayExact('Hm. That flare is... larger than I expected.'));
  if (t > 8.6) once('i3', () => { sayExact('Hold on to something!'); audio.thud(1); });
  if (t > 10.4) once('i4', () => { audio.thud(1); audio.whoosh(); });
  if (t > 13) once('i5', () => sayExact('Everyone, report! ...Anyone?'));
  if (t > 24) once('i6', () => sayExact('I can see your beacons. Every one of you. Hold on, I am coming through on your screen.'));

  if (t < 10.5) {
    // On the bridge: Einstein at the window, the swollen red star outside.
    fx.bridge = true; fx.bridgeAll = true; fx.einsteinOnBridge = true;
    mothershipFx.visible = false;
    // He faces you first; as the flare builds he turns back to the glass.
    fx.einsteinTurn = 1 - ease((t - 7) / 1.2) * 0.75;
    fx.einsteinLooks = t < 7.2;
    fx.alarm = t > 8.6 ? 1 : 0;
    fx.shake = t > 8.6 ? Math.min(1, (t - 8.6) / 1.2) : 0;
    fx.crewFall = ease((t - 9.2) / 0.9);
    const shake = fx.shake * 0.12;
    const k = ease(t / 7);
    const pos = add(B(1.6 + k * 1.4, 0.15 + k * 0.4, -3.2 + k * 4.5), v(Math.sin(t * 40) * shake, Math.sin(t * 33) * shake, 0));
    return { pos, look: lerp(B(0, -0.1, -6.5), B(0, 0, -8.5), ease((t - 6.5) / 2)), fov: 42 + k * 10 };
  }
  mothershipFx.visible = true;
  if (t < 15) {
    // The shockwave, then the pods streak away.
    const k = ease((t - 10.5) / 4.5);
    return { pos: add(MS, v(-60 - k * 60, 25 + k * 30, 120 + k * 80)), look: add(MS, v(0, 0, 40 + k * 200)), fov: 60 };
  }
  const hole = firstHole();
  if (t < 23 && hole) {
    // Follow one pod past a black hole: the stars bend around it.
    const bh = hole.poi.bodies[0];
    const toPod = norm(sub(hole.poi.podStart, bh));
    const side = norm({ x: toPod.z, y: 0.4, z: -toPod.x });
    const k = ease((t - 15) / 8);
    const pos = add(bh, add(mul(toPod, bh.rs * (9 - k * 3)), mul(side, bh.rs * (5 - k * 2))));
    return { pos, look: lerp(introPod(hole.crew.id, t) ?? bh, bh, 0.5), fov: 55 };
  }
  // Your cockpit: his hologram flickers on.
  fx.forceCockpit = t < 28.5;
  return fx.forceCockpit ? cockpitShot() : chaseShot(1);
}

// --- ending -----------------------------------------------------------------

function endingShot(t: number): Shot {
  resetBridge();
  const einstein = net.crew().find(c => c.isEinstein);
  const home = einstein?.status === 'home';
  fx.bigPortrait = false;
  if (t < 8) {
    // The bridge: everyone who came home. Einstein walks in and tells you.
    fx.bridge = true;
    mothershipFx.visible = false;
    fx.einsteinOnBridge = home;
    fx.einsteinTurn = 1;
    fx.einsteinLooks = true;
    fx.einsteinAt = { x: 0, z: 7 - ease(t / 2.2) * 6 };
    if (home && t > 2) once('e1', () => sayExact(FINAL_LINE));
    if (t < 2.2) return { pos: B(0, 1.2, -7.5), look: B(0, -0.5, 4), fov: 60 };
    const k = ease((t - 2.2) / 5);
    return { pos: B(0.6, 0.1, -2.5 + k * 1.2), look: B(0, -0.1 + 0.0, 1), fov: 46 - k * 6 };
  }
  // The mothership jumps: stretch and flash. Then the star goes.
  mothershipFx.visible = t < 10.5;
  mothershipFx.stretch = t < 8.5 ? 1 : t < 10.5 ? 1 + Math.pow((t - 8.5) / 2, 3) * 40 : 1;
  if (t > 10.4) once('e2', () => audio.whoosh());
  fx.whiteout = Math.max(t > 10.3 && t < 11.3 ? 1 - Math.abs(t - 10.6) / 0.7 : 0, t > 19.5 ? Math.min(1, (t - 19.5) / 2) : 0);
  fx.supernova = t > 11 ? t - 11 : -1;
  fx.anger = t < 11 ? 1 : 0;
  if (t > 11) once('e3', () => audio.swell());
  if (t < 11) return { pos: add(MS, v(70, 20, 140)), look: MS, fov: 55 };
  const k = ease((t - 11) / 8);
  return { pos: v(0, 400 + k * 600, 2600 + k * 1800), look: v(0, 0, 0), fov: 55 };
}

// --- chase ------------------------------------------------------------------

const tq = new THREE.Vector3();
const pull = { x: 0, y: 0, z: 0 };
export function chaseShot(boostFov: number): Shot {
  const f = tq.set(0, 0, -1).applyQuaternion(ship.q).clone();
  const u = tq.set(0, 1, 0).applyQuaternion(ship.q).clone();
  if (view.mode === 'cockpit') {
    const e = COCKPIT_EYE.clone().applyQuaternion(ship.q);
    const pos = v(ship.pos.x + e.x, ship.pos.y + e.y, ship.pos.z + e.z);
    return { pos, look: v(pos.x + f.x * 50, pos.y + f.y * 50, pos.z + f.z * 50), fov: 72 + (ship.boosting ? 6 * boostFov : 0), cockpit: true };
  }
  // The pull drags the camera toward the well, so you feel which way it is.
  const fl = ship.field;
  const a = fl ? Math.hypot(fl.ax, fl.ay, fl.az) : 0;
  const k = a > 0.01 ? Math.min(4, (a / 20) * 4) / a : 0;
  pull.x += ((fl?.ax ?? 0) * k - pull.x) * 0.05; pull.y += ((fl?.ay ?? 0) * k - pull.y) * 0.05; pull.z += ((fl?.az ?? 0) * k - pull.z) * 0.05;
  const pos = v(ship.pos.x - f.x * 14 + u.x * 4 - pull.x, ship.pos.y - f.y * 14 + u.y * 4 - pull.y, ship.pos.z - f.z * 14 + u.z * 4 - pull.z);
  const look = v(ship.pos.x + f.x * 20 + u.x * 1.5, ship.pos.y + f.y * 20 + u.y * 1.5, ship.pos.z + f.z * 20 + u.z * 1.5);
  return { pos, look, fov: 60 + (ship.boosting ? 8 * boostFov : 0) };
}

function arrivalShot(t: number): Shot {
  resetBridge();
  const b = game.arrival!.body;
  const R = b.kind === 'black_hole' ? b.rs * 15 : b.kind === 'dark_matter' ? b.radius * 1.1 : b.kind === 'pulsar' ? 170 : b.kind === 'wormhole' ? b.radius * 5 : b.radius * 4;
  const from = norm(sub(game.arrival!.from, b));
  const a0 = Math.atan2(from.z, from.x);
  const a = a0 + 0.25 + ease(t / 5.5) * 1.3;
  const orbit = add(b, v(Math.cos(a) * R, R * 0.28, Math.sin(a) * R));
  // ease in from the chase camera and back out at the end
  const c = chaseShot(0);
  const k = ease(Math.min(t / 1.2, (5.5 - t) / 1.0));
  return { pos: lerp(c.pos, orbit, k), look: lerp(c.look, b, k), fov: 55 };
}

export function cockpitShot(): Shot {
  const f = tq.set(0, 0, -1).applyQuaternion(ship.q).clone();
  const e = COCKPIT_EYE.clone().applyQuaternion(ship.q);
  const pos = v(ship.pos.x + e.x, ship.pos.y + e.y, ship.pos.z + e.z);
  return { pos, look: v(pos.x + f.x * 50, pos.y + f.y * 50, pos.z + f.z * 50), fov: 72, cockpit: true };
}

// --- reunion (local only: the pilot who docked): on the bridge, they wave ----

function reunionShot(t: number, crewId: number): Shot {
  resetBridge();
  fx.bridge = true;
  fx.einsteinLooks = true;
  fx.waveId = crewId;
  mothershipFx.visible = false;
  const k = ease(t / 3.5);
  return { pos: B(0, 0.6 - k * 0.4, 8 - k * 3), look: B(0, -0.6, -1), fov: 55 };
}

/** The shot for this frame, or null for the normal chase camera. */
export function cutsceneShot(): Shot | null {
  const room = net.room();
  const run = net.run();
  if (!room || !run) { fx.active = ''; return null; }
  const now = net.now();
  if (room.phase === 'intro' || (room.phase === 'playing' && now - run.introAt < (INTRO_S + 0.5) * 1000)) {
    const t = (now - run.introAt) / 1000;
    if (t < INTRO_S && !fx.skipped) { fx.active = 'intro'; fx.t = t; return introShot(t); }
  }
  if (room.phase === 'won' || room.phase === 'lost') {
    const t = (now - run.endedAt) / 1000;
    fx.active = 'ending'; fx.t = t;
    return endingShot(t);
  }
  if (game.arrival) {
    const t = (performance.now() - game.arrival.at) / 1000;
    if (t < 5.5) { fx.active = 'reunion'; fx.t = t; return arrivalShot(t); }
    game.arrival = null;
  }
  if (game.reunion) {
    const t = (performance.now() - game.reunion.at) / 1000;
    if (t < 4) { fx.active = 'reunion'; fx.t = t; return reunionShot(t, game.reunion.crewId); }
    game.reunion = null;
  }
  fx.active = '';
  resetBridge();
  fx.whiteout = 0;
  fx.shockwave = -1;
  fx.supernova = -1;
  fx.bigPortrait = false;
  mothershipFx.stretch = 1;
  mothershipFx.visible = true;
  // the star grows angrier as the run goes on (look and sound only)
  const crew = net.crew();
  const settled = crew.filter(c => c.status === 'home' || c.status === 'lost').length;
  fx.anger = Math.min(1, 0.25 + (game.worldS / 900) * 0.5 + (settled / Math.max(1, crew.length)) * 0.4);
  return null;
}
