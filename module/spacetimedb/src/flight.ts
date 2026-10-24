import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from './schema';
import type { Ctx } from './schema';
import { C, MOTHERSHIP } from './rules';
import { checkWin, cutTethers } from './helpers';

const LIMIT = 1e8;
const fin = (v: number, lo = -LIMIT, hi = LIMIT) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

function me(ctx: Ctx) {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) throw new SenderError('join a room first');
  return player;
}

/**
 * The ship's pose at 10 Hz, only when it changed. Client authoritative; the
 * server only clamps nonsense. Velocity rides along so other screens can
 * extrapolate a fast ship instead of trailing behind it.
 */
export const syncShip = spacetimedb.reducer(
  {
    x: t.f64(), y: t.f64(), z: t.f64(),
    qx: t.f32(), qy: t.f32(), qz: t.f32(), qw: t.f32(),
    vx: t.f64(), vy: t.f64(), vz: t.f64(),
    tau: t.f64(), oxygen: t.f32(), hull: t.u32(), status: t.string(),
  },
  (ctx, a) => {
    const player = me(ctx);
    const ship = ctx.db.ship.identity.find(ctx.sender);
    if (!ship || ship.room_code !== player.room_code) return;
    const status = a.status === 'dark' || a.status === 'home' ? a.status : 'flying';
    ctx.db.ship.identity.update({
      ...ship,
      x: fin(a.x), y: fin(a.y), z: fin(a.z),
      qx: fin(a.qx, -1, 1), qy: fin(a.qy, -1, 1), qz: fin(a.qz, -1, 1), qw: fin(a.qw, -1, 1),
      vx: fin(a.vx, -C, C), vy: fin(a.vy, -C, C), vz: fin(a.vz, -C, C),
      tau: fin(a.tau, 0, 1e7),
      oxygen: fin(a.oxygen, 0, 100),
      hull: Math.min(3, a.hull),
      status,
      updated_at: ctx.timestamp,
    });
  }
);

/** Clip a tether to a lost pod. A two-ship pod takes two different pilots. */
export const tetherCrew = spacetimedb.reducer({ crewId: t.u32() }, (ctx, { crewId }) => {
  const player = me(ctx);
  const code = player.room_code;
  const crew = ctx.db.crew.id.find(crewId);
  if (!crew || crew.room_code !== code || crew.status === 'home') return;
  const ties = [...ctx.db.tether.room_code.filter(code)];
  if (ties.some(tie => tie.owner.isEqual(ctx.sender))) return; // one tow at a time
  const onPod = ties.filter(tie => tie.target_kind === 'crew' && tie.target_crew === crewId);
  if (onPod.length >= 2) return;
  ctx.db.tether.insert({
    id: 0n,
    room_code: code,
    owner: ctx.sender,
    target_kind: 'crew',
    target_crew: crewId,
    target_ship: ctx.sender,
    since: ctx.timestamp,
  });
  if (crew.status === 'lost') ctx.db.crew.id.update({ ...crew, status: 'towed', towed_by: ctx.sender });
});

/** Clip a tether to a teammate whose ship went dark. */
export const tetherShip = spacetimedb.reducer({ target: t.identity() }, (ctx, { target }) => {
  const player = me(ctx);
  const code = player.room_code;
  if (target.isEqual(ctx.sender)) return;
  const ship = ctx.db.ship.identity.find(target);
  if (!ship || ship.room_code !== code || ship.status !== 'dark') return;
  const ties = [...ctx.db.tether.room_code.filter(code)];
  if (ties.some(tie => tie.owner.isEqual(ctx.sender))) return;
  if (ties.some(tie => tie.target_kind === 'ship' && tie.target_ship.isEqual(target))) return;
  ctx.db.tether.insert({
    id: 0n,
    room_code: code,
    owner: ctx.sender,
    target_kind: 'ship',
    target_crew: 0,
    target_ship: target,
    since: ctx.timestamp,
  });
});

/** Let go of whatever you are towing. */
export const releaseTether = spacetimedb.reducer(ctx => {
  const player = me(ctx);
  const code = player.room_code;
  for (const tie of [...ctx.db.tether.room_code.filter(code)]) {
    if (!tie.owner.isEqual(ctx.sender)) continue;
    ctx.db.tether.id.delete(tie.id);
    if (tie.target_kind === 'crew') {
      const crew = ctx.db.crew.id.find(tie.target_crew);
      const still = [...ctx.db.tether.room_code.filter(code)].find(
        o => o.target_kind === 'crew' && o.target_crew === tie.target_crew
      );
      if (crew && crew.status === 'towed') {
        if (still) ctx.db.crew.id.update({ ...crew, towed_by: still.owner });
        else ctx.db.crew.id.update({ ...crew, status: 'lost' });
      }
    }
  }
});

/**
 * Deliver a towed pod into the dock ring. The pod's own clock (tau) and the
 * pilot's clock are kept for the reunion bubble on every screen. x,y,z of the
 * crew row becomes where it was dropped, so a lost pod does not snap back.
 */
export const dockCrew = spacetimedb.reducer(
  { crewId: t.u32(), crewTau: t.f64(), pilotTau: t.f64() },
  (ctx, { crewId, crewTau, pilotTau }) => {
    const player = me(ctx);
    const code = player.room_code;
    const room = ctx.db.room.code.find(code);
    if (!room || room.phase !== 'playing') return;
    const crew = ctx.db.crew.id.find(crewId);
    if (!crew || crew.room_code !== code || crew.status !== 'towed') return;
    const ties = [...ctx.db.tether.room_code.filter(code)].filter(
      tie => tie.target_kind === 'crew' && tie.target_crew === crewId
    );
    if (!ties.some(tie => tie.owner.isEqual(ctx.sender))) return;
    if (crew.two_ship && ties.length < 2) return;
    for (const tie of ties) ctx.db.tether.id.delete(tie.id);
    ctx.db.crew.id.update({
      ...crew,
      status: 'home',
      towed_by: ctx.sender,
      tau: fin(crewTau, 0, 1e7),
      pilot_tau: fin(pilotTau, 0, 1e7),
      home_at: ctx.timestamp,
      x: MOTHERSHIP.x, y: MOTHERSHIP.y, z: MOTHERSHIP.z,
      vx: 0, vy: 0, vz: 0,
    });
    checkWin(ctx, code);
  }
);

/**
 * A pod that fell into a horizon with its pilot. It is pulled back to its
 * rescue site so the run can still be won, at the cost of the whole trip.
 */
export const podLost = spacetimedb.reducer({ crewId: t.u32() }, (ctx, { crewId }) => {
  const player = me(ctx);
  const crew = ctx.db.crew.id.find(crewId);
  if (!crew || crew.room_code !== player.room_code || crew.status === 'home') return;
  for (const tie of [...ctx.db.tether.room_code.filter(player.room_code)]) {
    if (tie.target_kind === 'crew' && tie.target_crew === crewId) ctx.db.tether.id.delete(tie.id);
  }
  ctx.db.crew.id.update({ ...crew, status: 'lost' });
});

/** Your ship crossed a horizon or you respawned: cut every tie to you. */
export const dropTethers = spacetimedb.reducer(ctx => {
  const player = me(ctx);
  cutTethers(ctx, player.room_code);
});

/** One-shot shared moments, inserted at most once per room and name. */
export const fireEvent = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const player = me(ctx);
  const code = player.room_code;
  const clean = name.slice(0, 64);
  for (const ev of ctx.db.room_event.room_code.filter(code)) if (ev.name === clean) return;
  ctx.db.room_event.insert({
    id: 0n,
    room_code: code,
    name: clean,
    fired_by: ctx.sender,
    fired_at: ctx.timestamp,
  });
});
