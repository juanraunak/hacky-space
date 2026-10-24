// The heavy dark mass beside a wormhole exit. Mostly felt, barely seen: a
// near-black core that hides the stars behind it, a faint deep red-brown
// glow at its limb and a very faint halo. Nothing here blooms.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { NOISE_GLSL } from '../sky';
import { LAPTOP, Q } from '../quality';

const OCT = LAPTOP ? 4 : 2;

const BALL_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
void main() {
  vObj = normalize(position);
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const BALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
${NOISE_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float mu = abs(dot(normalize(vN), V));
  float rim = pow(1.0 - mu, 2.5);
  float n = fbm(vObj * 3.0 + vec3(uSeed, uTime * 0.03, 0.0), ${OCT});
  vec3 ember = vec3(0.30, 0.075, 0.03);
  vec3 col = ember * (rim * 1.1 + 0.035) * (0.6 + 0.8 * n);
  col *= 1.0 - 0.9 * smoothstep(0.55, 1.0, mu); // dark heart
  gl_FragColor = vec4(col, 1.0);
}
`;

const HALO_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

const HALO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 q = (vUv - 0.5) * 6.0; // in ball radii
  float r = length(q);
  float inner = smoothstep(0.95, 1.1, r);
  float n = fbm(vec3(q * 0.9, uSeed) + vec3(0.0, 0.0, uTime * 0.02), ${OCT});
  float I = exp(-(r - 1.0) * 1.8) * inner * (1.0 - smoothstep(2.4, 3.0, r)) * (0.6 + 0.8 * n);
  gl_FragColor = vec4(vec3(0.22, 0.06, 0.03) * I * 0.12, 1.0);
}
`;

export function ExitWell({ body }: { body: Body }) {
  const group = useRef<THREE.Group>(null);
  const seed = (body.seed % 1000) * 0.131;

  const geo = useMemo(() => new THREE.SphereGeometry(1, Math.round(Q.sphereSeg * 0.6), Math.round(Q.sphereSeg * 0.3)), []);
  const plane = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: BALL_VERT, fragmentShader: BALL_FRAG,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed } },
    toneMapped: false,
  }), [seed]);
  const halo = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uSize: { value: body.radius * 6 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), [seed, body.radius]);

  useEffect(() => () => { geo.dispose(); plane.dispose(); }, [geo, plane]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => () => halo.dispose(), [halo]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    place(g, body);
    const t = state.clock.elapsedTime;
    mat.uniforms.uTime.value = t;
    halo.uniforms.uTime.value = t;
  });

  return (
    <group ref={group}>
      <mesh geometry={geo} material={mat} scale={body.radius} />
      <mesh geometry={plane} material={halo} frustumCulled={false} renderOrder={1} />
    </group>
  );
}
