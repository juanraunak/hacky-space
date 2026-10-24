// Plain helpers shared by the reducer files. NOT re-exported from index.ts:
// the entry file may only export reducers, hooks and the schema.
import type { Ctx } from './schema';
import { CODE_LENGTH, MOTHERSHIP } from './rules';

export function cleanCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, CODE_LENGTH);
}

/** A fresh ship parked beside the mothership, a little apart from the others. */
export function spawnShip(ctx: Ctx, code: string, who = ctx.sender) {
  const a = ctx.random() * Math.PI * 2;
  const row = {
    identity: who,
    room_code: code,
    x: MOTHERSHIP.x + Math.cos(a) * 30,
    y: MOTHERSHIP.y + (ctx.random() * 2 - 1) * 6,
    z: MOTHERSHIP.z + 40 + Math.sin(a) * 30,
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

/** Drop every tether the caller owns or is the target of. */
export function cutTethers(ctx: Ctx, code: string) {
  for (const tie of [...ctx.db.tether.room_code.filter(code)]) {
    const mine = tie.owner.isEqual(ctx.sender);
    const onMe = tie.target_kind === 'ship' && tie.target_ship.isEqual(ctx.sender);
    if (!mine && !onMe) continue;
    ctx.db.tether.id.delete(tie.id);
    if (tie.target_kind === 'crew') {
      const crew = ctx.db.crew.id.find(tie.target_crew);
      const others = [...ctx.db.tether.room_code.filter(code)].some(
        o => o.target_kind === 'crew' && o.target_crew === tie.target_crew
      );
      if (crew && crew.status === 'towed' && !others) {
        ctx.db.crew.id.update({ ...crew, status: 'lost' });
      }
    }
  }
}

/** Called inside dockCrew: everyone home means the mothership jumps. */
export function checkWin(ctx: Ctx, code: string) {
  const crew = [...ctx.db.crew.room_code.filter(code)];
  if (crew.length === 0 || crew.some(c => c.status !== 'home')) return;
  const room = ctx.db.room.code.find(code);
  const run = ctx.db.run.room_code.find(code);
  if (!room || !run || room.phase !== 'playing') return;
  ctx.db.run.room_code.update({ ...run, result: 'won', ended_at: ctx.timestamp });
  ctx.db.room.code.update({ ...room, phase: 'won' });
}

