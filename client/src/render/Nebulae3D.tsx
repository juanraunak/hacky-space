// James Webb style gas clouds that are PLACES, not pictures: each cloud is a
// few dozen to a hundred big soft camera-facing sprites spread through a real
// volume, so you can fly toward one, into it and out the other side with true
// parallax. A cloud is built like the Cosmic Cliffs: an amber dust mass whose
// top is a wavy ridge with bright cream rims, blue-teal glowing gas above the
// ridge, and dark dust lanes cut into the dust.
//
// Everything is one instanced draw. Sprites are premultiplied-alpha (gas adds
// light, dust both glows and hides what is behind it, lanes only hide), sorted
// back to front each frame. Sprites near the camera fade out and collapse, so
// flying through a cloud never shows a flat wall. Placement is a pure function
// of world.seed (hash.ts), never Math.random.

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { origin, camWorld } from './origin';
import { LAPTOP } from './quality';
import { mulberry32, rngFor, range, type Rand } from '../universe/hash';
import type { Vec, World } from '../universe/bodies';

// Where every pilot starts, and the way they face.
const SPAWN: Vec = { x: 55, y: 8, z: 370 };

const GAS = 0, DUST = 1, RIM = 2, LANE = 3;

interface Cloud { c: Vec; r: number; style: number; rnd: Rand }

interface Sprite {
  x: number; y: number; z: number;
  size: number; rot: number; seed: number; kind: number;
  tr: number; tg: number; tb: number; light: number;
  ux: number; uy: number; uz: number; asp: number;
}

// --- placement ------------------------------------------------------------------

const d2 = (a: Vec, b: Vec) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

function unit(r: Rand): Vec {
  const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
  return { x: s * Math.cos(a), y: z, z: s * Math.sin(a) };
}

/** 3-5 clouds around the spawn point, plus one beside each phenomenon. */
function placeClouds(world: World): Cloud[] {
  const r = rngFor(world.seed + 7311, 5, 1, 9);
  const keep: { p: Vec; r: number }[] = [{ p: SPAWN, r: 60 }];
  for (const poi of world.pois) {
    keep.push({ p: poi.podStart, r: 120 });
    for (const b of poi.bodies) keep.push({ p: b, r: b.kind === 'black_hole' ? b.radius * 9 + 150 : b.radius * 3 + 150 });
  }
  const clouds: Cloud[] = [];
  const free = (c: Vec, rad: number) =>
    keep.every(k => d2(c, k.p) > (rad + k.r) ** 2) && clouds.every(o => d2(c, o.c) > (rad + o.r) ** 2 * 0.8);
  const add = (c: Vec, rad: number) => {
    clouds.push({ c, r: rad, style: r(), rnd: mulberry32(Math.floor(r() * 4294967296)) });
  };
  const tryAt = (gen: () => { c: Vec; rad: number }, tries = 10) => {
    for (let i = 0; i < tries; i++) {
      const { c, rad } = gen();
      if (free(c, rad)) { add(c, rad); return true; }
    }
    return false;
  };

  // 1. Straight ahead, a little off the nose: the first thing you see and can reach.
  const side = r() < 0.5 ? -1 : 1;
  tryAt(() => {
    const rad = range(r, 380, 520);
    return { rad, c: { x: SPAWN.x + side * range(r, 220, 520), y: SPAWN.y + range(r, -160, 160), z: SPAWN.z - range(r, 1300, 1900) } };
  });
  // 2. A big cliff wall further out, on the other side of the view.
  tryAt(() => {
    const rad = range(r, 650, 900);
    return { rad, c: { x: SPAWN.x - side * range(r, 700, 1400), y: SPAWN.y + range(r, -400, 400), z: SPAWN.z - range(r, 1900, 2700) } };
  });
  // 3-4. Anywhere around you (above, beside, behind).
  const more = 1 + (r() < 0.6 ? 1 : 0);
  for (let i = 0; i < more; i++) {
    tryAt(() => {
      const d = unit(r), rad = range(r, 320, 650), dist = range(r, 1300, 2800);
      return { rad, c: { x: SPAWN.x + d.x * dist, y: SPAWN.y + d.y * dist * 0.6, z: SPAWN.z + d.z * dist } };
    });
  }
  // Beside each phenomenon (not on top of it), at most four.
  for (const poi of world.pois.slice(0, 4)) {
    const b = poi.bodies[0] ?? poi.podStart;
    const clear = poi.bodies.reduce((m, x) => Math.max(m, x.kind === 'black_hole' ? x.radius * 9 + 150 : x.radius * 3 + 150), 150);
    tryAt(() => {
      const d = unit(r), rad = range(r, 320, 700), dist = clear + rad + range(r, 150, 600);
      return { rad, c: { x: b.x + d.x * dist, y: b.y + d.y * dist * 0.7, z: b.z + d.z * dist } };
    }, 12);
  }
  return clouds;
}

// --- one cloud's sprites ----------------------------------------------------------

const AMBER: [number, number, number][] = [[0.9, 0.44, 0.16], [0.95, 0.56, 0.26], [0.78, 0.33, 0.1]];
const TEAL: [number, number, number][] = [[0.22, 0.52, 0.9], [0.18, 0.66, 0.78], [0.42, 0.42, 0.92]];
const CREAM: [number, number, number] = [1.0, 0.84, 0.6];

function buildCloud(cl: Cloud, out: Sprite[], count: number) {
  const r = cl.rnd;
  const R = cl.r;
  // A random frame: u across, v "up" (toward the gas), w depth.
  const vUp = unit(r);
  const tmp = Math.abs(vUp.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let u = { x: tmp.y * vUp.z - tmp.z * vUp.y, y: tmp.z * vUp.x - tmp.x * vUp.z, z: tmp.x * vUp.y - tmp.y * vUp.x };
  const ul = Math.hypot(u.x, u.y, u.z); u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
  const w = { x: vUp.y * u.z - vUp.z * u.y, y: vUp.z * u.x - vUp.x * u.z, z: vUp.x * u.y - vUp.y * u.x };
  const at = (a: number, b: number, c: number) => ({
    x: cl.c.x + u.x * a + vUp.x * b + w.x * c,
    y: cl.c.y + u.y * a + vUp.y * b + w.y * c,
    z: cl.c.z + u.z * a + vUp.z * b + w.z * c,
  });
  // The ridge: a few sines across and in depth, with random phases.
  const f = [range(r, 1.2, 2.2), range(r, 2.6, 4.2), range(r, 5, 8)];
  const ph = [r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3];
  const ridge = (a: number, c: number) => R * (0.05 + 0.16 * Math.sin(f[0] * a / R + ph[0]) + 0.08 * Math.sin(f[1] * a / R + ph[1] + c / R * 2)
    + 0.04 * Math.sin(f[2] * a / R + ph[2]) + 0.06 * Math.sin(2.3 * c / R + ph[3]));
  // Cliff clouds are dust-heavy; wisp clouds are mostly glowing gas.
  const cliff = cl.style < 0.65;
  const amber = AMBER[Math.floor(r() * AMBER.length)];
  const teal = TEAL[Math.floor(r() * TEAL.length)];
  const nGas = Math.round(count * (cliff ? 0.3 : 0.5));
  const nDust = Math.round(count * (cliff ? 0.38 : 0.22));
  const nRim = Math.round(count * (cliff ? 0.18 : 0.16));
  const nLane = Math.max(0, count - nGas - nDust - nRim);
  // Inside a ball-ish envelope, flattened in depth.
  const inEnv = () => {
    for (;;) {
      const a = r() * 2 - 1, c = r() * 2 - 1;
      if (a * a + c * c <= 1) return [a * R, c * R * 0.55] as const;
    }
  };
  const push = (p: Vec, size: number, kind: number, t: readonly number[], light: number) => {
    out.push({
      // gas turns any way; dust, rims and lanes lie along the ridge (jittered)
      x: p.x, y: p.y, z: p.z, size, rot: kind === GAS ? r() * Math.PI * 2 : (r() - 0.5) * 0.7, seed: r() * 64, kind,
      tr: t[0], tg: t[1], tb: t[2], light, ux: vUp.x, uy: vUp.y, uz: vUp.z,
      asp: kind === GAS ? range(r, 1, 1.5) : kind === DUST ? range(r, 1.15, 1.8) : range(r, 1.5, 2.6),
    });
  };
  for (let i = 0; i < nGas; i++) {
    const [a, c] = inEnv();
    const h = ridge(a, c);
    const up = Math.pow(r(), 0.8) * R * 0.75;
    const near = 1 - up / (R * 0.75);
    const tt = [teal[0] * range(r, 0.85, 1.1), teal[1] * range(r, 0.85, 1.1), teal[2]];
    push(at(a, h + up - R * 0.05, c), R * range(r, 0.3, 0.6), GAS, tt, 0.35 + 0.55 * near);
  }
  for (let i = 0; i < nDust; i++) {
    const [a, c] = inEnv();
    const h = ridge(a, c);
    const down = Math.pow(r(), 1.4) * R * 0.7;
    const top = 1 - down / (R * 0.7);
    const k = range(r, 0.8, 1.15);
    push(at(a, h - down - R * 0.06, c), R * range(r, 0.13, 0.28) * (0.8 + 0.4 * (1 - top)), DUST, [amber[0] * k, amber[1] * k, amber[2] * k], 0.18 + 0.55 * top);
  }
  for (let i = 0; i < nRim; i++) {
    const [a, c] = inEnv();
    push(at(a, ridge(a, c) + range(r, -0.04, 0.03) * R, c), R * range(r, 0.06, 0.13), RIM, CREAM, range(r, 0.4, 0.7));
  }
  for (let i = 0; i < nLane; i++) {
    const [a, c] = inEnv();
    const h = ridge(a, c);
    push(at(a, h - range(r, 0.1, 0.5) * R, c * 0.8), R * range(r, 0.1, 0.2), LANE, [0, 0, 0], 1);
  }
}

// --- noise texture (tileable value noise, two channels) ---------------------------

function noiseTexture(): THREE.DataTexture {
  const S = 128, P = 16, cell = S / P;
  const r = mulberry32(0x5eed);
  const lat = [new Float32Array(P * P), new Float32Array(P * P)];
  for (const l of lat) for (let i = 0; i < l.length; i++) l[i] = r();
  const data = new Uint8Array(S * S * 4);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const gx = x / cell, gy = y / cell;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = fade(gx - ix), fy = fade(gy - iy);
    const x0 = ix % P, x1 = (ix + 1) % P, y0 = iy % P, y1 = (iy + 1) % P;
    for (let ch = 0; ch < 2; ch++) {
      const l = lat[ch];
      const a = l[y0 * P + x0] + (l[y0 * P + x1] - l[y0 * P + x0]) * fx;
      const b = l[y1 * P + x0] + (l[y1 * P + x1] - l[y1 * P + x0]) * fx;
      data[(y * S + x) * 4 + ch] = Math.round((a + (b - a) * fy) * 255);
    }
    data[(y * S + x) * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// --- shaders ------------------------------------------------------------------------

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iA;   // size, rotation (jitter for aligned kinds), noise seed, kind
attribute vec4 iB;   // tint rgb, light
attribute vec4 iUp;  // the cloud's "up" (toward its gas) in world axes, aspect
varying vec2 vUv;
varying vec4 vA;
varying vec4 vB;
varying vec2 vUp;
varying float vFade;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float size = iA.x;
  // Fade (then collapse) sprites near the camera: no flat walls inside a cloud.
  float dc = length(mv.xyz);
  vFade = smoothstep(0.35 * size, 1.4 * size, dc);
  if (vFade < 0.002) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec2 up = (viewMatrix * vec4(iUp.xyz, 0.0)).xy;
  float ul = length(up);
  up = ul > 1e-4 ? up / ul : vec2(0.0, 1.0);
  // aligned kinds: the sprite's long axis runs across the cloud's up
  float rot = iA.w > 0.5 ? atan(up.y, up.x) - 1.5707963 + iA.y : iA.y;
  float c = cos(rot), s = sin(rot);
  vec2 q = position.xy;
  vec2 qs = vec2(q.x * iUp.w, q.y);
  mv.xy += vec2(c * qs.x - s * qs.y, s * qs.x + c * qs.y) * size;
  gl_Position = projectionMatrix * mv;
  vUv = q;
  vA = iA;
  vB = iB;
  vUp = vec2(c * up.x + s * up.y, -s * up.x + c * up.y) * smoothstep(0.0, 0.3, ul);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uGain;
varying vec2 vUv;
varying vec4 vA;
varying vec4 vB;
varying vec2 vUp;
varying float vFade;
float fbm(vec2 p) {
  float s = 0.0, a = 0.55;
  for (int i = 0; i < 4; i++) {
    s += a * texture2D(uNoise, p).r;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 0.37;
    a *= 0.5;
  }
  return s / 1.03;
}
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float kind = vA.w;
  vec2 p = vUv * (kind < 0.5 ? 0.11 : 0.15) + vA.z;
  vec2 warp = vec2(texture2D(uNoise, p * 0.7 + 3.1).g, texture2D(uNoise, p * 0.7 + 7.7).g) - 0.5;
  float n = fbm(p + warp * 0.12);
  // the noise makes the shape; the round envelope only keeps it inside the quad
  float env = 1.0 - r2;
  float dens = clamp((n - 0.28 - 0.55 * r2) * 3.2, 0.0, 1.0) * smoothstep(0.0, 0.25, env);
  vec3 tint = vB.rgb;
  float light = vB.a;
  float lit = dot(vUv, vUp);           // + toward the cloud's lit side
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (kind < 0.5) {
    // glowing gas: mostly light, barely any cover
    float g = dens * dens * (3.0 - 2.0 * dens);
    col = tint * light * g * 0.2;
    a = g * 0.05;
  } else if (kind < 1.5) {
    // dust: lit from above, dark below; a cream rim along its lit edge
    float d = clamp((n - 0.26 - 0.6 * r2) * 1.7, 0.0, 1.0) * smoothstep(0.0, 0.25, env);
    a = smoothstep(0.0, 0.85, d) * 0.72;
    float top = smoothstep(-0.9, 0.8, lit);
    // deep red-brown in the shade, glowing amber toward the lit side
    vec3 body = mix(tint * vec3(0.55, 0.4, 0.35), tint * 1.25, top);
    col = body * light * (0.45 + 0.7 * n) * 0.6 * a;
    // a cream rim where the thin outer dust catches the light
    float edge = smoothstep(0.0, 0.15, d) * (1.0 - smoothstep(0.15, 0.55, d));
    col += vec3(1.0, 0.82, 0.58) * edge * smoothstep(0.0, 0.8, lit) * light * 0.45;
  } else if (kind < 2.5) {
    // cream rim wisps: bright, thin
    float g = smoothstep(0.05, 0.8, dens);
    col = tint * light * g * 0.42;
    a = g * 0.15;
  } else {
    // dark lanes: hide what is behind, give nothing
    a = smoothstep(0.05, 0.6, dens) * 0.75;
  }
  float k = vFade * uGain;
  gl_FragColor = vec4(col * k, a * k);
}
`;

// --- the component ---------------------------------------------------------------------

export function Nebulae3D({ world }: { world: World }) {
  const seed = world.seed;
  const sprites = useMemo(() => {
    const out: Sprite[] = [];
    const scale = LAPTOP ? 1 : 0.4;
    for (const cl of placeClouds(world)) {
      const n = Math.round(Math.min(170, Math.max(70, cl.r * 0.2)) * scale);
      buildCloud(cl, out, Math.max(20, n));
    }
    return out;
    // The world object changes with the crew list; the clouds follow the seed and phenomena.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, world.pois]);

  const { mesh, geo, mat, buf } = useMemo(() => {
    const n = sprites.length;
    const quad = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    const iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const iA = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const iB = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const iUp = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', iPos);
    g.setAttribute('iA', iA);
    g.setAttribute('iB', iB);
    g.setAttribute('iUp', iUp);
    g.instanceCount = n;
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uNoise: { value: noiseTexture() }, uGain: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      premultipliedAlpha: true, toneMapped: false,
    });
    const me = new THREE.Mesh(g, m);
    me.frustumCulled = false;
    me.renderOrder = -5; // after the sky, before solid-looking glows
    return {
      mesh: me, geo: g, mat: m,
      buf: { iPos, iA, iB, iUp, order: new Uint32Array(n), key: new Float32Array(n), idx: Array.from({ length: n }, (_, i) => i) },
    };
  }, [sprites]);

  useEffect(() => () => { geo.dispose(); (mat.uniforms.uNoise.value as THREE.Texture).dispose(); mat.dispose(); }, [geo, mat]);

  useFrame(() => {
    const n = sprites.length;
    const { iPos, iA, iB, iUp, key, idx } = buf;
    for (let i = 0; i < n; i++) {
      const s = sprites[i];
      key[i] = (s.x - camWorld.x) ** 2 + (s.y - camWorld.y) ** 2 + (s.z - camWorld.z) ** 2;
    }
    idx.sort((a, b) => key[b] - key[a]); // far first
    const P = iPos.array as Float32Array, A = iA.array as Float32Array, B = iB.array as Float32Array, U = iUp.array as Float32Array;
    for (let j = 0; j < n; j++) {
      const s = sprites[idx[j]];
      P[j * 3] = s.x - origin.x; P[j * 3 + 1] = s.y - origin.y; P[j * 3 + 2] = s.z - origin.z;
      A[j * 4] = s.size; A[j * 4 + 1] = s.rot; A[j * 4 + 2] = s.seed; A[j * 4 + 3] = s.kind;
      B[j * 4] = s.tr; B[j * 4 + 1] = s.tg; B[j * 4 + 2] = s.tb; B[j * 4 + 3] = s.light;
      U[j * 4] = s.ux; U[j * 4 + 1] = s.uy; U[j * 4 + 2] = s.uz; U[j * 4 + 3] = s.asp;
    }
    iPos.needsUpdate = true; iA.needsUpdate = true; iB.needsUpdate = true; iUp.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
