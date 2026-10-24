// Game numbers the server needs. Pure, imports nothing. The client keeps the
// same numbers in client/src/game/constants.ts; change both together.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const MAX_PILOTS = 6;

export const CHUNK = 400;
export const INTRO_S = 30;
export const COUNTDOWN_S = 600; // unused since v3, kept for the run column
export const POD_AIR_S = 120;
export const C = 40;

// The mothership sits on a fixed orbit point beside the dying star at origin.
export const MOTHERSHIP = { x: 0, y: 0, z: 260 };

// The scaling table, indexed by pilots - 1. Crew is always 2 x pilots.
export const FURTHEST_CHUNKS = [3, 4, 5, 6, 7, 8];
export const TWO_SHIP = [0, 1, 1, 2, 2, 3];
export const BLACK_HOLES = [1, 1, 2, 2, 3, 3];

export const RUNAWAY_SPEED = 28; // 0.7 c at launch; it slows over time (client)

export const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b'];

export const CREW_NAMES = [
  'Kai', 'Mia', 'Jay', 'Parth', 'Ninjago', 'Zara', 'Leo', 'Ana', 'Sam', 'Rio', 'Tess', 'Omar',
];

export const OTHER_POIS = ['pulsar', 'wormhole'];
export const ALL_POIS = ['black_hole', 'dark_matter', ...OTHER_POIS];
// A compact system: rescue sites sit between these distances (units).
export const NEAR_SITE = 700;
export const FAR_SITE = [1300, 1500, 1700, 1900, 2100, 2300];

export interface CrewPlan {
  slot: number;
  name: string;
  poi: string;
  two_ship: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  is_einstein: boolean;
}

// Seeded PRNG local to one layout. Never Math.random: the plan must be the same
// for a given seed if we ever recompute it.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Where every lost crewmate is, for this seed and pilot count. */
export function planCrew(seed: number, pilots: number): CrewPlan[] {
  const p = Math.max(1, Math.min(MAX_PILOTS, pilots));
  const n = 2 * p;
  const rand = mulberry32(seed ^ 0x5eed);

  // Black hole and dark matter always; then every other kind once before any
  // repeats, then whole shuffled cycles of all six.
  const kinds = ['black_hole', 'dark_matter', ...shuffled(OTHER_POIS, rand)];
  while (kinds.length < n) kinds.push(...shuffled(ALL_POIS, rand));
  kinds.length = n;

  // Two-ship rescues take the last slots. The first of them becomes an anchor
  // dive while the room still wants black holes; the rest are heavy pods.
  const twoShip = new Array(n).fill(false);
  const wantHoles = BLACK_HOLES[p - 1];
  let holes = kinds.filter(k => k === 'black_hole').length;
  for (let k = 0; k < TWO_SHIP[p - 1]; k++) {
    const i = n - 1 - k;
    twoShip[i] = true;
    if (holes < wantHoles && kinds[i] !== 'black_hole') {
      kinds[i] = 'black_hole';
      holes++;
    }
  }
  for (let i = n - 1; i >= 2 && holes < wantHoles; i--) {
    if (kinds[i] !== 'black_hole') {
      kinds[i] = 'black_hole';
      holes++;
    }
  }

  // Distances spread from 1.6 chunks out to the furthest ring. A runaway pod
  // always takes the furthest spot.
  const far = FAR_SITE[p - 1];
  const near = NEAR_SITE;
  const dists = Array.from({ length: n }, (_, i) => (n === 1 ? far : near + ((far - near) * i) / (n - 1)));
  const order = kinds.map((k, i) => ({ k, i })).sort((a, b) => (a.k === 'runaway' ? 1 : 0) - (b.k === 'runaway' ? 1 : 0));

  const spin = rand() * Math.PI * 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const names = CREW_NAMES;
  const plans: CrewPlan[] = [];
  order.forEach(({ k, i }, rank) => {
    const d = dists[rank] * (0.92 + rand() * 0.16);
    const az = spin + rank * golden;
    const el = (rand() * 2 - 1) * 0.3;
    const dir = { x: Math.cos(el) * Math.cos(az), y: Math.sin(el), z: Math.cos(el) * Math.sin(az) };
    const runaway = k === 'runaway';
    plans.push({
      slot: i,
      name: names[i % names.length],
      poi: k,
      two_ship: twoShip[i],
      x: dir.x * d,
      y: dir.y * d,
      z: dir.z * d,
      vx: runaway ? dir.x * RUNAWAY_SPEED : 0,
      vy: runaway ? dir.y * RUNAWAY_SPEED : 0,
      vz: runaway ? dir.z * RUNAWAY_SPEED : 0,
      is_einstein: false,
    });
  });
  plans.sort((a, b) => a.slot - b.slot);

  // Einstein: the system's biggest black hole, past the furthest site, in a
  // direction of its own. An anchor dive once there are two pilots.
  const az = spin + n * golden + golden / 2;
  const el = (rand() * 2 - 1) * 0.2;
  const d = far * 1.15;
  plans.push({
    slot: n,
    name: 'Einstein',
    poi: 'black_hole',
    two_ship: p >= 2,
    x: Math.cos(el) * Math.cos(az) * d,
    y: Math.sin(el) * d,
    z: Math.cos(el) * Math.sin(az) * d,
    vx: 0, vy: 0, vz: 0,
    is_einstein: true,
  });
  return plans;
}
