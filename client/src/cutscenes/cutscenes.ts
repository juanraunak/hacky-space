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
import { OPEN } from '../render/Opening';
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
  mothershipFx.visible = false;
  fx.anger = 0; fx.shockwave = -1; fx.whiteout = 0;
  const A = (x: number, y: number, z: number) => v(OPEN.x + x, OPEN.y + y, OPEN.z + z);
  if (t > 3.5) once('o1', () => sayExact('Gravity is a pull, Albert. An invisible rope between all things.', 'NEWTON'));
  if (t > 8) once('o2', () => sayExact('No rope, Isaac. Space itself bends. Watch.'));
  if (t > 12.5) once('o3', () => sayExact('See? The marble is not pulled. It just follows the curve.'));
  if (t > 15.5) once('o4', () => sayExact('And down in the dip... time itself runs slower.'));
  if (t > 18.8) once('o5', () => { sayExact('Albert... it is getting heavier!', 'NEWTON'); audio.thud(0.7); });
  if (t > 20.8) once('o6', () => { sayExact('Isaac! Hold on!'); audio.whoosh(); });
  if (t > 24.3) once('o7', () => sayExact('It took him. Pilot, we are going after Isaac. I will ride with you.'));
  fx.forceCockpit = t >= 24 && t < 28.5;
  if (t < 4) { const k = ease(t / 4); return { pos: A(0, 7 - k * 4, 62 - k * 36), look: A(0, -3, -4), fov: 50 }; }
  if (t < 14.5) { const k = ease((t - 4) / 10.5); return { pos: A(2 - k * 4, 1.4, 15 - k * 2), look: A(0, -2.6 - k * 2, -1 - k * 6), fov: 46 }; }
  if (t < 19) return { pos: A(10, 5, 10), look: A(-3, -6, -8), fov: 52 };
  if (t < 24) { const k = ease((t - 19) / 5); return { pos: A(-4 + k * 4, 10 - k * 2, 28 - k * 4), look: A(0, -7, -11), fov: 52 }; }
  if (t < 28.5) return cockpitShot();
  return chaseShot(1);
}

// --- ending -----------------------------------------------------------------

function endingShot(t: number): Shot {
  resetBridge();
  mothershipFx.visible = false;
  fx.supernova = -1; fx.anger = 0; fx.shockwave = -1;
  if (t > 1) once('e1', () => sayExact(FINAL_LINE));
  fx.whiteout = t > 9 ? Math.min(1, (t - 9) / 1.5) : 0;
  // a slow pull-back from your ship into the stars
  const c = chaseShot(0);
  const k = ease(t / 10);
  return { pos: v(c.pos.x, c.pos.y + k * 30, c.pos.z + k * 60), look: ship.pos, fov: 55 };
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
