// The root of all randomness. Integer-only (Math.imul and shifts) so it is
// bit-identical on every JS engine and phone. Same shape as Hacky's hash2
// (kernel/stream/stream.ts:139), extended to three coordinates. Never
// Math.random for world content, never sin hashes.

/** A 32-bit hash of a seed and three whole numbers, to [0, 1). */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A small seeded PRNG, local to one cell. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;

export const rngFor = (seed: number, x: number, y: number, z: number): Rand =>
  mulberry32(Math.floor(hash3(seed, x, y, z) * 4294967296));

export const range = (r: Rand, a: number, b: number) => a + (b - a) * r();
