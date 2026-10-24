// The flight, as one lesson (PLAN.md v4). After you take off, Newton has been
// flung past a black hole onto a blue planet on the far side. The hole sits in
// the way and pulls; fall in and you die. Go around it (or take the wormhole).
// The closer you skim the hole, the slower your time runs, so the longer
// Newton waits: his picture in the corner gets older and older. When you
// reach him, he tells you how long it was for him.
//
// All client-side and the same on every screen (a pure function of the seed
// and the crew rows): the server's rows are untouched.

import { v, type Body, type CrewSite, type Vec, type World } from '../universe/bodies';
import { net, type Crew } from '../net';
import { OPEN } from './onfoot';

// --- the place ------------------------------------------------------------------

/** The black hole: the boss. A wall between you and Newton. */
export const HOLE = { x: OPEN.x, y: OPEN.y - 60, z: OPEN.z - 2200 };
export const HOLE_RS = 45;
/** Its pull: gm / (r - rs)^2. Felt from far away; past ~2 rs even boost can't escape. */
export const HOLE_GM = 240000;
/** Inside this radius the pull is at least HOLE_FLOOR: more than thrust (32), less than boost (80). */
export const HOLE_ZONE = HOLE_RS * 12;
export const HOLE_FLOOR = 52;

/** Newton's planet, right behind the hole. */
export const PLANET = { x: OPEN.x + 60, y: OPEN.y - 20, z: OPEN.z - 3250 };
export const PLANET_R = 50;
/** Where Newton waits: on the planet, on the side facing you. */
export const NEWTON_AT = (() => {
  const d = { x: 0.15, y: 0.45, z: 1 };
  const l = Math.hypot(d.x, d.y, d.z);
  const r = PLANET_R + 2.5;
  return { x: PLANET.x + (d.x / l) * r, y: PLANET.y + (d.y / l) * r, z: PLANET.z + (d.z / l) * r };
})();

// Spread out along the way (Juan: not everything in one spot).
// The wormhole: a detour to the left that drops you out just past the hole,
// still inside its pull.
const WORM_IN = { x: OPEN.x - 700, y: OPEN.y + 20, z: OPEN.z - 900 };
const WORM_OUT = { x: HOLE.x - 300, y: HOLE.y + 70, z: HOLE.z - 260 };
const PULSAR_AT = { x: OPEN.x - 950, y: OPEN.y + 220, z: OPEN.z - 1450 };
/** The bigger of the twin stars (the comet's tail points away from it). */
export const TWIN_STAR = { x: OPEN.x + 1150, y: OPEN.y + 520, z: OPEN.z - 1900 };

function body(p: Partial<Body> & Pick<Body, 'id' | 'kind' | 'x' | 'y' | 'z' | 'radius'>): Body {
  return {
    gm: 0, rs: 0, core: 0, clockRs: 0, temp: 5800, seed: 0, drag: 0,
    period: 2, spinAxis: v(0, 1, 0), beamTilt: 0.8, rings: false, hue: 0.1, normal: v(0, 1, 0),
    ...p,
  };
}

const unit = (a: Vec): Vec => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/** The sights on the way, and Newton's planet. Ids start with "s:". */
export function scenery(seed: number): Body[] {
  const o = OPEN;
  return [
    // a ringed gas giant, off to the right, soon after take-off
    body({ id: 's:giant', kind: 'planet', x: o.x + 560, y: o.y - 120, z: o.z - 700, radius: 95, gm: 0, rings: true, hue: 0.07, seed: seed ^ 0x61a7 }),
    body({ id: 's:moon', kind: 'planet', x: o.x + 380, y: o.y + 60, z: o.z - 520, radius: 10, gm: 0, hue: 0.55, seed: seed ^ 0x3b1 }),
    // the pulsar
    body({
      id: 's:pulsar', kind: 'pulsar', ...PULSAR_AT, radius: 5, temp: 40000, period: 2.4,
      spinAxis: unit({ x: 0.3, y: 1, z: 0.2 }), beamTilt: 0.85, seed: seed ^ 0x9175,
    }),
    // twin stars, up and to the right
    body({ id: 's:twinA', kind: 'star', ...TWIN_STAR, radius: 60, temp: 11000, seed: seed ^ 0x77 }),
    body({ id: 's:twinB', kind: 'star', x: TWIN_STAR.x + 190, y: TWIN_STAR.y - 50, z: TWIN_STAR.z - 90, radius: 38, temp: 4200, seed: seed ^ 0x78 }),
    // the wormhole shortcut
    body({ id: 's:worm', kind: 'wormhole', ...WORM_IN, radius: 24, exit: v(WORM_OUT.x, WORM_OUT.y, WORM_OUT.z), mouth: 'entry', seed: seed ^ 0x501 }),
    body({ id: 's:wormx', kind: 'wormhole', ...WORM_OUT, radius: 24, exit: v(WORM_IN.x, WORM_IN.y, WORM_IN.z), mouth: 'exit', seed: seed ^ 0x502 }),
    // Newton's planet: blue, with air
    body({ id: 's:newton', kind: 'planet', ...PLANET, radius: PLANET_R, gm: 0, hue: 0.5, seed: seed ^ 0x4e77 }),
  ];
}

/** The comet flies across the path on a slow loop. Where it is at world time t. */
export function cometPos(t: number): Vec {
  const a = t * 0.01;
  return { x: OPEN.x + 250 + Math.cos(a) * 420, y: OPEN.y + 160 + Math.sin(a * 0.7) * 60, z: OPEN.z - 1250 + Math.sin(a) * 260 };
}
export const COMET: Vec = { x: 0, y: 0, z: 0 }; // updated each frame by stepStory

/** Which crew row is Newton: the first black-hole row, else the first row. */
export function newtonOf(crew: readonly Crew[]): Crew | undefined {
  const sorted = [...crew].sort((a, b) => a.id - b.id);
  return sorted.find(c => c.poi === 'black_hole') ?? sorted[0];
}

/** Newton's site: its body is the story's black hole. */
export function newtonSite(c: Crew): CrewSite {
  return { id: c.id, kind: 'black_hole', isEinstein: false, twoShip: false, x: HOLE.x, y: HOLE.y, z: HOLE.z, vx: 0, vy: 0, vz: 0 };
}

/** After makeWorld: the big hole in the way, Newton on his planet, and the sights. */
export function dressWorld(w: World, seed: number) {
  const poi = w.pois[0];
  if (poi) {
    const hole = poi.bodies[0];
    hole.rs = HOLE_RS; hole.radius = HOLE_RS; hole.clockRs = HOLE_RS;
    hole.gm = HOLE_GM;
    hole.pullFloor = HOLE_FLOOR;
    hole.pullR = HOLE_ZONE;
    hole.normal = unit({ x: 0.15, y: 1, z: 0.35 });
    hole.temp = 7000;
    poi.podStart = { ...NEWTON_AT };
    poi.podDepth = 0;
  }
  w.core = scenery(seed);
  w.lanes = [];
}

// --- time ---------------------------------------------------------------------------

/** Newton's age when the star collapsed. */
export const NEWTON_AGE0 = 44;
/** Too old: about the life expectancy in India. Past this, we were too late. */
export const NEWTON_LIMIT = 72;
/** Everyone ages this many years per second of normal time (the game's scale). */
const BASE_YEARS_PER_S = 0.05;
/** Extra years Newton lives through for each second our clocks drift apart (exaggerated). */
const YEARS_PER_S = 0.6;

/**
 * My clock, exaggerated so the lesson shows in a short game: real
 * Schwarzschild sqrt(1 - rs/r), raised to the 6th power.
 */
export const myClockRate = (gravRate: number) => Math.pow(Math.max(0, gravRate), 6);

/** Newton's age now, in years. */
export const newtonAge = () => NEWTON_AGE0 + story.newtonS * BASE_YEARS_PER_S + Math.max(0, story.newtonS - story.myS) * YEARS_PER_S;
/** My age gain over the trip, on the same scale. */
export const myYears = () => story.myS * BASE_YEARS_PER_S;

// --- the story's state -----------------------------------------------------------

export const story = {
  /** The clock of the outside as I see it: runs fast when my clock runs slow. */
  seenS: 0,
  /** My own (exaggerated) clock since take-off. */
  myS: 0,
  /** Newton's clock since take-off: he is far from the hole, so it runs normally. */
  newtonS: 0,
  /** performance.now() when I fell into the hole, 0 when alive. */
  diedAt: 0,
  /** performance.now() when I reached Newton, 0 before. */
  foundAt: 0,
  foundAge: 0,
  foundMyS: 0,
  /** performance.now() when Newton got too old, 0 before. */
  lostAt: 0,
  /** I reached Newton and am waiting for friends. */
  waiting: false,
  said: new Set<string>(),
  line: null as null | { who: 'einstein' | 'newton'; text: string; at: number; hold: number; cps: number },
  queue: [] as { who: 'einstein' | 'newton'; text: string; hold: number; cps: number }[],
  runKey: '',
};

export function resetStory(key: string) {
  story.runKey = key;
  story.seenS = 0; story.myS = 0; story.newtonS = 0;
  story.diedAt = 0; story.foundAt = 0; story.foundAge = 0; story.foundMyS = 0; story.lostAt = 0; story.waiting = false;
  story.said.clear(); story.line = null; story.queue.length = 0;
}

/** Say a line once (by key), after whatever is being said now. */
export function sayOnce(key: string, text: string, opts: { hold?: number; cps?: number; now?: boolean } = {}) {
  if (story.said.has(key)) return;
  story.said.add(key);
  const l = { who: 'einstein' as const, text, hold: opts.hold ?? 3.2, cps: opts.cps ?? 32 };
  if (opts.now) { story.queue.length = 0; story.line = { ...l, at: performance.now() / 1000 }; } else story.queue.push(l);
}

/** Advance the line queue. */
export function stepLines() {
  const now = performance.now() / 1000;
  const l = story.line;
  if (l && now - l.at > Array.from(l.text).length / l.cps + l.hold + 0.4) story.line = null;
  if (!story.line && story.queue.length) story.line = { ...story.queue.shift()!, at: now + 0.3 };
}

export interface Said { text: string; shown: number; alpha: number }

/** What Einstein is saying in flight right now, typed. */
export function flightSaying(): Said | null {
  const l = story.line;
  if (!l || story.diedAt || story.foundAt || story.lostAt) return null;
  const s = performance.now() / 1000 - l.at;
  if (s < 0) return null;
  const n = Array.from(l.text).length;
  const end = n / l.cps + l.hold;
  return { text: l.text, shown: Math.min(n, Math.floor(s * l.cps)), alpha: s > end ? Math.max(0, 1 - (s - end) / 0.4) : 1 };
}

/** Is there anyone else flying in this room? */
export const friendsFlying = () => net.ships().some(s => s.identity !== net.identity() && s.status !== 'home');
