// Floating origin. Authoritative positions are float64 JS numbers; the GPU
// only ever sees (position - origin), so nothing jitters however far you fly.
// The origin jumps to the camera when the camera is RECENTER units away.

import type { Object3D } from 'three';
import { RECENTER } from '../game/constants';
import type { Vec } from '../universe/bodies';

export const origin = { x: 0, y: 0, z: 0, version: 0 };

/** The camera's true (float64) position, written by the camera rig. */
export const camWorld = { x: 0, y: 0, z: 0 };

export function maybeRecenter() {
  const dx = camWorld.x - origin.x, dy = camWorld.y - origin.y, dz = camWorld.z - origin.z;
  if (dx * dx + dy * dy + dz * dz > RECENTER * RECENTER) {
    origin.x = Math.round(camWorld.x);
    origin.y = Math.round(camWorld.y);
    origin.z = Math.round(camWorld.z);
    origin.version++;
  }
}

/** Place a three object at a float64 world position. */
export function place(o: Object3D, p: Vec) {
  o.position.set(p.x - origin.x, p.y - origin.y, p.z - origin.z);
}

export const rel = (p: Vec) => [p.x - origin.x, p.y - origin.y, p.z - origin.z] as const;
