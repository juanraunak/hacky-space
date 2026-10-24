// The game, as one per-frame step over plain singletons. No drawing and no
// React state: the renderer and HUD read these objects every frame.
//
// Authority: my client owns my ship (pose, clock, oxygen, hull) and, while I
// lead a tow, that pod's place and air. The server owns rows that must agree
// (crew status, tethers, phase).

import * as THREE from 'three';
import { net, type Crew, type Ship } from '../net';
import {
  BOOST, BRAKE_K, C, DOCK_OFFSET, DOCK_RADIUS, HEAT_INTERVAL, HEAVY_SPREAD, ANCHOR_TETHER, LOOK_RATE,
  MOTHERSHIP, OXYGEN_S, POD_AIR, POD_REPORT_HZ, SYNC_FORCE_S, SYNC_HZ, SYNC_MIN_MOVE, SYNC_MIN_TURN,
  TETHER_HOLD_S, TETHER_LENGTH, TETHER_RANGE, THRUST, TOW_WEIGHT, TURN_RATE,
} from './../game/constants';
import { consumeLook, input } from '../input/input';
import {
  bodiesNear, dist, makeWorld, podPosAt, runawayTau, runawayVel, v,
  type Body, type CrewSite, type Poi, type Vec, type World,
} from '../universe/bodies';
import { clockRate, field, velocityFromProper, type Field } from '../relativity/physics';
import { beamOn } from '../relativity/hazards';
import { einsteinTick, einsteinOnHome, sayArrival } from './einstein';
import { audio } from '../audio/audio';

export const DOCK = { x: MOTHERSHIP.x + DOCK_OFFSET.x, y: MOTHERSHIP.y + DOCK_OFFSET.y, z: MOTHERSHIP.z + DOCK_OFFSET.z };

export interface PodView {
  crew: Crew;
  site: CrewSite;
  poi: Poi;
  pos: Vec;
  air: number;
  rate: number; // the pod's own clock rate right now
  tethered: number; // tethers on it
}

export const ship = {
  pos: v(MOTHERSHIP.x, MOTHERSHIP.y, MOTHERSHIP.z + 60),
  u: v(), // proper velocity
  vel: v(), // real velocity
  q: new THREE.Quaternion(),
  ang: { pitch: 0, yaw: 0 },
  tau: 0,
  oxygen: OXYGEN_S,
  hull: 3,
  status: 'flying' as Ship['status'],
  darkSince: 0,
  rate: 1,
  gravRate: 1,
  speed: 0,
  thrusting: false,
  boosting: false,
  invulnUntil: 0,
  heatT: 0,
  hitFlash: 0,
  whiteout: 0,
  wormholeCooldown: 0,
  field: null as Field | null,
  seeded: false,
};

export const game = {
  world: null as World | null,
  worldKey: '',
  pods: new Map<number, PodView>(),
  tetherHold: 0, // 0..1 progress
  tetherTarget: '' as string, // "crew:ID" or "ship:HEX"
  tow: null as null | { crewId: number; pos: Vec; vel: Vec; air: number; lastReport: number },
  towingShip: '' as string,
  lostSent: new Set<number>(),
  dockSent: new Set<number>(),
  wasTether: false,
  lastSync: 0,
  lastSent: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, status: '', hull: 3 },
  worldS: 0,
  nowMs: 0,
  runSeed: -1,
  reunion: null as null | { crewId: number; at: number },
  homeSeen: new Set<number>(),
  bodiesHere: [] as Body[],
  arrival: null as null | { body: Body; at: number; from: Vec },
  visited: new Set<string>(),
};

const tmpQ = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const tv = new THREE.Vector3();

export const forward = (q = ship.q) => { tv.set(0, 0, -1).applyQuaternion(q); return v(tv.x, tv.y, tv.z); };
export const upOf = (q = ship.q) => { tv.set(0, 1, 0).applyQuaternion(q); return v(tv.x, tv.y, tv.z); };

const siteOf = (c: Crew): CrewSite => ({
  id: c.id, kind: c.poi, isEinstein: c.isEinstein, twoShip: c.twoShip,
  x: c.x, y: c.y, z: c.z, vx: c.vx, vy: c.vy, vz: c.vz,
});

/** Rebuild the universe when the run (seed + crew) changes. */
export function syncWorld() {
  const run = net.run();
  const crew = net.crew();
  if (!run || crew.length === 0) { game.world = null; game.worldKey = ''; return; }
  const key = `${run.seed}:${crew.map(c => c.id).join(',')}`;
  if (key === game.worldKey) return;
  game.worldKey = key;
  game.world = makeWorld(run.seed, crew.map(siteOf));
  game.pods.clear();
  game.lostSent.clear();
  game.dockSent.clear();
  game.homeSeen.clear();
  game.visited.clear();
  game.arrival = null;
  game.tow = null;
}

/** Put my ship where the server spawned it, fresh for a run. */
export function resetShipFromRow(full: boolean) {
  const row = net.ship();
  if (row) {
    ship.pos = v(row.x, row.y, row.z);
    ship.q.set(row.qx, row.qy, row.qz, row.qw);
    if (full) ship.tau = row.tau;
  }
  // face the dying star's side of the mothership, nose level
  ship.q.setFromEuler(new THREE.Euler(0, 0, 0));
  ship.u = v(); ship.vel = v();
  ship.oxygen = OXYGEN_S; ship.hull = 3; ship.status = 'flying';
  if (full) ship.tau = 0;
  ship.seeded = true;
}

const rateCache = new Map<string, number>();
function rateAt(w: World, p: Vec): number {
  const k = `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`;
  let r = rateCache.get(k);
  if (r === undefined) {
    r = field(p, bodiesNear(w, p)).gravRate;
    if (rateCache.size > 2000) rateCache.clear();
    rateCache.set(k, r);
  }
  return r;
}

function respawnLocal() {
  ship.pos = v(MOTHERSHIP.x + 55 + (Math.random() - 0.5) * 20, MOTHERSHIP.y + 8, MOTHERSHIP.z + 110);
  ship.u = v(); ship.vel = v();
  ship.oxygen = OXYGEN_S; ship.hull = 3; ship.status = 'flying';
  ship.q.identity();
  game.tow = null;
  net.respawn();
}

function myTethers() {
  const me = net.identity();
  return net.tethers().filter(t => t.owner === me);
}

/** One frame of everything. */
export function stepGame(rawDt: number) {
  const dt = Math.min(rawDt, 0.05);
  const room = net.room();
  const run = net.run();
  syncWorld();
  const w = game.world;
  game.nowMs = net.now();
  game.worldS = run ? (game.nowMs - run.startedAt) / 1000 : 0;
  if (!w || !room || !run) return;

  if (game.runSeed !== run.seed) {
    game.runSeed = run.seed;
    resetShipFromRow(true);
  }

  const playing = room.phase === 'playing';
  const flying = playing || room.phase === 'intro' ? playing : false;

  stepPods(w, dt, playing);
  if (!flying) return;

  stepShip(w, dt);
  stepTether(w, dt);
  stepTow(w, dt);
  sendPose();
  einsteinTick(dt);
  watchHomecomings();
}

// --- my ship ----------------------------------------------------------------

function stepShip(w: World, dt: number) {
  const me = net.identity();
  const towedBy = net.tethers().find(t => t.targetKind === 'ship' && t.targetShip === me);
  const towing = !!game.tow || !!game.towingShip;
  const weight = towing ? TOW_WEIGHT : 1;
  const dark = ship.status === 'dark';

  // Steering: stick and keys set a turn rate; drag/mouse turns directly.
  const look = consumeLook();
  const k = 1 - Math.exp(-dt * 6);
  ship.ang.yaw += (-input.stick.x * TURN_RATE * weight - ship.ang.yaw) * k;
  ship.ang.pitch += (input.stick.y * TURN_RATE * weight - ship.ang.pitch) * k;
  if (!dark) {
    const yaw = ship.ang.yaw * dt - look.x * LOOK_RATE * weight;
    const pitch = ship.ang.pitch * dt - look.y * LOOK_RATE * weight;
    ship.q.multiply(tmpQ.setFromAxisAngle(AY, yaw));
    ship.q.multiply(tmpQ.setFromAxisAngle(AX, pitch));
    // Auto-level roll toward a soft system up so nobody gets lost.
    tv.set(1, 0, 0).applyQuaternion(ship.q);
    ship.q.multiply(tmpQ.setFromAxisAngle(AZ, -tv.y * Math.min(1, dt * 2.5)));
    ship.q.normalize();
  }

  // Bodies near me, cached per frame for the substeps.
  const bodies = bodiesNear(w, ship.pos);
  game.bodiesHere = bodies;
  const f0 = field(ship.pos, bodies);
  const deep = f0.danger > 0 || (f0.deepest?.kind === 'black_hole' && f0.deepestR < f0.deepest.rs * 3);
  const steps = deep ? 8 : 2;
  const h = dt / steps;
  const fwd = forward();
  ship.thrusting = !dark && input.thrust;
  ship.boosting = ship.thrusting && input.boost;
  const thrust = ship.thrusting ? THRUST * (ship.boosting ? BOOST : 1) * weight : 0;

  let f = f0;
  for (let i = 0; i < steps; i++) {
    if (i > 0) f = field(ship.pos, bodies);
    ship.u.x += (fwd.x * thrust + f.ax) * h;
    ship.u.y += (fwd.y * thrust + f.ay) * h;
    ship.u.z += (fwd.z * thrust + f.az) * h;
    const damp = Math.exp(-((!dark && input.brake ? BRAKE_K : 0) + f.drag) * h);
    ship.u.x *= damp; ship.u.y *= damp; ship.u.z *= damp;
    if (!dark) assist(fwd, f, h);
    ship.vel = velocityFromProper(ship.u);
    ship.pos.x += ship.vel.x * h; ship.pos.y += ship.vel.y * h; ship.pos.z += ship.vel.z * h;
    collide(bodies);
    if (f.horizon) break;
  }
  // NaN guard
  if (![ship.pos.x, ship.pos.y, ship.pos.z, ship.u.x, ship.u.y, ship.u.z].every(Number.isFinite)) {
    respawnLocal();
    return;
  }
  ship.field = f;
  ship.speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
  ship.gravRate = f.gravRate;
  ship.rate = clockRate(f.gravRate, ship.speed);

  // Being towed while dark: follow the tower.
  if (towedBy && dark) {
    const tower = displayShip(towedBy.owner);
    if (tower) {
      const want = v(tower.x - tower.fx * 11, tower.y - tower.fy * 11, tower.z - tower.fz * 11);
      const kk = 1 - Math.exp(-dt * 2.5);
      ship.vel = v((want.x - ship.pos.x) * 2.5, (want.y - ship.pos.y) * 2.5, (want.z - ship.pos.z) * 2.5);
      ship.u = { ...ship.vel };
      ship.pos.x += (want.x - ship.pos.x) * kk; ship.pos.y += (want.y - ship.pos.y) * kk; ship.pos.z += (want.z - ship.pos.z) * kk;
    }
  }

  // The core rule: oxygen drains on your own clock.
  ship.tau += dt * ship.rate;
  if (!dark) ship.oxygen -= dt * ship.rate;

  // Horizon: gone, no rescue.
  if (f.horizon) {
    audio.thud(1);
    if (game.tow) net.loseCrew(game.tow.crewId, ship.pos.x, ship.pos.y, ship.pos.z);
    ship.whiteout = 1.2;
    respawnLocal();
    return;
  }

  // Heat near stars, pulsar beams.
  const now = performance.now() / 1000;
  if (f.heat) {
    ship.heatT += dt;
    if (ship.heatT >= HEAT_INTERVAL) { ship.heatT = 0; damage(1); }
  } else ship.heatT = 0;
  for (const b of bodies) {
    if (b.kind !== 'pulsar') continue;
    if (beamOn(b, ship.pos, game.worldS) > 0 && now > ship.invulnUntil) {
      ship.invulnUntil = now + 1.5;
      damage(1);
    }
  }
  ship.hitFlash = Math.max(0, ship.hitFlash - dt * 2);
  ship.whiteout = Math.max(0, ship.whiteout - dt);
  ship.wormholeCooldown = Math.max(0, ship.wormholeCooldown - dt);

  // Wormholes: fly into a mouth, come out of the other.
  if (ship.wormholeCooldown <= 0) {
    for (const b of bodies) {
      if (b.kind !== 'wormhole' || !b.exit) continue;
      if (dist(ship.pos, b) < b.radius * 0.7) {
        const sp = Math.max(1, ship.speed);
        const dir = v(ship.vel.x / sp, ship.vel.y / sp, ship.vel.z / sp);
        ship.pos = v(b.exit.x + dir.x * b.radius * 1.8, b.exit.y + dir.y * b.radius * 1.8, b.exit.z + dir.z * b.radius * 1.8);
        if (game.tow) game.tow.pos = v(ship.pos.x - fwd.x * TETHER_LENGTH, ship.pos.y - fwd.y * TETHER_LENGTH, ship.pos.z - fwd.z * TETHER_LENGTH);
        ship.whiteout = 1;
        ship.wormholeCooldown = 3;
        audio.whoosh();
        break;
      }
    }
  }

  // Arriving at a phenomenon for the first time: a slow cinematic look.
  if (!game.arrival && w) {
    for (const poi of w.pois) for (const b of poi.bodies) {
      if (game.visited.has(b.id) || b.kind === 'exit_well') continue;
      const d = dist(ship.pos, b);
      const near = b.kind === 'black_hole' ? b.rs * 9 : b.kind === 'dark_matter' ? b.radius * 1.4 : b.kind === 'pulsar' ? 420 : b.kind === 'wormhole' ? b.radius * 9 : b.radius * 5;
      if (d < near) {
        game.visited.add(b.id);
        game.arrival = { body: b, at: performance.now(), from: { ...ship.pos } };
        sayArrival(b.kind);
        break;
      }
    }
  }

  // Blackout: no air or no hull.
  if (!dark && (ship.oxygen <= 0 || ship.hull <= 0)) {
    ship.status = 'dark';
    ship.oxygen = Math.max(0, ship.oxygen);
    ship.darkSince = now;
    if (game.tow) net.releaseTether();
  }
  if (ship.status === 'dark') {
    const others = net.players().filter(p => p.connected && p.identity !== me).length;
    const waited = now - ship.darkSince;
    if ((others === 0 && waited > 5) || waited > 30 || respawnRequested) {
      respawnRequested = false;
      respawnLocal();
    }
  }

  // The dock refills air and hull, and takes a dark ship back.
  if (dist(ship.pos, DOCK) < DOCK_RADIUS) {
    if (ship.status === 'dark') respawnLocal();
    ship.oxygen = OXYGEN_S;
    ship.hull = 3;
  }
}

/**
 * Flight assist (Juan: drifting was too hard): the ship goes where it points.
 * Sideways drift relative to the nose bleeds away quickly, and with no thrust
 * the ship eases to a stop. Only the part of the motion that gravity is not
 * causing is damped, so wells still pull you exactly as before (you still
 * feel and fight the pull; you just do not skate around).
 */
const ASSIST_SIDE = 3.2; // per second
const ASSIST_COAST = 0.45; // per second, only when not thrusting
function assist(fwd: Vec, f: Field, h: number) {
  // leave the pull alone near strong wells: that drift IS the lesson
  const pull = Math.hypot(f.ax, f.ay, f.az);
  const k = Math.max(0, 1 - pull / 25);
  if (k <= 0) return;
  const u = ship.u;
  const along = u.x * fwd.x + u.y * fwd.y + u.z * fwd.z;
  const sx = u.x - fwd.x * along, sy = u.y - fwd.y * along, sz = u.z - fwd.z * along;
  const side = 1 - Math.exp(-ASSIST_SIDE * k * h);
  u.x -= sx * side; u.y -= sy * side; u.z -= sz * side;
  if (!input.thrust) {
    const coast = Math.exp(-ASSIST_COAST * k * h);
    u.x *= coast; u.y *= coast; u.z *= coast;
  }
}

let respawnRequested = false;
export const requestRespawn = () => { respawnRequested = true; };

function damage(n: number) {
  ship.hull = Math.max(0, ship.hull - n);
  ship.hitFlash = 1;
  audio.hit();
}

function collide(bodies: Body[]) {
  for (const b of bodies) {
    if (b.kind !== 'sun' && b.kind !== 'star' && b.kind !== 'planet') continue;
    const dx = ship.pos.x - b.x, dy = ship.pos.y - b.y, dz = ship.pos.z - b.z;
    const r = Math.hypot(dx, dy, dz);
    const min = b.radius + 2;
    if (r < min && r > 0) {
      const nx = dx / r, ny = dy / r, nz = dz / r;
      ship.pos = v(b.x + nx * min, b.y + ny * min, b.z + nz * min);
      const un = ship.u.x * nx + ship.u.y * ny + ship.u.z * nz;
      if (un < 0) { ship.u.x -= nx * un * 1.4; ship.u.y -= ny * un * 1.4; ship.u.z -= nz * un * 1.4; }
      if (performance.now() / 1000 > ship.invulnUntil) { ship.invulnUntil = performance.now() / 1000 + 1; damage(1); }
    }
  }
}

// --- other ships, as drawn ---------------------------------------------------

export interface ShipDisplay { x: number; y: number; z: number; fx: number; fy: number; fz: number; q: THREE.Quaternion; row: Ship }
export const remote = new Map<string, ShipDisplay>();

/** Where another pilot's ship is drawn (extrapolated and smoothed by RemoteShips). */
export function displayShip(identity: string): ShipDisplay | undefined {
  if (identity === net.identity()) {
    const f = forward();
    return { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z, fx: f.x, fy: f.y, fz: f.z, q: ship.q, row: net.ship()! };
  }
  return remote.get(identity);
}

// --- pods ---------------------------------------------------------------------

function stepPods(w: World, dt: number, playing: boolean) {
  const me = net.identity();
  const ties = net.tethers();
  const run = net.run()!;
  const t = Math.max(0, game.worldS);
  for (const c of net.crew()) {
    const poi = w.pois.find(p => p.crewId === c.id);
    if (!poi) continue;
    const site = w.sites.find(s => s.id === c.id)!;
    let view = game.pods.get(c.id);
    const tethered = ties.filter(x => x.targetKind === 'crew' && x.targetCrew === c.id).length;
    if (!view) {
      view = { crew: c, site, poi, pos: c.moved ? v(c.px, c.py, c.pz) : podPosAt(poi, site, t), air: c.air, rate: 1, tethered };
      game.pods.set(c.id, view);
    }
    view.crew = c;
    view.tethered = tethered;
    const sinceAir = Math.max(0, (game.nowMs - c.airMs) / 1000);

    if (c.status === 'home') {
      view.pos = DOCK;
      view.air = c.air;
      view.rate = 1;
    } else if (c.status === 'lost') {
      view.pos = v(c.px, c.py, c.pz);
      view.air = 0;
      view.rate = 0;
    } else if (c.status === 'waiting') {
      if (!c.moved && c.poi === 'runaway') {
        view.pos = podPosAt(poi, site, t);
        const vel = runawayVel(site, t);
        const b = Math.hypot(vel.x, vel.y, vel.z) / C;
        view.rate = Math.sqrt(Math.max(0.02, 1 - b * b));
        view.air = run.podAirS - runawayTau(site, t);
      } else {
        view.pos = c.moved ? v(c.px, c.py, c.pz) : podPosAt(poi, site, t);
        view.rate = rateAt(w, c.moved ? view.pos : poi.podStart);
        view.air = Math.min(c.air, c.air - view.rate * sinceAir);
      }
    } else if (c.status === 'towed') {
      if (game.tow && game.tow.crewId === c.id) {
        view.pos = game.tow.pos;
        view.air = game.tow.air;
        view.rate = ship.rate;
      } else {
        const target = v(c.px, c.py, c.pz);
        const k = 1 - Math.exp(-dt * 6);
        view.pos = v(view.pos.x + (target.x - view.pos.x) * k, view.pos.y + (target.y - view.pos.y) * k, view.pos.z + (target.z - view.pos.z) * k);
        view.air = c.air - sinceAir;
        view.rate = 1;
      }
    }

    // A pod whose air ran out is lost. Any client may say so; the first wins.
    if (playing && (c.status === 'waiting' || c.status === 'towed') && view.air <= 0 && !game.lostSent.has(c.id)) {
      const mine = c.status === 'waiting' || (game.tow?.crewId === c.id) || c.towedBy === me;
      if (mine || c.status === 'waiting') {
        game.lostSent.add(c.id);
        net.loseCrew(c.id, view.pos.x, view.pos.y, view.pos.z);
        if (game.tow?.crewId === c.id) game.tow = null;
      }
    }
  }
}

// --- tethers ------------------------------------------------------------------

function stepTether(_w: World, dt: number) {
  const me = net.identity();
  const mine = myTethers();
  const pressed = input.tether && !game.wasTether;
  game.wasTether = input.tether;

  // Holding a tow: a fresh press lets go.
  if (mine.length > 0) {
    game.tetherHold = 0;
    if (pressed) { net.releaseTether(); game.tow = null; game.towingShip = ''; audio.blip(300); }
    return;
  }
  if (ship.status === 'dark' || !input.tether) { game.tetherHold = 0; game.tetherTarget = ''; return; }

  // Nearest thing I could clip to.
  let best = '', bestD = TETHER_RANGE;
  for (const p of game.pods.values()) {
    const c = p.crew;
    const ok = c.status === 'waiting' || (c.status === 'towed' && c.twoShip && p.tethered < 2);
    if (!ok) continue;
    const d = dist(p.pos, ship.pos);
    if (d < bestD) { bestD = d; best = `crew:${c.id}`; }
  }
  for (const s of net.ships()) {
    if (s.identity === me || s.status !== 'dark') continue;
    const d = remote.get(s.identity);
    if (!d) continue;
    const dd = dist(d, ship.pos);
    if (dd < bestD) { bestD = dd; best = `ship:${s.identity}`; }
  }
  if (best !== game.tetherTarget) { game.tetherTarget = best; game.tetherHold = 0; }
  if (!best) return;
  game.tetherHold = Math.min(1, game.tetherHold + dt / TETHER_HOLD_S);
  if (game.tetherHold >= 1) {
    game.tetherHold = 0;
    const [kind, id] = best.split(':');
    if (kind === 'crew') {
      const p = game.pods.get(Number(id))!;
      net.tetherCrew(p.crew.id, Math.max(0, p.air));
      game.tow = { crewId: p.crew.id, pos: { ...p.pos }, vel: v(), air: Math.max(0, p.air), lastReport: 0 };
    } else {
      net.tetherShip(id);
      game.towingShip = id;
    }
    audio.blip(660);
  }
}

// --- towing -------------------------------------------------------------------

function stepTow(_w: World, dt: number) {
  const me = net.identity();
  const mine = myTethers();
  if (game.towingShip && !mine.some(t => t.targetKind === 'ship')) game.towingShip = '';
  if (!game.tow) {
    // Second tower on a two-ship pod: a leash keeps me near it.
    const leash = mine.find(t => t.targetKind === 'crew');
    if (leash) {
      const p = game.pods.get(leash.targetCrew);
      if (p) pullToward(p.pos, ANCHOR_TETHER, dt);
    }
    return;
  }
  const tow = game.tow;
  const c = net.crew().find(x => x.id === tow.crewId);
  const now = performance.now();
  // It ended, or someone else leads this pod (then I am the second tower).
  if (!c || c.status === 'home' || c.status === 'lost' || (c.status === 'towed' && c.towedBy !== me)) { game.tow = null; return; }
  // Waiting for the server to accept the tether; give up if it never does.
  if (c.status === 'waiting') {
    if (!tow.lastReport) tow.lastReport = now;
    if (now - tow.lastReport > 3000) game.tow = null;
    return;
  }

  const fwd = forward();
  const towers = net.tethers().filter(x => x.targetKind === 'crew' && x.targetCrew === tow.crewId).map(x => x.owner);
  if (c.twoShip) {
    if (towers.length < 2) {
      // Too heavy for one: the pod stays, the tether is a leash.
      pullToward(tow.pos, ANCHOR_TETHER, dt);
    } else {
      const other = displayShip(towers.find(x => x !== me) ?? me);
      if (other) {
        const mid = v((ship.pos.x + other.x) / 2, (ship.pos.y + other.y) / 2, (ship.pos.z + other.z) / 2);
        const spread = dist(ship.pos, other);
        const isHole = c.poi === 'black_hole';
        const otherSpeed = Math.hypot(other.row?.vx ?? 0, other.row?.vy ?? 0, other.row?.vz ?? 0);
        // Anchor dive: both hold still and the tether reels. Heavy pod: fly in step.
        const reel = isHole ? ship.speed < 8 && otherSpeed < 8 : spread < HEAVY_SPREAD;
        if (reel) moveToward(tow, mid, isHole ? 7 : 14, dt);
        pullToward(tow.pos, ANCHOR_TETHER, dt);
      }
    }
  } else {
    // A spring behind the ship.
    const want = v(ship.pos.x - fwd.x * TETHER_LENGTH, ship.pos.y - fwd.y * TETHER_LENGTH, ship.pos.z - fwd.z * TETHER_LENGTH);
    const kS = 9, kD = 4.5;
    tow.vel.x += ((want.x - tow.pos.x) * kS - (tow.vel.x - ship.vel.x) * kD) * dt;
    tow.vel.y += ((want.y - tow.pos.y) * kS - (tow.vel.y - ship.vel.y) * kD) * dt;
    tow.vel.z += ((want.z - tow.pos.z) * kS - (tow.vel.z - ship.vel.z) * kD) * dt;
    tow.pos.x += tow.vel.x * dt; tow.pos.y += tow.vel.y * dt; tow.pos.z += tow.vel.z * dt;
    if (dist(tow.pos, ship.pos) > 30) tow.pos = { ...want };
  }

  // A towed pod's air drains on the tower's clock.
  tow.air -= dt * ship.rate;

  if (now - tow.lastReport > 1000 / POD_REPORT_HZ) {
    tow.lastReport = now;
    net.reportPod(tow.crewId, tow.pos.x, tow.pos.y, tow.pos.z, Math.max(0, tow.air));
  }
  // Deliver into the dock ring.
  if ((dist(tow.pos, DOCK) < DOCK_RADIUS || dist(ship.pos, DOCK) < DOCK_RADIUS) && !game.dockSent.has(tow.crewId)) {
    if (!c.twoShip || towers.length >= 2) {
      game.dockSent.add(tow.crewId);
      net.dockCrew(tow.crewId, Math.max(0, POD_AIR - tow.air), ship.tau, Math.max(0, tow.air));
      game.reunion = { crewId: tow.crewId, at: performance.now() };
    }
  }
}

function moveToward(tow: { pos: Vec; vel: Vec }, target: Vec, maxSpeed: number, dt: number) {
  const dx = target.x - tow.pos.x, dy = target.y - tow.pos.y, dz = target.z - tow.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 6) return;
  const s = Math.min(maxSpeed * dt, d - 6);
  tow.pos.x += (dx / d) * s; tow.pos.y += (dy / d) * s; tow.pos.z += (dz / d) * s;
}

/** A tether at full stretch pulls my ship back toward its anchor. */
function pullToward(anchor: Vec, length: number, dt: number) {
  const dx = anchor.x - ship.pos.x, dy = anchor.y - ship.pos.y, dz = anchor.z - ship.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d <= length) return;
  const over = d - length;
  const k = over * 4 * dt;
  ship.u.x += (dx / d) * k; ship.u.y += (dy / d) * k; ship.u.z += (dz / d) * k;
  if (over > 20) { ship.pos.x += (dx / d) * (over - 20); ship.pos.y += (dy / d) * (over - 20); ship.pos.z += (dz / d) * (over - 20); }
}

// --- sync ---------------------------------------------------------------------

function sendPose() {
  const now = performance.now();
  if (now - game.lastSync < 1000 / SYNC_HZ) return;
  const l = game.lastSent;
  const moved = Math.hypot(ship.pos.x - l.x, ship.pos.y - l.y, ship.pos.z - l.z) > SYNC_MIN_MOVE;
  const turned = Math.abs(ship.q.x - l.qx) + Math.abs(ship.q.y - l.qy) + Math.abs(ship.q.z - l.qz) + Math.abs(ship.q.w - l.qw) > SYNC_MIN_TURN;
  const changed = moved || turned || ship.status !== l.status || ship.hull !== l.hull;
  if (!changed && now - game.lastSync < SYNC_FORCE_S * 1000) return;
  game.lastSync = now;
  Object.assign(l, { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z, qx: ship.q.x, qy: ship.q.y, qz: ship.q.z, qw: ship.q.w, status: ship.status, hull: ship.hull });
  net.syncShip({
    x: ship.pos.x, y: ship.pos.y, z: ship.pos.z,
    qx: ship.q.x, qy: ship.q.y, qz: ship.q.z, qw: ship.q.w,
    vx: ship.vel.x, vy: ship.vel.y, vz: ship.vel.z,
    tau: ship.tau, oxygen: Math.max(0, ship.oxygen), hull: ship.hull, status: ship.status,
  });
}

// --- reunions -------------------------------------------------------------------

function watchHomecomings() {
  for (const c of net.crew()) {
    if (c.status !== 'home' || game.homeSeen.has(c.id)) continue;
    game.homeSeen.add(c.id);
    einsteinOnHome(c);
  }
}
