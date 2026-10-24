// Shared tools for voxel models built in code (the rescue ship, the
// mothership): a dense grid of palette ids and a greedy mesher. Only exposed
// faces are kept, and each run of same-colour faces in a plane is merged into
// the largest rectangles it can, so a flat panel is one quad: crisp edges, a
// low triangle count and nothing noisy.

import * as THREE from 'three';

/** A box of cells, each a palette id (0 = empty). Cell (x, y, z) fills [x, x+1) etc. */
export class VoxelGrid {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly cells: Uint8Array;

  /** Half-open bounds: cells x0 <= x < x1, and so on. Writes outside are ignored. */
  constructor(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    this.x0 = x0; this.y0 = y0; this.z0 = z0;
    this.nx = x1 - x0; this.ny = y1 - y0; this.nz = z1 - z0;
    this.cells = new Uint8Array(this.nx * this.ny * this.nz);
  }

  private index(x: number, y: number, z: number): number {
    const i = x - this.x0, j = y - this.y0, k = z - this.z0;
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
    return (k * this.ny + j) * this.nx + i;
  }

  get(x: number, y: number, z: number): number {
    const i = this.index(x, y, z);
    return i < 0 ? 0 : this.cells[i];
  }

  set(x: number, y: number, z: number, id: number) {
    const i = this.index(x, y, z);
    if (i >= 0) this.cells[i] = id;
  }

  /** Fill a half-open box with an id (0 carves). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, id: number) {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, id);
  }

  /** Recolour only the cells that are already filled inside a half-open box. */
  paint(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, id: number) {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (this.get(x, y, z)) this.set(x, y, z, id);
  }

  /** Copy the x >= 0 half onto the x < 0 half (cell x lands on -x - 1), holes included. */
  mirrorX() {
    for (let z = this.z0; z < this.z0 + this.nz; z++) for (let y = this.y0; y < this.y0 + this.ny; y++)
      for (let x = 0; x < this.x0 + this.nx; x++) this.set(-x - 1, y, z, this.get(x, y, z));
  }
}

/** Baked per-direction shade, so the form reads even when the light is behind it. */
function shadeFor(d: number, sign: number) {
  if (d === 1) return sign > 0 ? 1 : 0.6;
  return d === 0 ? 0.84 : 0.92;
}

/**
 * Mesh the exposed faces of the cells whose id passes `include`, merged
 * greedily. Every filled cell (included or not) hides the faces it touches,
 * so two meshes built from one grid with different filters fit together with
 * no hidden faces. `colors[id]` is a linear colour; `shade` bakes a gentle
 * per-direction shade into the vertex colours. Positions are cell * scale.
 */
export function greedyMesh(
  g: VoxelGrid,
  colors: readonly (THREE.Color | undefined)[],
  scale: number,
  include: (id: number) => boolean,
  shade = true,
): THREE.BufferGeometry {
  const dims = [g.nx, g.ny, g.nz];
  const org = [g.x0, g.y0, g.z0];
  const { cells } = g;
  const at = (i: number, j: number, k: number) =>
    i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz ? 0 : cells[(k * g.ny + j) * g.nx + i];
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const q = [0, 0, 0];
  const corner = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const nu = dims[u], nv = dims[v];
    const masks = [new Uint8Array(nu * nv), new Uint8Array(nu * nv)]; // +d, -d
    for (let s = 0; s <= dims[d]; s++) {
      // The plane between cell s-1 and cell s along d.
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        q[u] = i; q[v] = j;
        q[d] = s - 1; const a = at(q[0], q[1], q[2]);
        q[d] = s; const b = at(q[0], q[1], q[2]);
        masks[0][i + j * nu] = a && !b && include(a) ? a : 0;
        masks[1][i + j * nu] = b && !a && include(b) ? b : 0;
      }
      for (let m = 0; m < 2; m++) {
        const mask = masks[m];
        const sign = m === 0 ? 1 : -1;
        const sh = shade ? shadeFor(d, sign) : 1;
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; ) {
          const id = mask[i + j * nu];
          if (!id) { i++; continue; }
          let w = 1;
          while (i + w < nu && mask[i + w + j * nu] === id) w++;
          let h = 1;
          grow: while (j + h < nv) {
            for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * nu] !== id) break grow;
            h++;
          }
          for (let jj = 0; jj < h; jj++) mask.fill(0, i + (j + jj) * nu, i + w + (j + jj) * nu);
          // Corners A (i, j), B (i+w, j), C (i+w, j+h), D (i, j+h): counter-
          // clockwise seen from +d, because (d, u, v) is a cyclic x, y, z.
          const base = pos.length / 3;
          const c = colors[id];
          const r = (c?.r ?? 1) * sh, gg = (c?.g ?? 0) * sh, bb = (c?.b ?? 1) * sh;
          for (let n = 0; n < 4; n++) {
            corner[d] = s;
            corner[u] = i + (n === 1 || n === 2 ? w : 0);
            corner[v] = j + (n >= 2 ? h : 0);
            pos.push((corner[0] + org[0]) * scale, (corner[1] + org[1]) * scale, (corner[2] + org[2]) * scale);
            nor.push(d === 0 ? sign : 0, d === 1 ? sign : 0, d === 2 ? sign : 0);
            col.push(r, gg, bb);
          }
          if (sign > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
          i += w;
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
