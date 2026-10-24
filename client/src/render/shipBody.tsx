// The rescue ship's exterior model (voxels from voxelShip.ts). Nose points -Z,
// about 5 units long. `engine` (0 idle, 1 thrust, 1.6 boost) drives the nozzle
// glow and the length of the additive HDR flames.
//
// `age` (0 new .. 1 worn out) weathers the ship by its pilot's OWN clock: dust
// settles on the upper faces, panel seams grime over, scratches show bare
// metal, rust patches spread and drip, the paint greys, and at high age the
// engines run dim and sputter. Done in the material (object-space noise, so it
// sticks to the hull). Near a black hole your clock slows: your ship ages less.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { shipGeometry, shipGlassGeometry, NOZZLES, NOZZLE_FACE, WINGTIPS, SHIP_VOXEL } from './voxelShip';
import { NOISE_GLSL } from './sky';

/** Seconds of a pilot's own proper time until the ship is fully weathered. */
export const AGE_TAU = 480;
/** Ship age 0..1 from a pilot's proper time (seconds). */
export const ageFromTau = (tau: number | undefined) => Math.min(1, Math.max(0, (tau ?? 0) / AGE_TAU));

// Matte, barely metallic: there is no environment map, so metal would go dark.
const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.62 });
const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.35, emissive: new THREE.Color('#0d3552') });

const AGE_VERT_HEAD = /* glsl */ `
varying vec3 vAgeP;
varying vec3 vAgeN;
`;
const AGE_FRAG_HEAD = /* glsl */ `
uniform float uAge;
uniform vec3 uAgeSeed;
varying vec3 vAgeP;
varying vec3 vAgeN;
${NOISE_GLSL}
`;
// Runs right after the vertex colour is applied; leaves ag_* for later stages.
const AGE_FRAG_COLOR = /* glsl */ `
float ag = uAge;
vec3 agP = vAgeP + uAgeSeed;
vec3 agN = normalize(vAgeN);
// dust: first to come, settles on upward faces, soft blotches
float agDn = fbm(agP * 3.2 + 17.0, 4);
float ag_dust = smoothstep(0.02, 0.8, ag) * smoothstep(0.5, 0.8, agDn + 0.25 * agN.y + 0.1 * ag) * 0.6;
// rust: patches that appear around a third of the way and spread
float agRn = fbm(agP * 2.6 + 3.0, 5);
float agThr = mix(0.86, 0.5, smoothstep(0.28, 1.0, ag));
float ag_rust = 0.0;
float agStreak = 0.0;
float agPit = 0.0;
#ifdef AGE_RUST
ag_rust = smoothstep(agThr, agThr + 0.05, agRn) * step(0.2, ag);
agPit = smoothstep(agThr - 0.05, agThr, agRn) * (1.0 - ag_rust) * step(0.2, ag); // dark halo
// drips: thin vertical runs hanging under the patches
float agDrip = vnoise(vec3(agP.x * 26.0, agP.y * 2.2, agP.z * 26.0));
agStreak = smoothstep(0.6, 0.9, agDrip) * smoothstep(agThr - 0.14, agThr, fbm((agP + vec3(0.0, 0.35, 0.0)) * 2.6 + 3.0, 5)) * (1.0 - abs(agN.y));
ag_rust = max(ag_rust, agStreak * 0.7 * smoothstep(0.3, 0.6, ag));
#endif
// scratches: short thin bright lines in two directions
vec3 agS = agP * 7.0;
float agL1 = abs(fract(dot(agS, vec3(0.81, 0.17, 0.56)) * 2.7 + vnoise(agS * 0.6) * 1.6) - 0.5);
float agL2 = abs(fract(dot(agS, vec3(-0.52, 0.31, 0.79)) * 2.1 + vnoise(agS * 0.8 + 5.0) * 1.6) - 0.5);
float agLines = (1.0 - smoothstep(0.0, 0.022, agL1)) * smoothstep(0.6, 0.7, vnoise(agS * 0.45 + 2.0))
              + (1.0 - smoothstep(0.0, 0.018, agL2)) * smoothstep(0.62, 0.72, vnoise(agS * 0.4 + 9.0));
float ag_scratch = clamp(agLines, 0.0, 1.0) * smoothstep(0.08, 0.55, ag) * (1.0 - ag_rust);
// grime along the panel seams (two-voxel panels)
vec3 agG = abs(fract(vAgeP / 0.4) - 0.5);
vec3 agW = 1.0 - abs(agN);
float agSeam = smoothstep(0.465, 0.5, agG.x) * agW.x;
agSeam = max(agSeam, smoothstep(0.465, 0.5, agG.y) * agW.y);
agSeam = max(agSeam, smoothstep(0.465, 0.5, agG.z) * agW.z);
vec3 agC = diffuseColor.rgb;
float agLum = dot(agC, vec3(0.3, 0.59, 0.11));
agC = mix(agC, vec3(agLum), 0.35 * ag) * (1.0 - 0.16 * ag);           // paint greys and dulls
agC *= 1.0 - agSeam * 0.4 * smoothstep(0.25, 0.9, ag);                // seams grime over
agC *= 1.0 - 0.18 * smoothstep(0.3, 1.0, ag) * (1.0 - agDn);           // general wear, uneven
agC = mix(agC, vec3(0.78, 0.77, 0.74), ag_scratch * 0.7);              // bare metal
agC = mix(agC, vec3(0.32, 0.3, 0.27) * (0.75 + 0.5 * agDn), ag_dust);  // dust
agC *= 1.0 - 0.45 * agPit;                                            // pitting round the rust
vec3 agRustC = mix(vec3(0.09, 0.022, 0.006), vec3(0.55, 0.17, 0.035), smoothstep(0.2, 0.8, vnoise(agP * 18.0) * 0.6 + (agRn - agThr) * 4.0));
agC = mix(agC, agRustC, ag_rust * (1.0 - 0.4 * ag_dust));
diffuseColor.rgb = agC;
`;

/** A clone of `base` that weathers with `uniforms.uAge`. Programs are shared. */
function agedMaterial<T extends THREE.MeshStandardMaterial>(base: T, rust: boolean, seed: THREE.Vector3) {
  const m = base.clone() as T;
  const uniforms = { uAge: { value: 0 }, uAgeSeed: { value: seed } };
  if (rust) m.defines = { ...(m.defines ?? {}), AGE_RUST: '' };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + AGE_VERT_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAgeP = position;\nvAgeN = objectNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + AGE_FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + AGE_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + 0.22 * ag + 0.3 * ag_dust + 0.25 * ag_rust - 0.3 * ag_scratch, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(mix(metalnessFactor, 0.0, max(ag_rust, ag_dust)) + 0.35 * ag_scratch, 0.0, 1.0);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 - 0.75 * ag_dust - 0.3 * ag;');
  };
  m.customProgramCacheKey = () => 'ship-aged-' + (rust ? 1 : 0);
  return { material: m, uniforms };
}

/** A stable per-colour offset, so two ships the same age do not rust identically. */
function colorSeed(color: string): THREE.Vector3 {
  let h = 2166136261;
  for (let i = 0; i < color.length; i++) h = Math.imul(h ^ color.charCodeAt(i), 16777619);
  const f = (k: number) => (((h >>> k) & 1023) / 1023) * 20;
  return new THREE.Vector3(f(0), f(10), f(20));
}

/** Cheap integer hash to [0, 1) for the engine sputter. */
function hash1(n: number): number {
  let h = Math.imul(n | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** An open square pyramid, base (half-size `half`) on z = 0, apex at z = `len`. */
function pyramid(half: number, len: number): THREE.BufferGeometry {
  const h = half;
  const p = new Float32Array([
    -h, -h, 0, h, -h, 0, 0, 0, len,
    h, -h, 0, h, h, 0, 0, 0, len,
    h, h, 0, -h, h, 0, 0, 0, len,
    -h, h, 0, -h, -h, 0, 0, 0, len,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.computeBoundingSphere();
  return g;
}

// Shared by every ship.
const nozzleGeo = new THREE.PlaneGeometry(NOZZLE_FACE * 0.68, NOZZLE_FACE * 0.68);
const flameGeo = pyramid(NOZZLE_FACE * 0.29, 1.8);
const coreGeo = pyramid(NOZZLE_FACE * 0.16, 1.1);
const lampGeo = new THREE.BoxGeometry(SHIP_VOXEL * 1.04, SHIP_VOXEL * 1.04, SHIP_VOXEL * 1.04);
const additive = { toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } as const;
const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 2.0, 4.2), opacity: 0.8, ...additive });
const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 3.2, 4.4), opacity: 0.9, ...additive });
const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.3, 0.3), toneMapped: false });
const green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 5, 1), toneMapped: false });
const NOZZLE_Z = NOZZLES[0][2];

export function ShipBody({ color, engine, age }: {
  color: string;
  engine: React.RefObject<number>;
  /** 0 new .. 1 fully weathered; a number or a getter read every frame. */
  age?: number | (() => number);
}) {
  const geo = useMemo(() => shipGeometry(color), [color]);
  const nozzle = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.2, 2.1), toneMapped: false }), []);
  const aged = useMemo(() => {
    const seed = colorSeed(color);
    return { hull: agedMaterial(hullMat, true, seed), glass: agedMaterial(glassMat, false, seed) };
  }, [color]);
  useEffect(() => () => nozzle.dispose(), [nozzle]);
  useEffect(() => () => { aged.hull.material.dispose(); aged.glass.material.dispose(); }, [aged]);
  const phase = useMemo(() => Math.random() * 100, []);
  const flames = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const e = engine.current ?? 0;
    const a = Math.min(1, Math.max(0, typeof age === 'function' ? age() : age ?? 0));
    aged.hull.uniforms.uAge.value = a;
    aged.glass.uniforms.uAge.value = a;
    // An old engine runs dimmer and sputters: brief dips, more often with age.
    const worn = Math.max(0, (a - 0.55) / 0.45);
    const tick = Math.floor((t + phase) * 14);
    const sputter = hash1(tick) < 0.3 * worn ? 0.2 + 0.4 * hash1(tick + 7) : 1;
    const wear = (1 - 0.4 * worn) * sputter * (1 - 0.08 * worn * Math.sin((t + phase) * 61));
    // `on` fades the engines out below idle (0.08), so a dark ship is dark.
    const on = Math.min(1, e * 12) * wear;
    const fl = flames.current;
    if (fl) {
      fl.visible = on > 0.02;
      fl.scale.set(1, 1, (0.15 * on + e * (1 + Math.sin((t + phase) * 45) * 0.06)) * wear);
    }
    nozzle.color.setRGB((0.5 + e * 1.2) * on, (1 + e * 2) * on, (1.8 + e * 4) * on);
    // Shared lamps: every ship writes the same blink, so order does not matter.
    const blink = Math.sin(t * 3) > 0.6 ? 1 : 0.1;
    red.color.setRGB(5 * blink, 0.3 * blink, 0.3 * blink);
    green.color.setRGB(0.3 * blink, 5 * blink, 1 * blink);
  });
  return (
    <group>
      <mesh geometry={geo} material={aged.hull.material} />
      <mesh geometry={shipGlassGeometry()} material={aged.glass.material} />
      {NOZZLES.map((p, i) => (
        <mesh key={i} geometry={nozzleGeo} material={nozzle} position={[p[0], p[1], NOZZLE_Z + 0.02]} />
      ))}
      <group ref={flames} position={[0, 0, NOZZLE_Z + 0.025]}>
        {NOZZLES.map((p, i) => (
          <group key={i} position={[p[0], p[1], 0]}>
            <mesh geometry={flameGeo} material={flameMat} />
            <mesh geometry={coreGeo} material={coreMat} />
          </group>
        ))}
      </group>
      <mesh geometry={lampGeo} material={green} position={WINGTIPS[0]} />
      <mesh geometry={lampGeo} material={red} position={WINGTIPS[1]} />
    </group>
  );
}
