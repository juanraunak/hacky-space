# Hacky Space

Co-op multiplayer space rescue that teaches general relativity through play.
Design: [docs/DESIGN.md](docs/DESIGN.md). Choices: [DECISIONS.md](DECISIONS.md).

**Live:** https://witty-bay-06cc0cb0f.6.azurestaticapps.net (deploys on every push to `main`).

Host a room, friends scan the QR, everyone flies a voxel rescue ship to bring
the crew home from a black hole, a dark matter cloud, a pulsar and a
wormhole, with Einstein on the radio. Every pod's air runs on its own clock.

## Run it

```bash
npm --prefix client install
npm run dev            # http://localhost:5173, add ?debug to see every table live
```

In dev, `window.__net` is the net module, so you can call any reducer from the
console (`__net.startRun()`, `__net.ships()`, ...).

## Layout

```
module/spacetimedb/src/
  schema.ts     ALL tables. Imports nothing of ours. APPEND-ONLY columns.
  rules.ts      server game numbers + crew layout (pure)
  helpers.ts    plain helpers (NOT re-exported: index may only export reducers)
  rooms.ts      createRoom, joinRoom, setName, leaveRoom, connect hooks
  run.ts        startRun, beginPlay, timeUp, backToLobby, claimHost
  flight.ts     syncShip, tetherCrew, tetherShip, releaseTether, dockCrew,
                podLost, dropTethers, fireEvent
  index.ts      export * from every reducer file + default schema
client/src/
  net/          THE ONLY importer of the SpacetimeDB SDK. One socket, one store.
  module_bindings/   generated, committed. Never edit.
  lobby/        lobby screen, QR, ?debug table view
  game/         constants.ts (mirror of rules.ts). The game goes here.
  routing.ts    "/" host, "/r/CODE" room
```

Database: `hacky-space` on Maincloud, owned by Juan's SpacetimeDB login.

## Tables

| Table | Holds |
| --- | --- |
| room | code, host, phase (lobby, intro, playing, won, lost) |
| player | identity, room, name, colour, connected |
| ship | f64 position, quaternion, f64 velocity, tau (own clock), oxygen, hull, status (flying, dark, home) |
| run | seed, intro/start times, countdown, pilots, crew count, result |
| crew | rescue site (f64), POI kind, two-ship flag, runaway drift, status (lost, towed, home), clocks at docking |
| tether | who tows which pod or dark ship (a two-ship pod takes two rows) |
| room_event | one-shot shared moments, inserted once per (room, name) |

The countdown comes from `run.started_at`, so the server has no tick loop.
Use `net.now()` (server-corrected clock) for anything timed.

## Rules that will bite you

1. **Publish only with `npm run pub`.** It publishes, regenerates bindings and
   stages only `client/src/module_bindings`. It refuses to wipe data.
2. **Append-only columns.** Retyping, renaming or reordering a column needs a
   data wipe. Add new columns at the end with `.default(...)`, or a new table.
3. **Every new reducer file must be `export *`-ed from `index.ts`**, or its
   reducers silently vanish. Check with `npm run describe`.
4. **Only reducers, hooks and the schema may be exported** from reducer files.
   Plain functions go in `helpers.ts`, or the module fails to load.
5. **Game code never imports `spacetimedb` or `module_bindings`.** Add a wrapper
   to `client/src/net/index.ts` instead.
6. **Positions are f64 everywhere.** The game needs a floating origin for
   rendering (float32 on the GPU).
