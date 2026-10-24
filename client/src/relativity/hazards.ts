// Time-dependent hazards, shared by the game loop and the renderer so what
// you see is exactly what hits you.
import type { Body, Vec } from '../universe/bodies';
import { cross, norm, dot, sub, len } from '../universe/bodies';

export const BEAM_HALF_ANGLE = 0.17; // rad
export const BEAM_LENGTH = 650;

/** The pulsar's magnetic axis at world time t. Its two beams point along +/- this. */
export function pulsarAxis(b: Body, t: number): Vec {
  const s = b.spinAxis;
  const ref = Math.abs(s.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const e1 = norm(cross(s, ref));
  const e2 = cross(s, e1);
  const a = (t / b.period) * Math.PI * 2;
  const c = Math.cos(b.beamTilt), sn = Math.sin(b.beamTilt);
  return norm({
    x: s.x * c + (e1.x * Math.cos(a) + e2.x * Math.sin(a)) * sn,
    y: s.y * c + (e1.y * Math.cos(a) + e2.y * Math.sin(a)) * sn,
    z: s.z * c + (e1.z * Math.cos(a) + e2.z * Math.sin(a)) * sn,
  });
}

/** 0..1: how squarely a pulsar beam is on point p (1 = dead centre). */
export function beamOn(b: Body, p: Vec, t: number): number {
  const d = sub(p, b);
  const r = len(d);
  if (r > BEAM_LENGTH || r < 1) return 0;
  const m = pulsarAxis(b, t);
  const c = Math.abs(dot(d, m)) / r;
  const ang = Math.acos(Math.min(1, c));
  return ang < BEAM_HALF_ANGLE ? 1 - ang / BEAM_HALF_ANGLE : 0;
}
