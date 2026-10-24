// A wormhole mouth as a lens shell. Cheap analytic stand-in for the
// Ellis-wormhole ray tracing of James et al. 2015 (noted in DECISIONS.md):
// rays whose impact parameter b is inside the throat radius see the other
// sky, turned by an angle that grows to pi at the centre; rays outside are
// lensed toward the mouth, tapering to nothing at the shell edge. A soft
// swirling rim marks the throat.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { sky, NOISE_GLSL } from '../sky';
import { PHYSICS_FX } from '../../game/constants';

const SHELL = 3; // shell radius in throat radii

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
uniform samplerCube uHere;
uniform samplerCube uThere;
uniform float uHasHere;
uniform float uHasThere;
uniform float uRho;
uniform float uR;
uniform float uTime;
uniform float uFx;
uniform float uSeed;

#define PI 3.14159265

${NOISE_GLSL}

vec3 hereCol(vec3 d) { return uHasHere > 0.5 ? textureLod(uHere, d, 0.0).rgb : vec3(0.0); }
vec3 thereCol(vec3 d) { return uHasThere > 0.5 ? textureLod(uThere, d, 0.0).rgb : vec3(0.0); }

void main() {
  vec3 ro = cameraPosition - vCenter;
  vec3 rd = normalize(vWorld - cameraPosition);
  float tc = -dot(ro, rd);
  vec3 pc = ro + rd * tc;
  float b = length(pc);
  vec3 toC = b > 1e-4 * uRho ? -pc / b : vec3(0.0);
  float rho = uRho;
  float camR = length(ro);

  vec3 col;
  if (camR < rho) {
    // Camera inside the throat: all the other side.
    col = thereCol(rd);
  } else if (b < rho && tc > 0.0) {
    // Through the throat: turned about (rd x toC) by pi (1 - b/rho).
    float th = PI * (1.0 - b / rho) * uFx;
    vec3 d = normalize(rd * cos(th) + toC * sin(th));
    col = thereCol(d);
  } else {
    float ahead = 0.5 * (1.0 + tc / sqrt(tc * tc + b * b + 1e-6));
    float a = 2.0 * pow(rho / max(b, rho), 2.0) * 1.2 * uFx;
    a = min(a, PI) * (1.0 - smoothstep(rho, uR, b)) * ahead;
    vec3 d = normalize(rd * cos(a) + toC * sin(a));
    col = hereCol(d);
  }

  // Swirling rim at b ~ rho.
  if (tc > 0.0 && camR >= rho) {
    vec3 fw = normalize(-ro);
    vec3 e1 = normalize(abs(fw.y) < 0.95 ? cross(fw, vec3(0.0, 1.0, 0.0)) : cross(fw, vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(fw, e1);
    float phi = atan(dot(pc, e2), dot(pc, e1));
    float x = (b - rho) / rho;
    float ring = exp(-x * x / 0.012);
    float spiral = phi * 3.0 + log(max(b, 1e-3) / rho) * 9.0 - uTime * 1.4;
    float s = 0.5 + 0.5 * sin(spiral);
    float nz = fbm(vec3(cos(phi) * 2.0, sin(phi) * 2.0, x * 6.0 + uTime * 0.25) + uSeed, 4);
    float glow = ring * (0.35 + 0.65 * s) * (0.6 + 0.8 * nz);
    col += vec3(0.62, 0.8, 1.0) * 2.0 * glow;
  }

  float op = camR < rho ? 1.0 : 1.0 - smoothstep(rho * 1.6, uR, b);
  gl_FragColor = vec4(col, op);
}
`;

export function Wormhole({ body }: { body: Body }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const skyVer = useRef(-1);
  const mouthRef = useRef<Body['mouth']>(undefined);
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
      uHere: { value: null as THREE.CubeTexture | null },
      uThere: { value: null as THREE.CubeTexture | null },
      uHasHere: { value: 0 },
      uHasThere: { value: 0 },
      uRho: { value: 1 },
      uR: { value: SHELL },
      uTime: { value: 0 },
      uFx: { value: PHYSICS_FX },
      uSeed: { value: 0 },
    },
  }), []);

  useEffect(() => () => { mat.dispose(); geo.dispose(); }, [mat, geo]);

  useFrame(({ clock }) => {
    const m = meshRef.current;
    if (!m) return;
    place(m, body);
    const rho = Math.max(body.radius, 1e-3);
    m.scale.setScalar(rho * SHELL);
    const u = mat.uniforms;
    if (skyVer.current !== sky.version || mouthRef.current !== body.mouth) {
      skyVer.current = sky.version;
      mouthRef.current = body.mouth;
      // Outside we always see sky A; through the throat, the other sky.
      const there = body.mouth === 'exit' ? sky.a : sky.b;
      u.uHere.value = sky.a;
      u.uThere.value = there;
      u.uHasHere.value = sky.a ? 1 : 0;
      u.uHasThere.value = there ? 1 : 0;
    }
    u.uRho.value = rho;
    u.uR.value = rho * SHELL;
    u.uTime.value = clock.elapsedTime;
    u.uFx.value = PHYSICS_FX;
    u.uSeed.value = (body.seed % 1000) * 0.113;
  });

  return <mesh ref={meshRef} geometry={geo} material={mat} renderOrder={-10} />;
}
