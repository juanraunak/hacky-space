// Shared game numbers. The server keeps the ones it needs in
// module/spacetimedb/src/rules.ts; change both together.
// Final tuned values are recorded in DECISIONS.md.

export const C = 90; // light speed, units per second (Juan: faster. The server never uses it.)
export const CHUNK = 400; // universe chunk size, units
export const INTRO_S = 30;
export const MAX_PILOTS = 6;
export const MOTHERSHIP = { x: 0, y: 0, z: 260 };
export const DOCK_RADIUS = 22; // fly within this of the dock ring to deliver
export const DOCK_OFFSET = { x: 34, y: 0, z: 20 }; // dock ring centre from the mothership, clear of the hull

// The dying star at the centre.
export const SUN = { radius: 70, gm: 90000, clockRs: 4, temp: 3300 };

// Ship
export const OXYGEN_S = 180; // own-clock seconds of air
export const THRUST = 32; // proper-velocity units/s^2
export const BOOST = 2.5;
export const BRAKE_K = 1.4; // exponential damping per second
export const TURN_RATE = 1.7; // rad/s at full stick
export const LOOK_RATE = 0.0032; // rad per pixel of drag / mouse
export const TOW_WEIGHT = 0.6; // turning and acceleration while towing
export const MAX_ACCEL = 400;

// Pods and rescues
export const POD_AIR = 120; // own-clock seconds
export const TETHER_RANGE = 6;
export const TETHER_HOLD_S = 2;
export const TETHER_LENGTH = 9; // single tow spring rest length
export const ANCHOR_TETHER = 60; // anchor-dive tether length
export const HEAVY_SPREAD = 20; // heavy pod: ships must stay this close
export const POD_REPORT_HZ = 4;

// Black holes: pod depth and hover thrust fraction
export const BH_POD_R = 1.15; // crew pod at 1.15 rs
export const EINSTEIN_POD_R = 1.05;
export const HOVER_FRACTION = 0.8; // of boost thrust, at the pod radius

// Hazards
export const PULSAR_PERIOD = [1.5, 3]; // seconds per turn
export const HEAT_RADIUS = 1.3; // x star radius
export const HEAT_INTERVAL = 3; // seconds per hull point

// Sync
export const SYNC_HZ = 10;
export const SYNC_MIN_MOVE = 0.05;
export const SYNC_MIN_TURN = 0.01;
export const SYNC_FORCE_S = 1;

// Floating origin
export const RECENTER = 2000;

// Every visual relativity effect scales with this (0..1). Never the physics.
export const PHYSICS_FX = 1;
