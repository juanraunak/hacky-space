// Shared game numbers. The server keeps the ones it needs in
// module/spacetimedb/src/rules.ts; change both together.

export const C = 40; // light speed, units per second
export const CHUNK = 400; // universe chunk size, units
export const INTRO_S = 30;
export const COUNTDOWN_S = 600;
export const MAX_PILOTS = 6;
export const MOTHERSHIP = { x: 0, y: 0, z: 260 };

export const SYNC_HZ = 10; // pose sync rate
export const SYNC_MIN_MOVE = 0.05; // units; send only when the pose changed
export const SYNC_MIN_TURN = 0.01; // quaternion component delta

export const TETHER_RANGE = 6;
export const TETHER_HOLD_S = 2;
