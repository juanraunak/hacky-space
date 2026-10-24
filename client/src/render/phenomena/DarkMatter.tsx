// A dark matter halo: invisible mass, visible only by how it bends starlight.
// Thin-lens deflection with a cored isothermal profile (roughly constant
// deflection outside a soft core, tapering to zero at the shell edge so it
// blends into the background). Einstein-ring arcs fall out of the bending.
// A very faint dusty haze marks the core for players who look closely.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { sky, NOISE_GLSL } from '../sky';
import { PHYSICS_FX } from '../../game/constants';

const ALPHA0 = 0.12; // rad

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vCenter;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vCenter;
uniform samplerCube uSky;
uniform float uHasSky;
uniform float uR;
uniform float uCore;
uniform float uAlpha0;
uniform float uTime;
uniform float uSeed;

${NOISE_GLSL}

vec3 skyCol(vec3 d) { return uHasSky > 0.5 ? textureLod(uSky, d, 0.0).rgb : vec3(0.0); }

void main() {
  vec3 ro = cameraPosition - vCenter;
  vec3 rd = normalize(vWorld - cameraPosition);
  float tc = -dot(ro, rd);          // distance along the ray to closest approach
  vec3 pc = ro + rd * tc;           // closest point, relative to centre
  float b = length(pc);
  vec3 toC = b > 1e-4 * uR ? -pc / b : vec3(0.0);

  // Cored isothermal deflection, tapered to 0 at the shell edge.
  float core = uCore;
  float prof = b / sqrt(b * b + core * core);
  float taper = 1.0 - smoothstep(max(core, 0.4 * uR), uR, b);
  // Fraction of the bending still ahead of the camera (1 from outside).
  float ahead = 0.5 * (1.0 + tc / sqrt(tc * tc + b * b + 1e-6));
  float alpha = uAlpha0 * prof * taper * ahead;

  vec3 d = normalize(rd * cos(alpha) + toC * sin(alpha));
  vec3 col = skyCol(d);

  // Faint dust inside the core, along the chord the ray cuts through it.
  float hc = core * 1.4;
  float chord = sqrt(max(hc * hc - b * b, 0.0)) / hc;
  float front = smoothstep(-hc, 0.0, tc);
  float n = fbm(pc / core * 1.6 + vec3(uSeed, uSeed * 0.7, uTime * 0.01), 5);
  float a = clamp(0.06 * chord * front * smoothstep(0.3, 0.7, n) * 1.4, 0.0, 0.06);
  vec3 dust = vec3(0.045, 0.036, 0.03);
  col = mix(col, dust, a);

  // Only as opaque as the bending is strong, so overlapping lenses blend.
  float op = max(smoothstep(0.0, 0.25 * uAlpha0, alpha), a * 8.0);
  gl_FragColor = vec4(col, clamp(op, 0.0, 1.0));
}
`;

export function DarkMatter({ body }: { body: Body }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const skyVer = useRef(-1);
  const geo = useMemo(() => new THREE.SphereGeometry(1, 48, 32), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    toneMapped: false,
    uniforms: {
      uSky: { value: null as THREE.CubeTexture | null },
      uHasSky: { value: 0 },
      uR: { value: 1 },
      uCore: { value: 0.25 },
      uAlpha0: { value: ALPHA0 * PHYSICS_FX },
      uTime: { value: 0 },
      uSeed: { value: 0 },
    },
  }), []);

  useEffect(() => () => { mat.dispose(); geo.dispose(); }, [mat, geo]);

  useFrame(({ clock }) => {
    const m = meshRef.current;
    if (!m) return;
    place(m, body);
    const R = Math.max(body.radius, 1e-3);
    m.scale.setScalar(R);
    const u = mat.uniforms;
    if (skyVer.current !== sky.version) {
      skyVer.current = sky.version;
      u.uSky.value = sky.a;
      u.uHasSky.value = sky.a ? 1 : 0;
    }
    u.uR.value = R;
    u.uCore.value = body.core > 0 ? Math.min(body.core, R * 0.9) : R * 0.25;
    u.uAlpha0.value = ALPHA0 * PHYSICS_FX;
    u.uTime.value = clock.elapsedTime;
    u.uSeed.value = (body.seed % 1000) * 0.071;
  });

  return <mesh ref={meshRef} geometry={geo} material={mat} renderOrder={-10} />;
}
