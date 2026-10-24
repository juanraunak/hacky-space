import { schema, table, t } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx } from 'spacetimedb/server';

// Every table lives here and this file imports nothing of ours. Tables beside
// their reducers make an import cycle that crashes at runtime ("Cannot access
// 'spacetimedb' before initialization") while `spacetime build` says SUCCESS.
//
// APPEND ONLY. Never retype, rename or reorder a column: that needs
// `publish -c`, which wipes every live room. New columns go at the end of a
// table with `.default(...)`, or into a new table.
//
// Positions are f64. A ship 3,000 units out in f32 moves in visible steps, and
// the universe is endless.
const spacetimedb = schema({
  // One row per room. Every client renders purely from `phase`.
  room: table(
    { public: true },
    {
      code: t.string().primaryKey(),
      host: t.identity(),
      // lobby | intro | playing | won | lost
      phase: t.string(),
      created_at: t.timestamp(),
    }
  ),

  // One row per identity, ever. Nothing is deleted on disconnect.
  player: table(
    { public: true },
    {
      identity: t.identity().primaryKey(),
      room_code: t.string().index('btree'),
      name: t.string(),
      color: t.string(),
      connected: t.bool(),
      joined_at: t.timestamp(),
    }
  ),

  // The pilot's ship. Client authoritative, written at 10 Hz when it changed.
  // tau is the pilot's own proper time in seconds, integrated on their phone.
  ship: table(
    { public: true },
    {
      identity: t.identity().primaryKey(),
      room_code: t.string().index('btree'),
      x: t.f64(),
      y: t.f64(),
      z: t.f64(),
      qx: t.f32(),
      qy: t.f32(),
      qz: t.f32(),
      qw: t.f32(),
      vx: t.f64(),
      vy: t.f64(),
      vz: t.f64(),
      tau: t.f64(),
      oxygen: t.f32(),
      hull: t.u32(),
      // flying | dark | home
      status: t.string(),
      updated_at: t.timestamp(),
    }
  ),

  // One run per room at a time. The countdown is derived from started_at, so
  // the server needs no ticking loop. started_at is when the intro ends.
  run: table(
    { public: true },
    {
      room_code: t.string().primaryKey(),
      seed: t.u32(),
      intro_at: t.timestamp(),
      started_at: t.timestamp(),
      countdown_s: t.u32(),
      pilots: t.u32(),
      crew_count: t.u32(),
      // '' while playing | won | lost
      result: t.string(),
      ended_at: t.timestamp(),
      // --- v3, appended --- every pod's starting air, own-clock seconds.
      // countdown_s above is unused since v3: there is no global countdown.
      pod_air_s: t.u32().default(120),
    }
  ),

  // Each lost crewmate. x,y,z is the rescue site; vx,vy,vz is the drift of a
  // runaway pod (zero for the rest). tau is the crewmate's clock when docked.
  crew: table(
    { public: true },
    {
      id: t.u32().primaryKey().autoInc(),
      room_code: t.string().index('btree'),
      slot: t.u32(),
      name: t.string(),
      // black_hole | dark_matter | slingshot | pulsar | wormhole | runaway
      poi: t.string(),
      // needs two ships: anchor dive (black hole) or heavy pod
      two_ship: t.bool(),
      x: t.f64(),
      y: t.f64(),
      z: t.f64(),
      vx: t.f64(),
      vy: t.f64(),
      vz: t.f64(),
      // waiting | towed | home | lost (lost = air ran out or fell in)
      status: t.string(),
      towed_by: t.identity(),
      tau: t.f64(),
      home_at: t.timestamp(),
      // the pilot's own clock at docking, for the reunion bubble
      pilot_tau: t.f64(),
      // --- v3, appended ---
      // the chief scientist: the last, deepest rescue
      is_einstein: t.bool().default(false),
      // pod air (own-clock seconds) as of air_ms (server epoch ms). While a pod
      // waits, every client drains it at the pod's local clock rate.
      air: t.f32().default(0),
      air_ms: t.f64().default(0),
      // where the pod actually is once it has been towed (moved = true).
      // x,y,z above stays the rescue SITE so every client can rebuild the POI.
      px: t.f64().default(0),
      py: t.f64().default(0),
      pz: t.f64().default(0),
      moved: t.bool().default(false),
    }
  ),

  // Who is towing what. target_kind 'crew' uses target_crew, 'ship' uses
  // target_ship (a dark teammate). A two-ship pod takes two rows.
  tether: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      room_code: t.string().index('btree'),
      owner: t.identity(),
      target_kind: t.string(),
      target_crew: t.u32(),
      target_ship: t.identity(),
      since: t.timestamp(),
    }
  ),

  // One-shot shared moments, inserted at most once per (room, name).
  room_event: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      room_code: t.string().index('btree'),
      name: t.string(),
      fired_by: t.identity(),
      fired_at: t.timestamp(),
    }
  ),
});
export default spacetimedb;

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
