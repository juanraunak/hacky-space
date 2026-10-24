import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from './schema';
import type { Ctx } from './schema';
import { CODE_ALPHABET, CODE_LENGTH, COLORS, MAX_PILOTS } from './rules';
import { cleanCode, cutTethers, spawnShip } from './helpers';

function newRoomCode(ctx: Ctx): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[ctx.random.integerInRange(0, CODE_ALPHABET.length - 1)];
    }
    if (!ctx.db.room.code.find(code)) return code;
  }
  throw new SenderError('could not allocate a unique room code');
}

export const init = spacetimedb.init(_ctx => {});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (player && !player.connected) ctx.db.player.identity.update({ ...player, connected: true });
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) return;
  ctx.db.player.identity.update({ ...player, connected: false });
});

export const createRoom = spacetimedb.reducer(ctx => {
  ctx.db.room.insert({
    code: newRoomCode(ctx),
    host: ctx.sender,
    phase: 'lobby',
    created_at: ctx.timestamp,
  });
});

export const joinRoom = spacetimedb.reducer(
  { code: t.string(), name: t.string() },
  (ctx, { code: raw, name: rawName }) => {
    const code = cleanCode(raw);
    const room = ctx.db.room.code.find(code);
    if (!room) throw new SenderError(`no room with code ${code}`);
    const name = rawName.trim().slice(0, 16) || 'Pilot';

    const here = [...ctx.db.player.room_code.filter(code)];
    const existing = ctx.db.player.identity.find(ctx.sender);
    const already = existing && existing.room_code === code;
    if (!already && here.filter(p => p.connected).length >= MAX_PILOTS) {
      throw new SenderError('this room is full (6 pilots)');
    }

    // One identity is one player row: a reconnect or a move between rooms.
    if (existing) {
      if (!already) cutTethers(ctx, existing.room_code);
      const taken = new Set(here.filter(p => !p.identity.isEqual(ctx.sender)).map(p => p.color));
      const color = already ? existing.color : COLORS.find(c => !taken.has(c)) ?? COLORS[0];
      ctx.db.player.identity.update({ ...existing, room_code: code, name, color, connected: true });
    } else {
      const taken = new Set(here.map(p => p.color));
      ctx.db.player.insert({
        identity: ctx.sender,
        room_code: code,
        name,
        color: COLORS.find(c => !taken.has(c)) ?? COLORS[0],
        connected: true,
        joined_at: ctx.timestamp,
      });
    }

    const ship = ctx.db.ship.identity.find(ctx.sender);
    if (!ship || ship.room_code !== code) spawnShip(ctx, code);
  }
);

export const setName = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) return;
  ctx.db.player.identity.update({ ...player, name: name.trim().slice(0, 16) || player.name });
});

export const leaveRoom = spacetimedb.reducer(ctx => {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (!player) return;
  cutTethers(ctx, player.room_code);
  ctx.db.ship.identity.delete(ctx.sender);
  ctx.db.player.identity.delete(ctx.sender);
});
