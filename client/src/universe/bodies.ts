// The seeded universe as plain data. Pure functions of (seed, crew rows):
// every client builds the same system in any order with no server help.
// Nothing here draws.

import { CHUNK, SUN, MOTHERSHIP, BH_POD_R, EINSTEIN_POD_R, HOVER_FRACTION, THRUST, BOOST, C } from '../game/constants';
import { hash3, rngFor, range, type Rand } from './hash';

export interface Vec { x: number; y: number; z: number }

export type BodyKind =
  | 'sun' | 'star' | 'planet' | 'black_hole' | 'dark_matter' | 'pulsar' | 'nebula'
  | 'wormhole' | 'exit_well' | 'asteroids';

export interface Body {
  id: string;
  kind: BodyKind;
  x: number; y: number; z: number;
  radius: number; // visual size (black hole: rs; clouds: cloud radius)
  gm: number; // pull strength
  rs: number; // horizon (black holes only). Pull is gm / (r - rs)^2
  core: number; // softening for extended masses (dark matter, nebula)
  clockRs: number; // clock rate here is sqrt(1 - clockRs / r)
  temp: number; // kelvin, for anything that glows
  seed: number;
  drag: number; // nebula drag per second
  // pulsar
  period: number; spinAxis: Vec; beamTilt: number;
  // wormhole: where it leads (the other mouth is its own body)
  exit?: Vec; mouth?: 'entry' | 'exit';
  // planet look
  rings: boolean; hue: number;
  // black hole disc normal
  normal: Vec;
  poi?: number; // crew id this body belongs to, if any
  pullFloor?: number; // black hole: least pull inside pullR (the story's boss zone)
  pullR?: number;
}

export const v = (x = 0, y = 0, z = 0): Vec => ({ x, y, z });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len = (a: Vec) => Math.hypot(a.x, a.y, a.z);
export const norm = (a: Vec): Vec => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec, b: Vec): Vec => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function randomUnit(r: Rand): Vec {
  const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
  return { x: s * Math.cos(a), y: z, z: s * Math.sin(a) };
}

function body(partial: Partial<Body> & Pick<Body, 'id' | 'kind' | 'x' | 'y' | 'z' | 'radius'>): Body {
  return {
    gm: 0, rs: 0, core: 0, clockRs: 0, temp: 5800, seed: 0, drag: 0,
    period: 2, spinAxis: v(0, 1, 0), beamTilt: 0.8, rings: false, hue: 0.1, normal: v(0, 1, 0),
    ...partial,
  };
}

/** Pull of a black hole so hovering at `depth` x rs takes HOVER_FRACTION of boost. */
export function holeGm(rs: number, depth: number): number {
  const gap = (depth - 1) * rs;
  return HOVER_FRACTION * THRUST * BOOST * gap * gap;
}

// --- crew rescue sites -----------------------------------------------------

export interface CrewSite {
  id: number;
  kind: string;
  isEinstein: boolean;
  twoShip: boolean;
  x: number; y: number; z: number; // site
  vx: number; vy: number; vz: number;
}

export interface Poi {
  crewId: number;
  kind: string;
  bodies: Body[];
  podStart: Vec; // where the pod waits until someone moves it
  podDepth: number; // r / rs for black-hole pods, else 0
}

/** The structures around one crewmate's site, and where their pod sits. */
export function poiFor(seed: number, c: CrewSite): Poi {
  const r = rngFor(seed + 900, c.id, 7, 3);
  const site = v(c.x, c.y, c.z);
  const home = norm(sub(v(MOTHERSHIP.x, MOTHERSHIP.y, MOTHERSHIP.z), site));
  const id = `poi${c.id}`;
  const bodies: Body[] = [];
  let podStart = site;
  let podDepth = 0;

  if (c.kind === 'black_hole') {
    const rs = c.isEinstein ? 36 : c.twoShip ? 26 : range(r, 18, 22);
    const depth = c.isEinstein ? EINSTEIN_POD_R : c.twoShip ? 1.08 : BH_POD_R;
    const n = norm(add(randomUnit(r), v(0, 2, 0)));
    bodies.push(body({
      id, kind: 'black_hole', ...site, radius: rs, rs, clockRs: rs, gm: holeGm(rs, depth),
      temp: c.isEinstein ? 9000 : 7000, seed: Math.floor(r() * 1e9), normal: n, poi: c.id,
    }));
    // The pod waits on the home-facing side, a little off the disc plane.
    const side = norm(add(home, mul(n, 0.35)));
    podStart = add(site, mul(side, rs * depth));
    podDepth = depth;
  } else if (c.kind === 'dark_matter') {
    bodies.push(body({ id, kind: 'dark_matter', ...site, radius: 240, gm: 22000, core: 60, seed: Math.floor(r() * 1e9), poi: c.id }));
    podStart = site;
  } else if (c.kind === 'slingshot') {
    // A big star between home and the pod: straight there is the long way.
    const star = add(site, mul(home, 420));
    bodies.push(body({ id, kind: 'star', ...star, radius: 95, gm: 240000, clockRs: 3, temp: range(r, 7000, 14000), seed: Math.floor(r() * 1e9), poi: c.id }));
    podStart = add(site, mul(home, -480));
  } else if (c.kind === 'pulsar') {
    const axis = norm(add(randomUnit(r), v(0, 1.5, 0)));
    bodies.push(body({
      id, kind: 'pulsar', ...site, radius: 5, gm: 5000, clockRs: 3, temp: 40000,
      period: range(r, 1.5, 3), spinAxis: axis, beamTilt: range(r, 0.55, 1.0), seed: Math.floor(r() * 1e9), poi: c.id,
    }));
    podStart = add(site, mul(home, 38));
  } else if (c.kind === 'wormhole') {
    // The far mouth sits beside a heavy dark mass where clocks run slow.
    const out = norm(add(mul(home, -1), mul(randomUnit(r), 0.6)));
    const exit = add(site, mul(out, 1400));
    bodies.push(body({ id, kind: 'wormhole', ...site, radius: 28, exit, mouth: 'entry', seed: Math.floor(r() * 1e9), poi: c.id }));
    bodies.push(body({ id: id + 'x', kind: 'wormhole', ...exit, radius: 28, exit: site, mouth: 'exit', seed: Math.floor(r() * 1e9), poi: c.id }));
    const well = add(exit, mul(out, 110));
    bodies.push(body({ id: id + 'w', kind: 'exit_well', ...well, radius: 18, gm: 2600, core: 20, clockRs: 82, temp: 3000, poi: c.id }));
    podStart = add(exit, mul(out, 55));
  } else if (c.kind === 'runaway') {
    podStart = site;
  }
  return { crewId: c.id, kind: c.kind, bodies, podStart, podDepth };
}

// --- the runaway pod: flung at 0.7 c, slowing as it goes --------------------

const RUN_T = 80; // seconds for its speed to fall by e
const runSpeed = (v0: number, t: number) => v0 * Math.exp(-t / RUN_T);

export function runawayPos(c: CrewSite, t: number): Vec {
  const v0 = Math.hypot(c.vx, c.vy, c.vz);
  if (v0 === 0) return v(c.x, c.y, c.z);
  const s = v0 * RUN_T * (1 - Math.exp(-Math.max(0, t) / RUN_T));
  return add(v(c.x, c.y, c.z), mul(v(c.vx / v0, c.vy / v0, c.vz / v0), s));
}

export function runawayVel(c: CrewSite, t: number): Vec {
  const v0 = Math.hypot(c.vx, c.vy, c.vz);
  if (v0 === 0) return v();
  return mul(v(c.vx / v0, c.vy / v0, c.vz / v0), runSpeed(v0, Math.max(0, t)));
}

/** Own-clock seconds the runaway pod has lived through after t world seconds. */
export function runawayTau(c: CrewSite, t: number): number {
  const v0 = Math.hypot(c.vx, c.vy, c.vz);
  let tau = 0;
  const dt = 0.5;
  for (let s = 0; s < t; s += dt) {
    const step = Math.min(dt, t - s);
    const b = runSpeed(v0, s + step / 2) / C;
    tau += step * Math.sqrt(Math.max(0.02, 1 - b * b));
  }
  return tau;
}

/** Where a waiting pod is right now (pulsar pods orbit, runaways fly). */
export function podPosAt(poi: Poi, c: CrewSite, worldS: number): Vec {
  if (c.kind === 'runaway') return runawayPos(c, worldS);
  if (c.kind === 'pulsar') {
    const p = poi.bodies[0];
    const rel = sub(poi.podStart, p);
    const axis = p.spinAxis;
    const a = worldS * 0.35;
    // rotate rel about axis (Rodrigues)
    const ca = Math.cos(a), sa = Math.sin(a);
    const k = cross(axis, rel);
    const kk = dot(axis, rel);
    return add(p, add(add(mul(rel, ca), mul(k, sa)), mul(axis, kk * (1 - ca))));
  }
  return poi.podStart;
}

// --- filler chunks ----------------------------------------------------------

export const chunkKey = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;
export const chunkOf = (p: Vec) => [Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK), Math.floor(p.z / CHUNK)] as const;

export interface World {
  seed: number;
  sites: CrewSite[];
  pois: Poi[];
  reserved: Set<string>;
  lanes: { a: Vec; b: Vec }[]; // centre to every black-hole POI: never blocked
  core: Body[]; // the sun
}

export function makeWorld(seed: number, sites: CrewSite[]): World {
  const pois = sites.map(s => poiFor(seed, s));
  const reserved = new Set<string>();
  const reserve = (p: Vec, ring: number) => {
    const [cx, cy, cz] = chunkOf(p);
    for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) for (let k = -ring; k <= ring; k++) reserved.add(chunkKey(cx + i, cy + j, cz + k));
  };
  reserve(v(0, 0, 0), 1);
  for (const poi of pois) {
    reserve(poi.podStart, 1);
    for (const b of poi.bodies) reserve(b, 1);
  }
  const lanes = pois.filter(p => p.kind === 'black_hole').map(p => ({ a: v(), b: p.bodies[0] as Vec }));
  // No sun: empty space, only the phenomena.
  const core: Body[] = [];
  return { seed, sites, pois, reserved, lanes, core };
}

function segDist(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, add(a, mul(ab, t)));
}

const chunkCache = new Map<string, Body[]>();
let cacheSeed = -1;

/** The filler content of one chunk. Pure; cached. */
export function chunkBodies(w: World, cx: number, cy: number, cz: number): Body[] {
  if (cacheSeed !== w.seed) { chunkCache.clear(); cacheSeed = w.seed; }
  const key = chunkKey(cx, cy, cz);
  const hit = chunkCache.get(key);
  if (hit) return hit;
  const out: Body[] = [];
  if (!w.reserved.has(key)) {
    const roll = hash3(w.seed + 101, cx, cy, cz);
    const r = rngFor(w.seed + 202, cx, cy, cz);
    const centre = v((cx + 0.5) * CHUNK, (cy + 0.5) * CHUNK, (cz + 0.5) * CHUNK);
    const at = add(centre, v((r() - 0.5) * CHUNK * 0.6, (r() - 0.5) * CHUNK * 0.6, (r() - 0.5) * CHUNK * 0.6));
    const blocksLane = () => w.lanes.some(l => segDist(at, l.a, l.b) < 450);
    const id = `c${key}`;
    const s = Math.floor(r() * 1e9);
    // A compact system, not a world to wander: empty space with the odd
    // planet near home. The phenomena live at the rescue sites only.
    const near = Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz)) <= 5;
    if (near && roll > 0.975 && !blocksLane()) {
      const radius = range(r, 8, 24);
      out.push(body({ id, kind: 'planet', ...at, radius, gm: 6 * radius * radius, seed: s, rings: r() < 0.4, hue: r() }));
    }
  }
  chunkCache.set(key, out);
  return out;
}

export function starTemp(r: Rand): number {
  // Mostly cool stars, a few hot blue ones.
  const x = r();
  return x < 0.55 ? range(r, 2800, 4500) : x < 0.85 ? range(r, 4500, 7000) : range(r, 7000, 28000);
}

/** Every body near a point: core, POIs and the 27 chunks around it. */
export function bodiesNear(w: World, p: Vec): Body[] {
  const [cx, cy, cz] = chunkOf(p);
  const out: Body[] = [...w.core];
  for (const poi of w.pois) for (const b of poi.bodies) if (dist(b, p) < 3000) out.push(b);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) out.push(...chunkBodies(w, cx + i, cy + j, cz + k));
  return out;
}
