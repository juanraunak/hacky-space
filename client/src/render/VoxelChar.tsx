// Voxel characters in Hacky's "hacky-voxel-char" file format (decoder adapted
// from Hacky's creator/look/format.ts): a grid of palette indices, an
// optional bone per cell, and a rig of bone pivots. We mesh only the exposed
// faces, one mesh per bone, so the rig can breathe, look and talk.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface VoxelBone { name: string; parent: number; pivot: [number, number, number] }
interface VoxelFile {
  format: 'hacky-voxel-char';
  dims: [number, number, number];
  pitch: number;
  origin?: [number, number, number];
  palette: string[];
  cells: string;
  bones?: VoxelBone[];
  bone?: string;
}

// --- base64 (from Hacky's format.ts) ------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();
function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_INV[clean.charCodeAt(i)], b = B64_INV[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? B64_INV[clean.charCodeAt(i + 2)] : 0, d = i + 3 < clean.length ? B64_INV[clean.charCodeAt(i + 3)] : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length && i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (o < out.length && i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

// --- built rig ------------------------------------------------------------------

export interface Rig {
  root: THREE.Group;
  bones: Map<string, THREE.Group>;
  height: number;
  dispose: () => void;
}

const FACES: [number, number, number, number[][]][] = [
  [1, 0, 0, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [-1, 0, 0, [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
  [0, 1, 0, [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [0, 0, 1, [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]],
  [0, 0, -1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

interface Shared { bones: VoxelBone[]; geos: (THREE.BufferGeometry | null)[]; height: number }

function buildShared(f: VoxelFile): Shared {
  const [nx, ny, nz] = f.dims;
  const n = nx * ny * nz;
  const P = f.pitch;
  const origin = f.origin ?? [(-nx * P) / 2, 0, (-nz * P) / 2];
  const raw = fromBase64(f.cells);
  const cells = new Uint16Array(n);
  for (let i = 0; i < n && i * 2 + 1 < raw.length; i++) cells[i] = raw[i * 2] | (raw[i * 2 + 1] << 8);
  const boneOf = f.bone ? fromBase64(f.bone) : null;
  const bones = f.bones?.length ? f.bones : [{ name: 'root', parent: -1, pivot: [0, 0, 0] as [number, number, number] }];
  // palette sRGB -> linear
  const lin = f.palette.map(h => new THREE.Color(h).convertSRGBToLinear());
  const idx = (x: number, y: number, z: number) => (y * nz + z) * nx + x;
  const filled = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && cells[idx(x, y, z)] > 0;

  const per = bones.map(() => ({ pos: [] as number[], col: [] as number[], nor: [] as number[] }));
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const i = idx(x, y, z);
    const c = cells[i];
    if (!c) continue;
    const b = boneOf ? Math.min(boneOf[i], bones.length - 1) : 0;
    const out = per[b];
    const col = lin[c - 1];
    const pv = bones[b].pivot;
    for (const [dx, dy, dz, quad] of FACES) {
      if (filled(x + dx, y + dy, z + dz)) continue;
      // a touch of baked shade per face direction reads as form under any light
      const shade = dy > 0 ? 1.0 : dy < 0 ? 0.6 : dx !== 0 ? 0.85 : 0.92;
      const vs = quad.map(([qx, qy, qz]) => [origin[0] + (x + qx) * P - pv[0], origin[1] + (y + qy) * P - pv[1], origin[2] + (z + qz) * P - pv[2]]);
      for (const k of [0, 1, 2, 0, 2, 3]) {
        out.pos.push(...vs[k]);
        out.col.push(col.r * shade, col.g * shade, col.b * shade);
        out.nor.push(dx, dy, dz);
      }
    }
  }

  const geos = per.map(d => {
    if (!d.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
    return geo;
  });
  return { bones, geos, height: ny * P };
}

/** A fresh rig for one character on screen; geometry is shared per file. */
function buildRig(sh: Shared, material: THREE.Material): Rig {
  const { bones, geos } = sh;
  const root = new THREE.Group();
  const groups = bones.map(b => { const g = new THREE.Group(); g.name = b.name; return g; });
  bones.forEach((b, i) => {
    const g = groups[i];
    const parent = b.parent >= 0 ? bones[b.parent] : null;
    g.position.set(b.pivot[0] - (parent?.pivot[0] ?? 0), b.pivot[1] - (parent?.pivot[1] ?? 0), b.pivot[2] - (parent?.pivot[2] ?? 0));
    (b.parent >= 0 ? groups[b.parent] : root).add(g);
    const geo = geos[i];
    if (geo) { const m = new THREE.Mesh(geo, material); m.frustumCulled = false; g.add(m); }
  });
  return { root, bones: new Map(groups.map(g => [g.name, g])), height: sh.height, dispose: () => {} };
}

const sharedCache = new Map<string, Shared>();
function sharedFor(src: string, f: VoxelFile) {
  let sh = sharedCache.get(src);
  if (!sh) { sh = buildShared(f); sharedCache.set(src, sh); }
  return sh;
}

const fileCache = new Map<string, Promise<VoxelFile>>();
function loadFile(url: string) {
  let p = fileCache.get(url);
  if (!p) { p = fetch(url).then(r => r.json() as Promise<VoxelFile>); fileCache.set(url, p); }
  return p;
}

export const CREW_MODELS = ['/characters/astro-pilot.json', '/characters/astro-engineer.json', '/characters/astro-scientist.json', '/characters/astro-commander.json'];
export const crewModel = (slot: number) => CREW_MODELS[slot % CREW_MODELS.length];

export type CharMode = 'solid' | 'hologram';

/**
 * A voxel character. `talk` (0..1) drives a talking idle; `lookAt` is a
 * world-space point (in the parent's space) the head turns toward.
 */
export function VoxelChar({ src, mode = 'solid', talk, lookAt, height, pose = 'stand' }: {
  src: string; mode?: CharMode; talk?: React.RefObject<number>; lookAt?: React.RefObject<THREE.Vector3 | null>; height?: number; pose?: 'stand' | 'sit' | 'wave';
}) {
  const [file, setFile] = useState<VoxelFile | null>(null);
  useEffect(() => { let live = true; loadFile(src).then(f => { if (live) setFile(f); }); return () => { live = false; }; }, [src]);
  const material = useMemo(() => mode === 'hologram'
    ? new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88, toneMapped: false, depthWrite: true })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 }), [mode]);
  const rig = useMemo(() => (file ? buildRig(sharedFor(src, file), material) : null), [file, material, src]);
  useEffect(() => () => rig?.dispose(), [rig]);
  const holder = useRef<THREE.Group>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    if (!rig || !holder.current) return;
    const t = clock.elapsedTime;
    const k = talk?.current ?? 0;
    const B = rig.bones;
    const chest = B.get('chest'), head = B.get('head'), spine = B.get('spine');
    // breathing
    if (chest) chest.rotation.x = Math.sin(t * 1.6) * 0.015;
    if (spine) spine.rotation.z = Math.sin(t * 0.7) * 0.01;
    // head turns toward the viewer, nods while talking
    if (head) {
      let yaw = Math.sin(t * 0.4) * 0.08, pitch = 0;
      const target = lookAt?.current;
      if (target) {
        head.getWorldPosition(tmp);
        const local = holder.current.worldToLocal(target.clone());
        const hp = holder.current.worldToLocal(tmp.clone());
        const d = local.sub(hp);
        yaw = Math.max(-0.9, Math.min(0.9, Math.atan2(d.x, d.z)));
        pitch = Math.max(-0.4, Math.min(0.4, -Math.atan2(d.y, Math.hypot(d.x, d.z))));
      }
      head.rotation.y += (yaw - head.rotation.y) * 0.1;
      head.rotation.x += (pitch + Math.sin(t * 7.3) * 0.05 * k - head.rotation.x) * 0.15;
    }
    // hands while talking
    const ua = B.get('upperArmR'), fa = B.get('forearmR'), ul = B.get('upperArmL'), fl = B.get('forearmL');
    if (pose === 'wave' && ua && fa) { ua.rotation.z = 2.5; fa.rotation.z = 0.4 + Math.sin(t * 6) * 0.4; }
    else {
      if (ua) ua.rotation.x = -k * (0.5 + Math.sin(t * 2.1) * 0.25);
      if (fa) fa.rotation.x = -k * (0.6 + Math.sin(t * 3.3) * 0.3);
      if (ul) ul.rotation.x = -k * 0.25 * (1 + Math.sin(t * 1.7 + 1));
      if (fl) fl.rotation.x = -k * 0.4;
    }
    if (pose === 'sit') {
      for (const s of ['thighL', 'thighR']) { const b = B.get(s); if (b) b.rotation.x = -1.45; }
      for (const s of ['shinL', 'shinR']) { const b = B.get(s); if (b) b.rotation.x = 1.45; }
    }
    if (mode === 'hologram') {
      const m = material as THREE.MeshBasicMaterial;
      m.opacity = 0.8 + Math.sin(t * 31) * 0.04 + (Math.sin(t * 2.3) > 0.97 ? -0.3 : 0);
    }
  });

  if (!rig) return null;
  const s = height ? height / rig.height : 1;
  return <group ref={holder} scale={s}><primitive object={rig.root} /></group>;
}
