// On your feet inside the ship, before you fly. Plain singletons stepped once
// a frame from stepGame, like the rest of play/: no React.
//
//   1. You walk around a small bridge (WASD / left thumb, mouse / right thumb).
//   2. Newton and Einstein argue at the glass, in typed bubbles, once someone
//      walks up (or 20 s in). Local to each screen.
//   3. Then any client fires the 'collapse' room event (insert-once). Every
//      screen plays the collapse from that row's server time: the star dies,
//      Newton is pulled out, black, and Einstein says the one line.
//   4. You sit in the pilot seat (E / tap) and fly from just past the glass.
//
// While on foot my ship row carries my feet with status 'home'; other screens
// draw me as a kid in my colour (render/craft.tsx).

import * as THREE from 'three';
import { net, type Run } from '../net';
import { consumeLook, input, isTouch } from '../input/input';
import { pad, pollGamepad } from '../input/pad';
import { game, ship } from './game';
import { v } from '../universe/bodies';
import { audio } from '../audio/audio';

// --- the place ---------------------------------------------------------------

/** The bridge's floor centre in the world (ahead of where ships spawn). */
export const OPEN = { x: 55, y: 8, z: 230 };
/** The star, out of the glass, relative to OPEN: it rests in the dip of the sheet. */
export const STAR = { x: 0, y: -6, z: -70 };
/** The rubber sheet of space floats this far below the floor, centred under the star. */
export const SHEET_Y = -2;
/** Where the black hole sits once formed: at the throat of the funnel. */
export const HOLE = { x: 0, y: -15.5, z: -70 };
export const HOLE_RS = 5;

/** Room in bridge coordinates: x right, z back, glass at z = -4. */
export const ROOM = { x0: -4, x1: 4, z0: -4, z1: 4.2, h: 3.1 };
export const PILOT = { x: -0.9, z: -2.0 };
export const COPILOT = { x: 0.9, z: -2.0 };
export const EYE = 1.5;
const BODY_R = 0.3;

const BOXES: [number, number, number, number][] = [
  [PILOT.x - 0.3, PILOT.x + 0.3, -3.0, -2.5], // the small pedestal consoles before the seats
  [COPILOT.x - 0.3, COPILOT.x + 0.3, -3.0, -2.5],
  [3.25, 4, 0.6, 3.0], // bench, right wall
  [-4, -3.45, 0.9, 2.9], // lockers, left wall
];
const SEATS = [PILOT, COPILOT];

// --- the NPCs' bodies, written by render/Opening each frame -------------------

export interface NpcDrive {
  x: number; y: number; z: number; // bridge coordinates (feet)
  yaw: number; // facing: 0 = +z, atan2(dx, dz)
  rx: number; rz: number; sx: number; sy: number; sz: number;
  moving: number; // 0..1, drives the walk cycle
  stride: number; // distance walked
  armL: [number, number]; armR: [number, number]; // shoulder: raise (negative = forward/up), out
  talk: number; // 0..1 gesture while speaking
  flail: number;
  shake: number; // head shake 0..1
  seated: number;
  look: THREE.Vector3 | null; // scene-space point the head turns to
  visible: boolean;
}

export function newDrive(x: number, z: number, yaw: number): NpcDrive {
  return {
    x, y: 0, z, yaw, rx: 0, rz: 0, sx: 1, sy: 1, sz: 1, moving: 0, stride: 0,
    armL: [0, 0.06], armR: [0, 0.06], talk: 0, flail: 0, shake: 0, seated: 0, look: null, visible: true,
  };
}

export const npcs = {
  newton: newDrive(2.4, -1.8, Math.PI),
  einstein: newDrive(-2.9, -3.3, Math.PI),
};

// --- the script ---------------------------------------------------------------

export type Who = 'newton' | 'einstein';
interface Line { who: Who; text: string }

export const SCRIPT: Line[] = [
  { who: 'newton', text: 'What are you doing, Albert? Gravity is a pull!' },
  { who: 'einstein', text: 'No rope, Isaac. Look — space itself bends.' },
  { who: 'newton', text: 'Nonsense! Time is the same everywhere.' },
  { who: 'einstein', text: 'Not near something that heavy.' },
];

const TYPE_S = 0.034;
const pauseAfter = (ch: string) => (ch === '.' || ch === '!' || ch === '?' || ch === '…' ? 0.3 : ch === ',' || ch === '—' ? 0.14 : 0);

/** Seconds from the start of a line to each character landing. */
function charTimes(text: string): number[] {
  const out: number[] = [];
  let t = 0;
  for (const ch of Array.from(text)) { t += TYPE_S; out.push(t); t += pauseAfter(ch); }
  return out;
}
const typed = (text: string, times: number[], s: number) => {
  let n = 0;
  while (n < times.length && times[n] <= s) n++;
  return n;
};

const LINE_TIMES = SCRIPT.map(l => charTimes(l.text));
/** When each line starts, in conversation seconds. */
export const BEAT: number[] = [];
{
  let t = 0;
  SCRIPT.forEach((l, i) => { BEAT.push(t); t += LINE_TIMES[i][LINE_TIMES[i].length - 1] + 1.5 + l.text.length * 0.02; });
  BEAT.push(t);
}
export const TALK_END = BEAT[SCRIPT.length];

// --- the collapse, in seconds after the event's server time ------------------

export const COL = {
  starOut: 2.5, // the star starts to fall in
  hole: 3.5, // the hole forms
  pull: 6.5, // Newton starts to slide
  glass: 7.3, // the glass gives way
  gone: 10.0, // Newton is gone
  black: 10.8, // fade to black ...
  blackFull: 11.6,
  blackEnd: 13.4, // ... and back
  lit: 14.6,
  line: 15.0, // "We have to find Newton."
  sit: 23.5, // Einstein takes the co-pilot seat
};

interface Utter { who: Who; at: number; text: string; hold: number }
const COLLAPSE_LINES: Utter[] = [
  { who: 'newton', at: 0.8, text: 'Albert… the star!', hold: 3.2 },
  { who: 'einstein', at: 7.5, text: 'Isaac!', hold: 2.6 },
  { who: 'einstein', at: COL.line, text: 'We have to find Newton.', hold: 7.5 },
];
const COLLAPSE_TIMES = COLLAPSE_LINES.map(u => charTimes(u.text));

// --- state ----------------------------------------------------------------------

export const foot = {
  mode: '' as '' | 'foot' | 'fly',
  runKey: '',
  x: 0, z: 3.2, yaw: 0, pitch: -0.04,
  vx: 0, vz: 0, phase: 0, bob: 0,
  talkAt: 0, // performance.now() when the argument began here, 0 before
  tau: -1, // conversation seconds, -1 before
  collapseAt: 0, // server ms of the collapse event, 0 before
  c: -1, // seconds since the collapse, -1 before
  bend: 0, // the lattice bending more while Einstein explains, 0..1
  nearSeat: false,
  sitAt: 0,
  sitFrom: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
  launchAt: 0,
  lastFire: 0,
  sounds: new Set<string>(),
};

export const onFoot = () => foot.mode === 'foot';
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Is this run the full one, with the opening on the ship? */
function shipRun(run: Run): boolean {
  const evs = net.events();
  if (evs.some(e => e.name === 'intro')) return true;
  if (evs.some(e => e.name.startsWith('level:'))) return false;
  return net.now() - run.introAt < 20000;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

function begin(run: Run) {
  foot.runKey = `${run.seed}:${run.introAt}`;
  foot.mode = shipRun(run) ? 'foot' : 'fly';
  const h = hash(net.identity() || 'me');
  foot.x = ((h % 5) - 2) * 0.85; foot.z = 2.5 + ((h >>> 4) % 3) * 0.25;
  foot.yaw = 0; foot.pitch = -0.04; foot.vx = foot.vz = 0;
  foot.talkAt = 0; foot.tau = -1; foot.collapseAt = 0; foot.c = -1; foot.bend = 0;
  foot.nearSeat = false; foot.sitAt = 0; foot.launchAt = 0; foot.lastFire = 0;
  foot.sounds.clear();
  Object.assign(npcs.newton, newDrive(2.4, -1.8, Math.PI));
  Object.assign(npcs.einstein, newDrive(-2.9, -3.3, Math.PI));
  if (foot.mode === 'foot') { ship.status = 'home'; ship.field = null; }
}

function once(key: string, f: () => void) { if (!foot.sounds.has(key)) { foot.sounds.add(key); f(); } }

/**
 * One frame on foot. Returns true while I am on foot (flight is skipped).
 * Called from stepGame before anything flies.
 */
let padA = false;

export function stepOnFoot(rawDt: number, run: Run, skipped: boolean): boolean {
  pollGamepad();
  if (foot.runKey !== `${run.seed}:${run.introAt}`) begin(run);
  input.onFoot = foot.mode === 'foot';
  if (foot.mode !== 'foot') return false;
  const dt = Math.min(rawDt, 0.05);
  const now = performance.now();

  // the shared clock: the collapse row's server time
  const ev = net.events().find(e => e.name === 'collapse');
  foot.collapseAt = ev ? ev.firedAt : 0;
  foot.c = ev ? (net.now() - ev.firedAt) / 1000 : -1;
  foot.tau = foot.talkAt ? (now - foot.talkAt) / 1000 : -1;
  if (foot.tau >= BEAT[1]) foot.bend = Math.min(1, foot.bend + dt / 2.5);
  if (foot.c >= 0) foot.bend = 1;

  if (skipped && !foot.launchAt) { launch(); return false; }

  // the argument starts when someone walks up, or on its own after a while
  if (!foot.talkAt && foot.c < 0) {
    const mid = { x: (npcs.newton.x + npcs.einstein.x) / 2, z: (npcs.newton.z + npcs.einstein.z) / 2 };
    const near = (x: number, z: number) =>
      Math.hypot(x - mid.x, z - mid.z) < 4 || Math.hypot(x - npcs.newton.x, z - npcs.newton.z) < 3.2 || Math.hypot(x - npcs.einstein.x, z - npcs.einstein.z) < 3.2;
    let go = near(foot.x, foot.z) || net.now() - run.introAt > 20000;
    for (const s of net.ships()) {
      if (go) break;
      if (s.identity === net.identity() || s.status !== 'home') continue;
      go = near(s.x - OPEN.x, s.z - OPEN.z);
    }
    if (go) { foot.talkAt = now; foot.tau = 0; }
  }

  // then the star goes. Insert-once on the server; keep asking until it lands.
  if (!ev) {
    const due = (foot.tau >= TALK_END + 1.0) || net.now() - run.introAt > 60000;
    if (due && now - foot.lastFire > 2500) { foot.lastFire = now; net.fireEvent('collapse'); }
  }
  collapseSounds();

  const frozen = foot.c >= COL.black && foot.c < COL.lit;
  if (foot.sitAt) {
    if ((now - foot.sitAt) / 1000 >= SIT_S + DIP_S) { launch(); return false; }
  } else {
    if (pad.a && !padA) input.usePressed = true; // gamepad cross = E
    padA = pad.a;
    look(frozen, dt);
    walk(dt, frozen);
    foot.nearSeat = foot.c >= COL.lit && Math.hypot(foot.x - PILOT.x, foot.z - PILOT.z) < 1.5;
    const use = input.usePressed;
    input.usePressed = false;
    input.seatPrompt = foot.nearSeat;
    if (foot.nearSeat && use) sit();
  }

  // my row: my feet, status 'home'
  ship.status = 'home';
  ship.pos = v(OPEN.x + foot.x, OPEN.y, OPEN.z + foot.z);
  ship.q.setFromAxisAngle(AY, foot.yaw);
  ship.vel = v(foot.vx, 0, foot.vz);
  ship.u = v(); ship.speed = 0; ship.thrusting = false; ship.boosting = false;
  return true;
}

const AY = new THREE.Vector3(0, 1, 0);

function look(frozen: boolean, dt: number) {
  const l = consumeLook();
  if (frozen) return;
  const k = isTouch() ? 0.0055 : 0.0024;
  // mouse / drag in pixels, plus the right stick as a turn rate (up = look up)
  foot.yaw -= l.x * k + pad.rx * 2.6 * dt;
  foot.pitch = Math.max(-1.25, Math.min(1.25, foot.pitch - l.y * k + pad.ry * 1.9 * dt));
}

const WALK = 2.5, RUN = 4.0;
function walk(dt: number, frozen: boolean) {
  // keys / old touch stick, plus the left stick (up = forward, sideways = strafe)
  let wx = frozen ? 0 : input.walk.x + pad.lx, wy = frozen ? 0 : input.walk.y + pad.ly;
  const len = Math.hypot(wx, wy);
  if (len > 1) { wx /= len; wy /= len; }
  const speed = input.boost || pad.b ? RUN : WALK;
  const s = Math.sin(foot.yaw), c = Math.cos(foot.yaw);
  // forward (-sin, -cos), right (cos, -sin)
  const tx = (c * wx - s * wy) * speed, tz = (-s * wx - c * wy) * speed;
  const k = 1 - Math.exp(-dt * (len > 0.05 ? 9 : 12));
  foot.vx += (tx - foot.vx) * k;
  foot.vz += (tz - foot.vz) * k;
  foot.x += foot.vx * dt;
  foot.z += foot.vz * dt;
  collide();
  const sp = Math.hypot(foot.vx, foot.vz);
  foot.phase += sp * dt * 3.4;
  foot.bob += (Math.min(1, sp / WALK) - foot.bob) * (1 - Math.exp(-dt * 6));
}

function collide() {
  const r = BODY_R;
  for (let pass = 0; pass < 2; pass++) {
    for (const [x0, x1, z0, z1] of BOXES) {
      const cx = Math.max(x0, Math.min(x1, foot.x)), cz = Math.max(z0, Math.min(z1, foot.z));
      const dx = foot.x - cx, dz = foot.z - cz, d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-4) { foot.x = cx + (dx / d) * r; foot.z = cz + (dz / d) * r; }
        else foot.z = z1 + r; // inside: push out the back
      }
    }
    const circles = [...SEATS.map(p => ({ x: p.x, z: p.z, r: 0.42 }))];
    for (const n of [npcs.newton, npcs.einstein]) if (n.visible && n.seated < 0.5) circles.push({ x: n.x, z: n.z, r: 0.36 });
    for (const o of circles) {
      const dx = foot.x - o.x, dz = foot.z - o.z, d = Math.hypot(dx, dz), m = o.r + r;
      if (d < m && d > 1e-4) { foot.x = o.x + (dx / d) * m; foot.z = o.z + (dz / d) * m; }
    }
    foot.x = Math.max(ROOM.x0 + r, Math.min(ROOM.x1 - r, foot.x));
    foot.z = Math.max(ROOM.z0 + 0.2 + r, Math.min(ROOM.z1 - r, foot.z));
  }
}

// --- the seat and the launch ---------------------------------------------------

const SIT_S = 1.1, DIP_S = 0.3, FADE_IN_S = 0.8;
const SEAT_EYE = { x: PILOT.x, y: 1.2, z: PILOT.z - 0.05 };

function sit() {
  foot.sitAt = performance.now();
  foot.sitFrom = { x: foot.x, y: EYE, z: foot.z, yaw: foot.yaw, pitch: foot.pitch };
  foot.vx = foot.vz = 0;
  input.seatPrompt = false;
  audio.blip(440);
}

/** Off you go: the ship sits past the glass, nose to the stars, seen from behind. */
export function launch() {
  foot.mode = 'fly';
  foot.launchAt = performance.now();
  input.onFoot = false;
  input.seatPrompt = false;
  ship.q.identity();
  // far enough out that the chase camera (14 behind, 4 up) starts outside the glass
  ship.pos = v(OPEN.x, OPEN.y + 1.2, OPEN.z + ROOM.z0 - 19);
  ship.u = v(0, 0, -6); ship.vel = v(0, 0, -6);
  ship.ang.pitch = 0; ship.ang.yaw = 0;
  ship.status = 'flying';
  ship.field = null;
  game.wasTether = true;
  consumeLook();
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* fine */ }
}

// --- what the camera and the overlay read -------------------------------------

/** 0..1 black over the screen while on foot or just after launching. */
export function footBlackout(run: Run | undefined): number {
  const now = performance.now();
  if (foot.mode === 'fly') {
    if (!foot.launchAt) return 0;
    return Math.max(0, 1 - (now - foot.launchAt) / 1000 / FADE_IN_S);
  }
  let b = 0;
  if (run) b = Math.max(b, 1 - (net.now() - run.introAt) / 1000); // first second: fade in
  const c = foot.c;
  if (c >= COL.black && c < COL.lit) {
    b = Math.max(b, c < COL.blackFull ? (c - COL.black) / (COL.blackFull - COL.black) : c < COL.blackEnd ? 1 : 1 - (c - COL.blackEnd) / (COL.lit - COL.blackEnd));
  }
  if (foot.sitAt) {
    const s = (now - foot.sitAt) / 1000;
    if (s > SIT_S) b = Math.max(b, Math.min(1, (s - SIT_S) / DIP_S));
  }
  return Math.max(0, Math.min(1, b));
}

/** How hard the ship is shaking, 0..1. */
export function strain(): number {
  const c = foot.c;
  if (c < COL.starOut) return c >= 0 ? 0.15 * ease(c / COL.starOut) : 0;
  if (c < COL.black) return 0.15 + 0.85 * ease((c - COL.starOut) / 1.5) * (c > COL.gone ? 1 - ease((c - COL.gone) / 0.8) * 0.6 : 1);
  return 0;
}

export interface FootShot { pos: { x: number; y: number; z: number }; look: { x: number; y: number; z: number }; fov: number; cockpit: true }

/** The first-person camera (world coordinates). */
export function footShot(t: number): FootShot {
  let x = foot.x, y = EYE, z = foot.z, yaw = foot.yaw, pitch = foot.pitch;
  y += Math.sin(foot.phase * 2) * 0.03 * foot.bob;
  x += Math.cos(foot.phase) * 0.012 * foot.bob * Math.cos(yaw);
  if (foot.sitAt) {
    const k = ease((performance.now() - foot.sitAt) / 1000 / SIT_S);
    const f = foot.sitFrom;
    let dy = -f.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    x = f.x + (SEAT_EYE.x - f.x) * k; y = f.y + (SEAT_EYE.y - f.y) * k; z = f.z + (SEAT_EYE.z - f.z) * k;
    yaw = f.yaw + dy * k; pitch = f.pitch + (-0.05 - f.pitch) * k;
  }
  const sh = strain() * 0.05;
  x += Math.sin(t * 37) * sh; y += Math.sin(t * 41 + 1) * sh;
  pitch += Math.sin(t * 23 + 2) * sh * 0.4; yaw += Math.sin(t * 19) * sh * 0.3;
  const cp = Math.cos(pitch);
  const pos = { x: OPEN.x + x, y: OPEN.y + y, z: OPEN.z + z };
  return { pos, look: { x: pos.x - Math.sin(yaw) * cp * 10, y: pos.y + Math.sin(pitch) * 10, z: pos.z - Math.cos(yaw) * cp * 10 }, fov: 70, cockpit: true };
}

export interface Said { text: string; shown: number; alpha: number }

/** What an NPC is saying this frame: the full line and how much is typed. */
export function saying(who: Who): Said | null {
  if (foot.c >= 0) {
    for (let i = COLLAPSE_LINES.length - 1; i >= 0; i--) {
      const u = COLLAPSE_LINES[i];
      if (u.who !== who) continue;
      const s = foot.c - u.at;
      const times = COLLAPSE_TIMES[i];
      const end = times[times.length - 1] + u.hold;
      if (s >= 0 && s < end + 0.5) return { text: u.text, shown: typed(u.text, times, s), alpha: s > end ? 1 - (s - end) / 0.5 : 1 };
    }
    return null;
  }
  if (foot.tau < 0) return null;
  for (let i = SCRIPT.length - 1; i >= 0; i--) {
    if (foot.tau < BEAT[i]) continue;
    const l = SCRIPT[i];
    if (l.who !== who) return null; // the other one is talking: one bubble at a time
    const s = foot.tau - BEAT[i];
    const last = i === SCRIPT.length - 1;
    const end = BEAT[i + 1] - BEAT[i] + (last ? 0.6 : 0);
    if (s > end + 0.4) return null;
    return { text: l.text, shown: typed(l.text, LINE_TIMES[i], s), alpha: s > end ? 1 - (s - end) / 0.4 : 1 };
  }
  return null;
}

/** Which line is being spoken right now (index into SCRIPT), or -1. */
export function beatNow(): number {
  if (foot.tau < 0) return -1;
  for (let i = SCRIPT.length - 1; i >= 0; i--) if (foot.tau >= BEAT[i]) return foot.tau < BEAT[i + 1] ? i : SCRIPT.length;
  return -1;
}

function collapseSounds() {
  const c = foot.c;
  if (c < 0) return;
  if (c > 0.6) once('c0', () => audio.thud(0.5));
  if (c > COL.starOut) once('c1', () => audio.thud(1));
  if (c > COL.hole) once('c2', () => audio.whoosh());
  if (c > COL.glass) once('c3', () => { audio.hit(); audio.whoosh(); });
  if (c > COL.gone - 0.4) once('c4', () => audio.thud(0.8));
}

/**
 * Pods waiting in the open keep their air until everyone has left the ship:
 * on a ship run the air clock starts when the screen comes back from black
 * after the collapse (the same server time on every screen), never before.
 */
export function airFloorMs(): number {
  if (!net.events().some(e => e.name === 'intro')) return 0;
  const ev = net.events().find(e => e.name === 'collapse');
  return ev ? ev.firedAt + COL.lit * 1000 : net.now();
}
