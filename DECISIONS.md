# Decisions

Choices made where the build prompt (v3, 24 Oct 2026) left room, or where we
deliberately simplified. Newest at the bottom of each section.

## Database (hacky-space on Maincloud)

- The shell existed before v3, so v3 was added as an **append-only migration**
  (no data wiped). `crew` gained `is_einstein, air, air_ms, px, py, pz, moved`;
  `run` gained `pod_air_s`. `run.countdown_s` is kept but unused: there is no
  global countdown.
- Column names differ slightly from the prompt's table (e.g. crew `id` is a u32
  autoInc, not "room:index"; crew status `waiting|towed|home|lost`; positions in
  crew rows). Same meaning, and renaming live columns would need a wipe.
- Crew sites are placed **by the server** (`rules.ts planCrew`) and stored in
  the crew rows, instead of every client deriving them from the seed. One
  source of truth; clients still derive every POI structure and all filler from
  the seed with `hash3`.
- `crew.x,y,z` is always the rescue SITE (so every client can rebuild the POI);
  `px,py,pz` is where the pod actually is once it has moved (`moved = true`).
- Pod air: `air` is valid at `air_ms` (server ms). While waiting, every client
  computes `air - rate_at_pod * (now - air_ms)` with no sync. While towed, the
  lead tower integrates it on their own clock and reports it with the pod's
  position at 4 Hz (`reportPod`). The runaway pod's air is integrated over its
  slowing flight (`runawayTau`).
- `loseCrew` trusts the caller (the air math is deterministic on every client,
  first call wins). The server does not re-derive pod air.
- A pod that falls into a horizon with its tower is **lost** (as in the prompt).
- The run ends server-side the moment every crewmate is home or lost
  (`checkEnd`). Win = Einstein home + at least one other. Clients play the
  ending from `run.ended_at`.
- Reducer names: `backToLobby` is Play Again (host only); `respawn` covers
  solo blackout and horizon; `syncShip` is updateShip. `setDark` is just
  `syncShip` with status `dark`.
- `npm run pub` publishes with `--yes=remote,break-clients --delete-data=never`:
  it can change reducers but can never wipe data. A bare `--yes` would have
  approved a wipe without asking.

## Physics numbers (starting values; see client/src/game/constants.ts)

- C = 40, THRUST = 20 on proper velocity, boost x2, oxygen 180 s own-clock,
  pod air 120 s own-clock.
- Black holes: pull `gm / (r - rs)^2`, gm chosen so hovering at the pod depth
  needs 80% of boost thrust (`holeGm`). Crew pods at 1.15 rs (rate 0.36),
  two-ship pods at 1.08 rs, Einstein at 1.05 rs of the biggest hole (rate 0.22).
- Clock rate is the product of the two deepest wells' `sqrt(1 - clockRs/r)`
  times `sqrt(1 - v^2/C^2)`, each clamped at 0.02. Stars have a small clockRs
  so ordinary stars barely slow clocks; black holes use rs.
- Gravity changes proper velocity (so a slingshot really adds speed, and you
  still never pass C).
- Dark matter pull `gm / (r^2 + core^2)` (soft, extended). Nebula drag up to
  ~0.56/s at the centre.
- Wormhole: the exit mouth sits 1400 units out beside an invisible heavy mass
  (clock rate ~0.5–0.6 near the pod), so a trip through costs more world time
  than you feel.
- Runaway pod: launched at 0.7 c, its speed falls with a time constant of 80 s
  (so it is catchable at all).
- Pulsar: period 1.5–3 s, beams 10 degrees, 650 units long; the visual beams
  and the hit test share one function (`relativity/hazards.ts`).
- Chunk streaming: load out to radius 3 (radius 2 visible + one ahead ring),
  drop past radius 4 (one extra ring of hysteresis), 3 chunks per 0.1 s.
- Sites are reserved: no filler in the chunks around the centre, every POI, and
  no star or black hole within 450 units of the line from the centre to any
  black-hole POI.

## Flight and controls

- Desktop: mouse (pointer lock) or arrows/A-D steer, W or Space thrust, Shift
  boost, S brake, hold E near a pod to tether, tap E to let go.
- Phone: floating stick on the left 45% (yaw/pitch rate), drag right to look,
  FOUR buttons (thrust, boost, brake, tether). The prompt said three; boost got
  its own button because there is no Shift on a phone.
- Auto-level roll toward system up. Towing: turning and thrust x0.6.
- Two-ship pods: with one tether the pod will not move and the tether is a
  60-unit leash. Anchor dive (black hole): with two tethers the pod reels toward
  the midpoint only while both ships are nearly still. Heavy pod: it follows the
  midpoint only while the two ships are within 20 units of each other.
- Dark ship: solo respawn after 5 s; with teammates, wait for a tow, a respawn
  button after 10 s, automatic after 30 s.

## Rendering simplifications

- Black hole on phones: fewer integration steps (56) with longer steps instead
  of a baked LUT. Laptop: 200 steps.
- Wormhole: an analytic lens (impact parameter through the throat samples the
  other sky, outside it a 1/b^2 deflection) instead of integrating the James et
  al. 2015 metric.
- Sky A and sky B are two baked cubemaps from different seeds; the far sky is
  location independent (it is at infinity), so it is not re-baked by galaxy
  cell yet.
- Aberration is applied to the mid-layer star points (vertex shader), not yet
  to the baked backdrop.
- Exposure is not animated in the tone mapper; whiteouts and pulsar flashes are
  a screen overlay instead.
- Intro skip (host, after the first run) only skips the cinematic on the host's
  own screen; nobody can fly before the intro's server time ends anyway.

## Art

- Einstein portraits were provided as generated paintings; stored compressed as
  `client/public/einstein-comms.jpg` and `einstein-ending.jpg`. Note: the chest
  badge resembles a well-known TV franchise's insignia; regenerate before any
  public launch.

## Juan's direction, 24 Oct afternoon

- **Compact system, key phenomena only.** Rescue sites are black hole, dark
  matter, pulsar and wormhole (slingshot and runaway pod dropped from the
  plan). Sites sit 700 to 2300 units from home. No filler phenomena: open space
  is empty apart from a few planets near home.
- **Crew names** in order: Kai, Mia, Jay, Parth, Ninjago, then Zara, Leo, Ana,
  Sam, Rio, Tess, Omar.
- **Voxel art.** Einstein is a custom voxel character made with Hacky's
  character generator (about $0.15 in model calls), the detail parts
  (moustache, wild hair) hand-placed afterwards; the crew are Hacky's four
  astronauts. The rescue ship is a hand-built voxel model in code
  (`render/voxelShip.ts`).
- **No relativistic tint on other ships** (Juan: it looked weird). Doppler
  still shifts the star temperatures in the backdrop.
- **Two views**: driving (chase camera) and cockpit (V / COCKPIT button), with
  Einstein as a live hologram on the dashboard. Einstein stays the last rescue
  in the story; the hologram is his radio link from the pod.
- **Interiors**: the opening, every reunion and the ending happen on the
  mothership's bridge with the characters.
- **Feeling the pull**: the chase camera is dragged toward whatever pulls you,
  your ship stretches toward a black hole, a red chevron shows the pull, a
  green chevron shows the escape heading (out and sideways), phones that
  support it vibrate.
- **Clocks**: two analog dials, you vs the mothership (or the nearest pod),
  in the HUD and on the cockpit dashboard.
- **First arrival** at each phenomenon plays a 5.5 s orbit shot with an
  Einstein line.
- **Hosting**: Azure Static Web App `hacky-space` (Free tier) in the new
  resource group `hacky-space-rg`, https://witty-bay-06cc0cb0f.6.azurestaticapps.net.
  The Azure CLI on this Mac was signed in as rajesh@askberean.com
  ("Microsoft Azure Sponsorship"); the resources were created there.
