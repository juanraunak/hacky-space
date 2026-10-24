// Cel shading and ink outlines, ported from Hacky (world1/toon.tsx). Every
// character part is a MeshToonMaterial with a three-step gradient and an
// inverted-hull outline: the same geometry, scaled up, drawn back-face in ink.
//
// One addition for space: a material context. Parts ask the context for their
// materials, so one character (Newton falling into the black hole) can swap
// in a set whose vertex shader bends him around the hole like lensed light.

import * as THREE from 'three';
import { createContext, useContext, type ReactNode } from 'react';

export const INK = '#111111';

let gradient: THREE.DataTexture | null = null;

export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    const data = new Uint8Array([72, 165, 255]);
    gradient = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const materials = new Map<string, THREE.MeshToonMaterial>();
export function toonMaterial(color: string): THREE.MeshToonMaterial {
  let mat = materials.get(color);
  if (!mat) {
    mat = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    materials.set(color, mat);
  }
  return mat;
}

let outline: THREE.MeshBasicMaterial | null = null;
export function outlineMaterial(): THREE.MeshBasicMaterial {
  if (!outline) outline = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  return outline;
}

// --- material sets --------------------------------------------------------

export interface MatSet {
  body: (color: string) => THREE.Material;
  outline: () => THREE.Material;
}

export const DEFAULT_MATS: MatSet = { body: toonMaterial, outline: outlineMaterial };
export const MatContext = createContext<MatSet>(DEFAULT_MATS);

/** Uniforms the lens warp reads. Positions are scene space (world - origin). */
export interface LensUniforms {
  uHole: { value: THREE.Vector3 };
  uCam: { value: THREE.Vector3 };
  uStrength: { value: number }; // 0 = no warp, 1 = wrapped round the ring
  uRing: { value: number }; // photon ring radius
  uSpin: { value: number }; // extra swirl, grows as he circles
  uFade: { value: number }; // 1 = solid, 0 = gone
}

export function makeLensUniforms(): LensUniforms {
  return {
    uHole: { value: new THREE.Vector3() },
    uCam: { value: new THREE.Vector3() },
    uStrength: { value: 0 },
    uRing: { value: 18 },
    uSpin: { value: 0 },
    uFade: { value: 1 },
  };
}

// Bend every vertex around the hole as seen from the camera: rotate it about
// the hole's centre in the plane facing the camera (more near the ring, so a
// body smears into an arc), pull it onto the photon ring, flatten it toward
// that plane, and let it glow hot where it is wrapped.
const LENS_HEAD = /* glsl */ `
uniform vec3 uHole;
uniform vec3 uCam;
uniform float uStrength;
uniform float uRing;
uniform float uSpin;
varying float vLens;
vec3 lensWarp(vec3 p) {
  vLens = 0.0;
  if (uStrength <= 0.0) return p;
  vec3 axis = normalize(uCam - uHole);
  vec3 d = p - uHole;
  float along = dot(d, axis);
  vec3 pl = d - axis * along;
  float rp = max(length(pl), 1e-3);
  float s = uStrength;
  float near = smoothstep(uRing * 7.0, uRing * 0.9, rp);
  float ang = s * near * (0.8 + 2.6 * near) + uSpin * near;
  vec3 rot = pl * cos(ang) + cross(axis, pl) * sin(ang);
  float rr = mix(rp, uRing * (1.0 + 0.08 * sin(rp * 2.3 + uSpin)), s * near * near);
  vLens = s * (0.2 + 0.8 * near);
  return uHole + normalize(rot) * rr + axis * along * (1.0 - 0.85 * s * near);
}
`;

const LENS_PROJECT = /* glsl */ `
vec4 lensW = modelMatrix * vec4( transformed, 1.0 );
lensW.xyz = lensWarp( lensW.xyz );
vec4 mvPosition = viewMatrix * lensW;
gl_Position = projectionMatrix * mvPosition;
`;

const LENS_FRAG_HEAD = /* glsl */ `
varying float vLens;
uniform float uFade;
`;

const LENS_FRAG_TAIL = /* glsl */ `
#include <dithering_fragment>
gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 3.2, 2.1, 1.2 ), clamp( vLens, 0.0, 1.0 ) * 0.85 );
gl_FragColor.a *= uFade;
`;

function lensify<M extends THREE.Material>(m: M, u: LensUniforms): M {
  m.transparent = true;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${LENS_HEAD}`)
      .replace('#include <project_vertex>', LENS_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${LENS_FRAG_HEAD}`)
      .replace('#include <dithering_fragment>', LENS_FRAG_TAIL);
  };
  m.customProgramCacheKey = () => 'hs-lens';
  return m;
}

/** A material set whose parts bend around a black hole (see LENS_HEAD). */
export function makeLensMats(u: LensUniforms): MatSet {
  const bodies = new Map<string, THREE.Material>();
  let ink: THREE.Material | null = null;
  return {
    body(color) {
      let m = bodies.get(color);
      if (!m) { m = lensify(new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() }), u); bodies.set(color, m); }
      return m;
    },
    outline() {
      if (!ink) ink = lensify(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }), u);
      return ink;
    },
  };
}

// --- shared geometry --------------------------------------------------------

export const GEO = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  sphereLow: new THREE.SphereGeometry(1, 8, 6),
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 8),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
};

export interface PartProps {
  geometry?: THREE.BufferGeometry;
  color: string;
  /** Outline thickness as a fraction of the part's size. 0.05 normal, 0.09 small parts. */
  outline?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  visible?: boolean;
  children?: ReactNode;
}

export function Part({ geometry = GEO.box, color, outline = 0.05, position, rotation, scale = 1, visible = true, children }: PartProps) {
  const mats = useContext(MatContext);
  return (
    <group position={position} rotation={rotation} scale={scale} visible={visible}>
      <mesh geometry={geometry} material={mats.body(color)} />
      {outline > 0 && <mesh geometry={geometry} material={mats.outline()} scale={1 + outline} />}
      {children}
    </group>
  );
}
