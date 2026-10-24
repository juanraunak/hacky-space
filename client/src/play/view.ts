// One view only (Juan): the spaceship view from behind. The cockpit view is
// gone; toggleView is kept as a no-op so old callers still compile.
export const view = { mode: 'chase' as 'chase' | 'cockpit' };
export function toggleView() { /* the spaceship view is the only view */ }
