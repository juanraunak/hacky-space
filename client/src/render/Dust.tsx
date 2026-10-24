// Drifting dust around you: a few hundred tiny soft dots in a box that wraps
// around the camera (Hacky's wrap-around idea), so there is always something
// near to give parallax and a sense of moving through a place. Dots only: no
// lines, no streaks. The wrap is done on the GPU from the camera's float64
// position reduced modulo the box, so it never jitters far from the origin.

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { origin, camWorld } from './origin';
import { LAPTOP } from './quality';
import { mulberry32 } from '../universe/hash';

const BOX = 150;

const VERT = /* glsl */ `
attribute float aSize;
attribute float aTone;
uniform vec3 uCamRel;   // camera position minus the floating origin
uniform vec3 uCamMod;   // camera world position modulo the box
uniform float uBox;
uniform float uScale;   // pixels per unit at distance 1
varying float vA;
varying float vTone;
void main() {
  vec3 off = mod(position - uCamMod, uBox) - 0.5 * uBox;
  vec4 mv = viewMatrix * vec4(uCamRel + off, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = length(off);
  // fade in from the box edge (no pops at the wrap) and out right at the lens
  vA = (1.0 - smoothstep(0.32 * uBox, 0.5 * uBox, d)) * smoothstep(1.5, 5.0, d);
  float px = aSize * uScale / max(1.0, -mv.z);
  // tiny: anything under 1.5 px keeps its size and loses brightness instead
  vA *= clamp(px / 1.5, 0.0, 1.0);
  gl_PointSize = clamp(px, 1.5, 4.0);
  vTone = aTone;
}
`;

const FRAG = /* glsl */ `
uniform float uGain;
varying float vA;
varying float vTone;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float s = exp(-r2 * 3.0);
  vec3 col = mix(vec3(0.62, 0.66, 0.78), vec3(0.85, 0.74, 0.6), vTone);
  gl_FragColor = vec4(col * s * vA * uGain, 0.0);
}
`;

export function Dust() {
  const N = LAPTOP ? 520 : 220;
  const { geometry, material } = useMemo(() => {
    const r = mulberry32(0xd057);
    const pos = new Float32Array(N * 3), size = new Float32Array(N), tone = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = r() * BOX; pos[i * 3 + 1] = r() * BOX; pos[i * 3 + 2] = r() * BOX;
      size[i] = 0.05 + 0.1 * r() * r();
      tone[i] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aTone', new THREE.BufferAttribute(tone, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uCamRel: { value: new THREE.Vector3() }, uCamMod: { value: new THREE.Vector3() },
        uBox: { value: BOX }, uScale: { value: 600 }, uGain: { value: 0.7 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    return { geometry: g, material: m };
  }, [N]);

  useFrame(({ size, camera, viewport }) => {
    const u = material.uniforms;
    const m = (x: number) => ((x % BOX) + BOX) % BOX;
    (u.uCamRel.value as THREE.Vector3).set(camWorld.x - origin.x, camWorld.y - origin.y, camWorld.z - origin.z);
    (u.uCamMod.value as THREE.Vector3).set(m(camWorld.x), m(camWorld.y), m(camWorld.z));
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
    u.uScale.value = (size.height * 0.5) / Math.tan((fov * Math.PI) / 360) * viewport.dpr;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
