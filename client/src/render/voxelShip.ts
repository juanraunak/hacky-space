// The rescue ship as simple, clean voxels, to match the characters. Few
// colours: a light grey hull with a darker trim (belly, intakes, nozzle caps,
// nose tip), the pilot's colour as one bold accent (wing stripes and the fin
// cap), and a glass cockpit block. Built in code, greedy-meshed.
//
// Ship space: nose -Z, up +Y, starboard +X. One voxel = SHIP_VOXEL units and
// cell (x, y, z) fills [x, x+1) * SHIP_VOXEL, so the design is symmetric about
// x = 0. About 4.8 units long (z -2.4 .. +2.4) and 5.2 wide at the wingtips.
// The cockpit eye (0, 0.42, -0.62) sits inside the glass block.
//
// Seen from the chase camera (behind and above): a central hull, deck, canopy
// and fin, two square nacelles with glowing nozzles either side, and thin
// swept wings with the stripes and blinking tip lights.

import * as THREE from 'three';
import { VoxelGrid, greedyMesh } from './voxelMesh';

export const SHIP_VOXEL = 0.2;
const V = SHIP_VOXEL;

const HULL = 1, TRIM = 2, GLASS = 3, ACCENT = 4;
const HULL_HEX = '#d8dce3', TRIM_HEX = '#565d6a', GLASS_HEX = '#62b6e8';

function design(): VoxelGrid {
  const g = new VoxelGrid(-13, 13, -2, 5, -12, 12);

  // Fuselage, stepping down toward the nose.
  g.box(-3, 3, -2, 1, -6, 11, HULL);
  g.box(-2, 2, -2, 1, -9, -6, HULL);
  g.box(-1, 1, -2, 0, -11, -9, HULL);
  g.box(-1, 1, -1, 0, -12, -11, TRIM);
  g.paint(-3, 3, -2, -1, -12, 11, TRIM); // dark belly

  // Cockpit: a glass block with a stepped windscreen, a deck behind it.
  g.box(-2, 2, 1, 2, -7, -6, GLASS);
  g.box(-2, 2, 1, 3, -6, 0, GLASS);
  g.box(-2, 2, 1, 2, 0, 11, HULL);

  // A small stepped tail fin with the pilot's colour on its cap.
  g.box(-1, 1, 2, 3, 7, 11, HULL);
  g.box(-1, 1, 3, 4, 8, 11, HULL);
  g.box(-1, 1, 4, 5, 9, 11, ACCENT);

  // Starboard side (mirrored below): a nacelle on a short wing root, with a
  // dark intake, belly and nozzle cap.
  g.box(4, 7, -2, 1, 0, 12, HULL);
  g.paint(4, 7, -2, -1, 0, 12, TRIM);
  g.box(4, 7, -2, 1, 0, 1, TRIM);
  g.box(4, 7, -2, 1, 11, 12, TRIM);
  g.box(3, 4, -1, 0, 1, 10, HULL);

  // A swept slab wing: the leading edge steps back, the trailing edge is
  // straight. A bold two-voxel stripe of the pilot's colour across it.
  for (let x = 7; x < 13; x++) {
    const z0 = 2 + Math.floor((x - 7) * 0.8);
    g.box(x, x + 1, -1, 0, z0, 10, x === 9 || x === 10 ? ACCENT : HULL);
  }
  // A hole at the trailing wingtip, filled by ShipBody's nav lamp.
  g.set(12, -1, 9, 0);

  g.mirrorX();
  return g;
}

let grid: VoxelGrid | null = null;
const cache = new Map<string, THREE.BufferGeometry>();
let glass: THREE.BufferGeometry | null = null;

function palette(accent: string): THREE.Color[] {
  // THREE.Color parses hex as sRGB and stores linear (colour management on).
  const p: THREE.Color[] = [];
  p[HULL] = new THREE.Color(HULL_HEX);
  p[TRIM] = new THREE.Color(TRIM_HEX);
  p[GLASS] = new THREE.Color(GLASS_HEX);
  p[ACCENT] = new THREE.Color(accent);
  return p;
}

/** The ship's opaque body for a pilot colour (cached per colour). Centred, nose -Z. */
export function shipGeometry(color: string): THREE.BufferGeometry {
  const hit = cache.get(color);
  if (hit) return hit;
  grid ??= design();
  const geo = greedyMesh(grid, palette(color), V, id => id !== GLASS);
  cache.set(color, geo);
  return geo;
}

/** The cockpit glass block alone (same for every pilot; cached). Draw it with a glassy material. */
export function shipGlassGeometry(): THREE.BufferGeometry {
  if (glass) return glass;
  grid ??= design();
  glass = greedyMesh(grid, palette('#ffffff'), V, id => id === GLASS);
  return glass;
}

/** Centres of the two nozzle faces (rear faces of the nacelles), in ship units. */
export const NOZZLES: [number, number, number][] = [[5.5 * V, -0.5 * V, 12 * V], [-5.5 * V, -0.5 * V, 12 * V]];
/** Size of each square nozzle face. */
export const NOZZLE_FACE = 3 * V;
/** Centres of the nav-lamp holes: [0] starboard (+X, green), [1] port (-X, red). */
export const WINGTIPS: [number, number, number][] = [[12.5 * V, -0.5 * V, 9.5 * V], [-12.5 * V, -0.5 * V, 9.5 * V]];
