// Plain helpers shared by the reducer files. NOT re-exported from index.ts:
// the entry file may only export reducers, hooks and the schema.
import type { Ctx } from './schema';
import { CODE_LENGTH, MOTHERSHIP } from './rules';

export function cleanCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, CODE_LENGTH);
}

export const nowMs = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);

/** A fresh ship parked beside the mothership, a little apart from the others. */
export function spawnShip(ctx: Ctx, code: string, who = ctx.sender) {
  const a = ctx.random() * Math.PI * 2;
  const row = {
    identity: who,
    room_code: code,
    // beside the mothership, clear of its engines, the dying star ahead
    x: MOTHERSHIP.x + 55 + Math.cos(a) * 14,
    y: MOTHERSHIP.y + 8 + (ctx.random() * 2 - 1) * 4,
    z: MOTHERSHIP.z + 110 + Math.sin(a) * 14,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    tau: 0,
    oxygen: 100,
    hull: 3,
    status: 'flying',
    updated_at: ctx.timestamp,
  };
  const existing = ctx.db.ship.identity.find(who);
  if (existing) ctx.db.ship.identity.update(row);
  else ctx.db.ship.insert(row);
}

/** A towed pod whose last tether went is left waiting where it is. */
function settlePod(ctx: Ctx, code: string, crewId: number) {
  const crew = ctx.db.crew.id.find(crewId);
  if (!crew || crew.status !== 'towed') return;
  const still = [...ctx.db.tether.room_code.filter(code)].find(
    o => o.target_kind === 'crew' && o.target_crew === crewId
  );
  if (still) ctx.db.crew.id.update({ ...crew, towed_by: still.owner });
  else ctx.db.crew.id.update({ ...crew, status: 'waiting', vx: 0, vy: 0, vz: 0 });
}

/** Drop every tether the caller owns or is the target of. */
export function cutTethers(ctx: Ctx, code: string, who = ctx.sender) {
  for (const tie of [...ctx.db.tether.room_code.filter(code)]) {
    const mine = tie.owner.isEqual(who);
    const onMe = tie.target_kind === 'ship' && tie.target_ship.isEqual(who);
    if (!mine && !onMe) continue;
    ctx.db.tether.id.delete(tie.id);
    if (tie.target_kind === 'crew') settlePod(ctx, code, tie.target_crew);
  }
}

/** Cut every tether on one pod. */
export function cutPod(ctx: Ctx, code: string, crewId: number) {
  for (const tie of [...ctx.db.tether.room_code.filter(code)]) {
    if (tie.target_kind === 'crew' && tie.target_crew === crewId) ctx.db.tether.id.delete(tie.id);
  }
}

/**
 * The run ends when every crewmate is home or lost. A win is Einstein home
 * plus at least one other. Clients play the ending from run.ended_at.
 */
export function checkEnd(ctx: Ctx, code: string) {
  const crew = [...ctx.db.crew.room_code.filter(code)];
  if (crew.length === 0 || crew.some(c => c.status !== 'home' && c.status !== 'lost')) return;
  const room = ctx.db.room.code.find(code);
  const run = ctx.db.run.room_code.find(code);
  if (!room || !run || room.phase !== 'playing') return;
  const einstein = crew.find(c => c.is_einstein);
  const others = crew.filter(c => !c.is_einstein && c.status === 'home').length;
  // A full run needs Einstein home plus one other; a single level just needs its crewmate home.
  const won = einstein ? einstein.status === 'home' && others >= 1 : others >= 1;
  ctx.db.run.room_code.update({ ...run, result: won ? 'won' : 'lost', ended_at: ctx.timestamp });
  ctx.db.room.code.update({ ...room, phase: won ? 'won' : 'lost' });
}
