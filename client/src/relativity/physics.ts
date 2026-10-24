// The laws, as plain functions. Every effect points the right way and has the
// right shape; the numbers are game-scale. Nothing here draws.

import { C, MAX_ACCEL } from '../game/constants';
import type { Body, Vec } from '../universe/bodies';

export interface Field {
  ax: number; ay: number; az: number; // gravity, units/s^2
  gravRate: number; // clock factor from the two deepest wells
  drag: number; // nebula drag per second
  horizon: Body | null; // inside a horizon: gone
  danger: number; // 0..1, how close to a horizon (for the red edge glow)
  deepest: Body | null;
  deepestR: number;
  inDark: Body | null;
  heat: Body | null; // too close to a star
}

/**
 * Pull: a = gm / (r - rs)^2 toward each body (Paczynski-Wiita for black
 * holes, which gets the unstable inner orbit right). Extended masses (dark
 * matter, nebulae) use gm / (r^2 + core^2). Inside a star the pull falls off
 * linearly so nothing blows up.
 */
export function field(p: Vec, bodies: Body[]): Field {
  let ax = 0, ay = 0, az = 0, drag = 0, danger = 0;
  let horizon: Body | null = null, inDark: Body | null = null, heat: Body | null = null;
  const rates: { f: number; b: Body; r: number }[] = [];
  for (const b of bodies) {
    const dx = b.x - p.x, dy = b.y - p.y, dz = b.z - p.z;
    const r = Math.hypot(dx, dy, dz) || 1e-6;
    let a = 0;
    if (b.kind === 'black_hole') {
      if (r <= b.rs) horizon = b;
      const gap = Math.max(r - b.rs, b.rs * 0.01);
      a = b.gm / (gap * gap);
      danger = Math.max(danger, 1 - Math.min(1, (r - b.rs) / (b.rs * 0.6)));
    } else if (b.kind === 'dark_matter' || b.kind === 'exit_well') {
      a = b.gm / (r * r + b.core * b.core);
      if (b.kind === 'dark_matter' && r < b.radius) inDark = b;
    } else if (b.kind === 'nebula') {
      if (r < b.radius) drag = Math.max(drag, b.drag * (1 - r / b.radius) * 1.6);
    } else if (b.gm > 0) {
      a = r > b.radius ? b.gm / (r * r) : (b.gm * r) / (b.radius * b.radius * b.radius);
      if ((b.kind === 'star' || b.kind === 'sun') && r < b.radius * 1.3) heat = b;
    }
    if (a > 0) {
      a = Math.min(a, MAX_ACCEL);
      ax += (dx / r) * a; ay += (dy / r) * a; az += (dz / r) * a;
    }
    if (b.clockRs > 0) rates.push({ f: Math.sqrt(Math.max(0.02, 1 - b.clockRs / Math.max(r, b.clockRs * 1.0001))), b, r });
  }
  rates.sort((a, b) => a.f - b.f);
  const gravRate = (rates[0]?.f ?? 1) * (rates[1]?.f ?? 1);
  return { ax, ay, az, gravRate, drag, horizon, danger, deepest: rates[0]?.b ?? null, deepestR: rates[0]?.r ?? Infinity, inDark, heat };
}

/** dtau/dt for a clock moving at `speed` in this field. */
export function clockRate(gravRate: number, speed: number): number {
  const b = speed / C;
  return gravRate * Math.sqrt(Math.max(0.02, 1 - b * b));
}

/** Real velocity from proper velocity u: v = u / sqrt(1 + |u|^2 / C^2). Never reaches C. */
export function velocityFromProper(u: Vec): Vec {
  const k = 1 / Math.sqrt(1 + (u.x * u.x + u.y * u.y + u.z * u.z) / (C * C));
  return { x: u.x * k, y: u.y * k, z: u.z * k };
}

/** Relativistic Doppler factor for a closing speed (positive = approaching). */
export function doppler(closing: number): number {
  const b = Math.max(-0.95, Math.min(0.95, closing / C));
  return Math.sqrt((1 + b) / (1 - b));
}
