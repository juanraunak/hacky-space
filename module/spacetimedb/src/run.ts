import { SenderError } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import spacetimedb from './schema';
import type { Ctx } from './schema';
import { COUNTDOWN_S, INTRO_S, MAX_PILOTS, planCrew } from './rules';
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
  });
  for (const c of plan) {
    ctx.db.crew.insert({
      id: 0,
      room_code: code,
      ...c,
      status: 'lost',
      towed_by: room.host,
      tau: 0,
      home_at: ctx.timestamp,
      pilot_tau: 0,
    });
  }
  // Every ship starts the run fresh at the mothership.
  for (const ship of [...ctx.db.ship.room_code.filter(code)]) spawnShip(ctx, code, ship.identity);
  ctx.db.room.code.update({ ...room, phase: 'intro' });
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

/** The star went off. Only true once the countdown has really run out. */
export const timeUp = spacetimedb.reducer(ctx => {
  const room = myRoom(ctx);
  if (room.phase !== 'playing') return;
  const run = ctx.db.run.room_code.find(room.code);
  if (!run) return;
  const end = micros(run.started_at) + BigInt(run.countdown_s) * 1_000_000n;
  if (micros(ctx.timestamp) + 1_000_000n < end) return;
  ctx.db.run.room_code.update({ ...run, result: 'lost', ended_at: ctx.timestamp });
  ctx.db.room.code.update({ ...room, phase: 'lost' });
});

/** Host only: back to the lobby for another run. */
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
