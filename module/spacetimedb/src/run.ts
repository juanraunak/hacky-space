import { SenderError, t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import spacetimedb from './schema';
import type { Ctx } from './schema';
import { COUNTDOWN_S, INTRO_S, MAX_PILOTS, POD_AIR_S, planCrew, planLevel } from './rules';
import { spawnShip } from './helpers';

function myRoom(ctx: Ctx) {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) throw new SenderError('join a room first');
  const room = ctx.db.room.code.find(player.room_code);
  if (!room) throw new SenderError('room is gone');
  return room;
}

function micros(ts: Timestamp): bigint {
  return ts.microsSinceUnixEpoch;
}

function clearRun(ctx: Ctx, code: string) {
  for (const c of [...ctx.db.crew.room_code.filter(code)]) ctx.db.crew.id.delete(c.id);
  for (const tie of [...ctx.db.tether.room_code.filter(code)]) ctx.db.tether.id.delete(tie.id);
  for (const ev of [...ctx.db.room_event.room_code.filter(code)]) ctx.db.room_event.id.delete(ev.id);
  ctx.db.run.room_code.delete(code);
}

/** Host only. Locks the crew count to the pilots in the room right now. */
export const startRun = spacetimedb.reducer(ctx => {
  const room = myRoom(ctx);
  if (!room.host.isEqual(ctx.sender)) throw new SenderError('only the host can launch');
  if (room.phase !== 'lobby') return;
  const code = room.code;
  clearRun(ctx, code);

  const pilots = Math.min(
    MAX_PILOTS,
    Math.max(1, [...ctx.db.player.room_code.filter(code)].filter(p => p.connected).length)
  );
  const seed = Math.floor(ctx.random() * 0xffffffff) >>> 0;
  const startedAt = new Timestamp(micros(ctx.timestamp) + BigInt(INTRO_S) * 1_000_000n);
  const startedMs = Number(micros(startedAt) / 1000n);
  const plan = planCrew(seed, pilots);

  ctx.db.run.insert({
    room_code: code,
    seed,
    intro_at: ctx.timestamp,
    started_at: startedAt,
    countdown_s: COUNTDOWN_S,
    pilots,
    crew_count: plan.length,
    result: '',
    ended_at: ctx.timestamp,
    pod_air_s: POD_AIR_S,
  });
  for (const c of plan) {
    ctx.db.crew.insert({
      id: 0,
      room_code: code,
      ...c,
      status: 'waiting',
      towed_by: room.host,
      tau: 0,
      home_at: ctx.timestamp,
      pilot_tau: 0,
      air: POD_AIR_S,
      air_ms: startedMs,
      px: c.x,
      py: c.y,
      pz: c.z,
      moved: false,
    });
  }
  // Every ship starts the run fresh at the mothership.
  for (const ship of [...ctx.db.ship.room_code.filter(code)]) spawnShip(ctx, code, ship.identity);
  ctx.db.room_event.insert({ id: 0n, room_code: code, name: 'intro', fired_by: ctx.sender, fired_at: ctx.timestamp });
  ctx.db.room.code.update({ ...room, phase: 'intro' });
});

/**
 * Host only. A single level (black_hole | pulsar | wormhole): one crewmate at
 * that phenomenon, no opening cinematic, straight into play. Friends can join.
 */
export const startLevel = spacetimedb.reducer({ kind: t.string() }, (ctx, { kind }) => {
  const room = myRoom(ctx);
  if (!room.host.isEqual(ctx.sender)) throw new SenderError('only the host can start a level');
  const code = room.code;
  clearRun(ctx, code);
  const seed = Math.floor(ctx.random() * 0xffffffff) >>> 0;
  const now = micros(ctx.timestamp);
  const nowMs = Number(now / 1000n);
  // intro_at in the past so no client plays the opening; play starts now.
  const introAt = new Timestamp(now - BigInt(INTRO_S + 5) * 1_000_000n);
  const plan = planLevel(seed, kind);
  const pilots = Math.max(1, [...ctx.db.player.room_code.filter(code)].filter(p => p.connected).length);
  ctx.db.run.insert({
    room_code: code, seed, intro_at: introAt, started_at: ctx.timestamp, countdown_s: COUNTDOWN_S,
    pilots, crew_count: plan.length, result: '', ended_at: ctx.timestamp, pod_air_s: POD_AIR_S,
  });
  for (const c of plan) {
    ctx.db.crew.insert({
      id: 0, room_code: code, ...c, status: 'waiting', towed_by: room.host, tau: 0, home_at: ctx.timestamp,
      pilot_tau: 0, air: POD_AIR_S, air_ms: nowMs, px: c.x, py: c.y, pz: c.z, moved: false,
    });
  }
  for (const ship of [...ctx.db.ship.room_code.filter(code)]) spawnShip(ctx, code, ship.identity);
  ctx.db.room_event.insert({ id: 0n, room_code: code, name: `level:${kind}`, fired_by: ctx.sender, fired_at: ctx.timestamp });
  ctx.db.room.code.update({ ...room, phase: 'playing' });
});

/** Anyone may call it; it only moves intro to playing once the intro is over. */
export const beginPlay = spacetimedb.reducer(ctx => {
  const room = myRoom(ctx);
  if (room.phase !== 'intro') return;
  const run = ctx.db.run.room_code.find(room.code);
  if (!run) return;
  // a second of slack for phones whose clocks run a little ahead
  if (micros(ctx.timestamp) + 1_000_000n < micros(run.started_at)) return;
  ctx.db.room.code.update({ ...room, phase: 'playing' });
});

/** Play Again. Host only: same party, same code, fresh universe on next launch. */
export const backToLobby = spacetimedb.reducer(ctx => {
  const room = myRoom(ctx);
  if (!room.host.isEqual(ctx.sender)) throw new SenderError('only the host can do that');
  clearRun(ctx, room.code);
  for (const ship of [...ctx.db.ship.room_code.filter(room.code)]) spawnShip(ctx, room.code, ship.identity);
  ctx.db.room.code.update({ ...room, phase: 'lobby' });
});

/** If the host left, the next connected pilot takes over. */
export const claimHost = spacetimedb.reducer(ctx => {
  const room = myRoom(ctx);
  const host = ctx.db.player.identity.find(room.host);
  if (host && host.connected && host.room_code === room.code) return;
  ctx.db.room.code.update({ ...room, host: ctx.sender });
});
