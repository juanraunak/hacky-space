// Axis-aligned boxes merged into one vertex-coloured mesh, with the same baked
// per-face shade as the voxel characters and the rescue ship (tops brightest,
// undersides darkest). Rooms and props built from a few big boxes this way
// read as clean voxels at one draw call, without a grid of tiny cubes.

import * as THREE from 'three';

const FACES: [number, number, number, number[][]][] = [
  [1, 0, 0, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [-1, 0, 0, [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
  [0, 1, 0, [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [0, 0, 1, [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]],
  [0, 0, -1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

const shadeOf = (dx: number, dy: number) => (dy > 0 ? 1 : dy < 0 ? 0.6 : dx !== 0 ? 0.85 : 0.92);

export class Boxes {
  private pos: number[] = [];
  private col: number[] = [];
  private nor: number[] = [];
  private c = new THREE.Color();
  /** `bake` false for glow geometry: every face keeps its full colour. */
  constructor(private bake = true) {}

  /** One box from (x0, y0, z0) to (x1, y1, z1). `k` scales the colour (above 1 for HDR glow). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, k = 1) {
    this.c.set(color);
    const { r, g, b } = this.c;
    for (const [dx, dy, dz, quad] of FACES) {
      const s = (this.bake ? shadeOf(dx, dy) : 1) * k;
      const vs = quad.map(([qx, qy, qz]) => [qx ? x1 : x0, qy ? y1 : y0, qz ? z1 : z0]);
      for (const i of [0, 1, 2, 0, 2, 3]) {
        this.pos.push(...vs[i]);
        this.col.push(r * s, g * s, b * s);
        this.nor.push(dx, dy, dz);
      }
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.computeBoundingSphere();
    return geo;
  }
}
