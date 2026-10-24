// The rescue ship as clean voxels, to match the characters: a boxy hull with
// a stepped nose, a glass cockpit block, swept slab wings, two chunky engines
// and a tail fin, the pilot's colour on the wings. Built in code, meshed as
// exposed faces with a little baked shade. Nose points -Z.

import * as THREE from 'three';

const V = 0.12; // units per voxel
type Cell = string; // '#rrggbb'

class Grid {
  cells = new Map<string, Cell>();
  set(x: number, y: number, z: number, c: Cell) { this.cells.set(`${x},${y},${z}`, c); }
  has(x: number, y: number, z: number) { return this.cells.has(`${x},${y},${z}`); }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: Cell | ((x: number, y: number, z: number) => Cell)) {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) this.set(x, y, z, typeof c === 'string' ? c : c(x, y, z));
  }
}

const HULL = '#c9ced6', HULL2 = '#b4bac4', DARK = '#3a3f4a', DARKER = '#22262e', GLASS = '#3d8fc4', GLASS2 = '#6cc3ef', NOZZLE = '#1a1d22';

function design(color: string): Grid {
  const g = new Grid();
  const panel = (x: number, _y: number, z: number) => ((Math.floor(z / 4) + Math.floor(Math.abs(x) / 3)) % 2 ? HULL : HULL2);
  // fuselage, stepping in toward the nose
  for (let z = -22; z < 18; z++) {
    const taper = z < -12 ? Math.ceil((-12 - z) / 2.5) : 0;
    const w = 5 - taper, top = 6 - Math.max(0, taper - 1);
    if (w <= 0 || top <= 1) continue;
    g.box(-w, w, Math.min(taper, 2), top, z, z + 1, panel);
  }
  // cockpit glass block with a frame line
  g.box(-3, 3, 6, 9, -13, -4, (_x, y, z) => (y === 8 && z % 3 === 0 ? DARK : z < -10 ? GLASS2 : GLASS));
  g.box(-3, 3, 6, 8, -4, -2, DARK);
  // spine and fin
  g.box(-1, 1, 6, 8, -2, 16, HULL2);
  for (let z = 8; z < 18; z++) { const h = 8 + Math.min(5, Math.floor((z - 8) * 0.7)); g.box(-1, 1, 8, h, z, z + 1, DARK); }
  // swept wings: a thin slab, leading edge sweeping back
  for (let x = 5; x < 20; x++) {
    const z0 = 1 + Math.floor((x - 5) * 0.55), z1 = 14;
    for (const s of [1, -1]) {
      const xx = s > 0 ? x : -x - 1;
      g.box(xx, xx + 1, 1, 3, z0, z1, (_x, y, z) => {
        const stripe = y === 2 && x >= 8 && x < 17 && z >= z0 + 2 && z < z0 + 4;
        return stripe ? color : (z === z1 - 1 ? DARK : panel(xx, y, z));
      });
    }
  }
  // wingtip pods with a nav light slot
  for (const s of [1, -1]) {
    const x0 = s > 0 ? 18 : -21;
    g.box(x0, x0 + 3, 0, 4, 8, 15, DARK);
    g.box(x0, x0 + 3, 4, 5, 9, 14, color);
  }
  // engines
  for (const s of [1, -1]) {
    const x0 = s > 0 ? 4 : -10;
    g.box(x0, x0 + 6, 0, 6, 8, 21, (_x, y, z) => (z === 8 || y === 5 ? DARKER : DARK));
    g.box(x0 + 1, x0 + 5, 1, 5, 21, 22, NOZZLE);
  }
  // a colour band round the hull behind the cockpit
  g.box(-5, 5, 2, 6, 0, 2, color);
  return g;
}

const FACES: [number, number, number, number[][]][] = [
  [1, 0, 0, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [-1, 0, 0, [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
  [0, 1, 0, [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [0, 0, 1, [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]],
  [0, 0, -1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

const cache = new Map<string, THREE.BufferGeometry>();

/** The ship's mesh geometry for a pilot colour (cached). Centred, nose -Z. */
export function shipGeometry(color: string): THREE.BufferGeometry {
  const hit = cache.get(color);
  if (hit) return hit;
  const g = design(color);
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  const c = new THREE.Color();
  for (const [key, hex] of g.cells) {
    const [x, y, z] = key.split(',').map(Number);
    c.set(hex).convertSRGBToLinear();
    for (const [dx, dy, dz, quad] of FACES) {
      if (g.has(x + dx, y + dy, z + dz)) continue;
      const shade = dy > 0 ? 1 : dy < 0 ? 0.55 : dx !== 0 ? 0.82 : 0.9;
      const vs = quad.map(([qx, qy, qz]) => [(x + qx) * V, (y + qy - 3) * V, (z + qz) * V]);
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(...vs[k]);
        col.push(c.r * shade, c.g * shade, c.b * shade);
        nor.push(dx, dy, dz);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  cache.set(color, geo);
  return geo;
}

/** Where the two nozzles are, in ship units (for the engine flames). */
export const NOZZLES: [number, number, number][] = [[7 * V, 0, 22 * V], [-7 * V, 0, 22 * V]];
export const WINGTIPS: [number, number, number][] = [[19.5 * V, 0.2, 11 * V], [-19.5 * V, 0.2, 11 * V]];
