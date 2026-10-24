// A Schwarzschild black hole drawn as a lens shell: a back-faced sphere around
// the hole whose fragments trace the view ray through a pseudo-Newtonian
// photon orbit (a = -3/2 h^2 r / |r|^5, units of rs), then sample the baked
// sky with the bent direction. Thin accretion disc from ISCO (3 rs) outwards
// with gravitational + Doppler shifts, and a photon ring at 1.5 rs.
// Physics after oseiskar.github.io/black-hole (docs); our own code.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { sky, NOISE_GLSL, BLACKBODY_GLSL } from '../sky';
import { Q } from '../quality';
import { PHYSICS_FX } from '../../game/constants';

const SHELL = 14; // shell radius in rs
const DISC_IN = 3; // ISCO
const DISC_OUT = 8;
const DISC_SHIFT = 0.5; // how much of the true shift we show (Interstellar toned it down)

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
uniform float uRs;
uniform float uShell;
uniform vec3 uNormal;
uniform float uTemp;
uniform float uTime;
uniform float uFx;
uniform float uStepScale;
uniform float uSeed;

#define MAX_STEPS ${Math.min(256, Math.max(8, Q.bhSteps))}
#define DISC_IN ${DISC_IN.toFixed(1)}
#define DISC_OUT ${DISC_OUT.toFixed(1)}
#define DISC_SHIFT ${DISC_SHIFT.toFixed(3)}

${NOISE_GLSL}
${BLACKBODY_GLSL}

vec3 skyCol(vec3 d) { return uHasSky > 0.5 ? textureLod(uSky, d, 0.0).rgb : vec3(0.0); }

// Emission and opacity of the disc where the ray crosses it at 'hit'.
vec4 disc(vec3 hit, vec3 vel) {
  float r = length(hit);
  if (r < DISC_IN || r > DISC_OUT) return vec4(0.0);
  // Novikov-Thorne-like profile, peak at r = 49/12.
  float f = pow(r, -3.0) * (1.0 - sqrt(DISC_IN / r));
  float fPeak = 0.0021;
  float shape = max(f / fPeak, 0.0);
  float T = uTemp * pow(shape, 0.25);

  // Orbital velocity around n; direction toward the observer is -vel.
  vec3 n = uNormal;
  vec3 u = normalize(cross(n, hit));
  float cosT = dot(u, -normalize(vel));
  float beta = min(1.0 / sqrt(2.0 * (r - 1.0)), 0.7);
  float gam = 1.0 / sqrt(1.0 - beta * beta);
  float delta = gam * (1.0 - beta * cosT) / sqrt(1.0 - 1.0 / r);
  float g = clamp(1.0 / delta, 0.24, 6.6);
  float gEff = pow(g, DISC_SHIFT * uFx);

  // Streaks that shear with Keplerian rotation.
  vec3 e1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(n, e1);
  float phi = atan(dot(hit, e2), dot(hit, e1));
  float omega = 1.6 * pow(r, -1.5);
  float pr = phi - omega * uTime;
  vec3 q = vec3(r * 3.2 + uSeed, cos(pr) * 2.0, sin(pr) * 2.0);
  float streak = 0.55 + 0.9 * fbm(q, 4) * (0.6 + 0.4 * vnoise(vec3(r * 11.0, cos(pr) * 6.0, sin(pr) * 6.0)));

  float edge = smoothstep(DISC_IN, DISC_IN + 0.35, r) * (1.0 - smoothstep(DISC_OUT - 3.0, DISC_OUT, r));
  // Art-directed warmth (Interstellar kept the disc warm and readable): deep
  // orange outside, gold toward the inner edge, the approaching side hotter.
  float I = min(6.0, 1.7 * pow(shape, 0.8) * streak * pow(gEff, 3.0));
  vec3 base = mix(vec3(1.0, 0.26, 0.05), vec3(1.0, 0.68, 0.32), smoothstep(0.15, 1.0, shape));
  vec3 col = mix(base, vec3(1.0, 0.9, 0.78), smoothstep(1.15, 2.4, gEff)) * I;
  float a = clamp(edge * (0.55 + 0.45 * shape) * streak, 0.0, 0.97);
  return vec4(col * edge, a);
}

void main() {
  vec3 ro = (cameraPosition - vCenter) / uRs;
  vec3 rd = normalize(vWorld - cameraPosition);
  // Start at the shell entry if the camera is outside.
  float bq = dot(ro, rd);
  float c = dot(ro, ro) - uShell * uShell;
  vec3 p = ro;
  if (c > 0.0) {
    float disc0 = max(bq * bq - c, 0.0);
    float t0 = -bq - sqrt(disc0);
    p = ro + rd * max(t0, 0.0);
  }
  vec3 v = rd;
  float h = length(cross(p, v));
  float h2 = h * h;

  vec3 acc = vec3(0.0);
  float A = 0.0;
  int crossings = 0;
  float rmin = 1e9;
  bool captured = false;
  bool escaped = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    float r = length(p);
    rmin = min(rmin, r);
    if (r < 1.0) { captured = true; break; }
    if (r > uShell + 0.01 && dot(p, v) > 0.0) { escaped = true; break; }
    float dt = clamp(0.06 * r * r / max(h, 0.5) * uStepScale, 0.008, 1.5);
    // Velocity Verlet.
    vec3 a0 = -1.5 * h2 * p / pow(r, 5.0);
    v += a0 * (0.5 * dt);
    vec3 pOld = p;
    p += v * dt;
    float r1 = length(p);
    vec3 a1 = -1.5 * h2 * p / pow(max(r1, 0.5), 5.0);
    v += a1 * (0.5 * dt);

    float d0 = dot(pOld, uNormal);
    float d1 = dot(p, uNormal);
    if (crossings < 3 && d0 * d1 < 0.0 && A < 0.99) {
      float f = d0 / (d0 - d1);
      vec3 hit = mix(pOld, p, f);
      vec4 e = disc(hit, v);
      acc += (1.0 - A) * e.rgb;
      A += (1.0 - A) * e.a;
      crossings++;
    }
  }

  vec3 bg = vec3(0.0);
  if (!captured) {
    if (escaped || dot(p, v) > 0.0) bg = skyCol(normalize(v));
  }

  // Photon ring: rays that skim the photon sphere at 1.5 rs. Never thinner than ~2 px.
  float w = max(0.012, fwidth(rmin) * 2.0);
  float ring = captured ? 0.0 : exp(-pow((rmin - 1.5) / w, 2.0));
  vec3 ringCol = blackbody(uTemp * 1.1) * 2.5 * ring * uFx;

  vec3 col = acc + (1.0 - A) * (bg + ringCol);
  // Far from the hole the bending is tiny: fade out so whatever lies behind
  // (another lens, a star) still shows. The disc itself stays opaque.
  float alpha = max(A, 1.0 - smoothstep(uShell * 0.62, uShell * 0.97, h));
  gl_FragColor = vec4(col, alpha);
}
`;

export function BlackHole({ body }: { body: Body }) {
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
      uRs: { value: 1 },
      uShell: { value: SHELL },
      uNormal: { value: new THREE.Vector3(0, 1, 0) },
      uTemp: { value: 7000 },
      uTime: { value: 0 },
      uFx: { value: PHYSICS_FX },
      uStepScale: { value: Math.max(1, 200 / Q.bhSteps) },
      uSeed: { value: 0 },
    },
  }), []);

  useEffect(() => () => { mat.dispose(); geo.dispose(); }, [mat, geo]);

  useFrame(({ clock }) => {
    const m = meshRef.current;
    if (!m) return;
    place(m, body);
    const rs = Math.max(body.rs || body.radius, 1e-3);
    m.scale.setScalar(rs * SHELL);
    const u = mat.uniforms;
    if (skyVer.current !== sky.version) {
      skyVer.current = sky.version;
      u.uSky.value = sky.a;
      u.uHasSky.value = sky.a ? 1 : 0;
    }
    u.uRs.value = rs;
    (u.uNormal.value as THREE.Vector3).set(body.normal.x, body.normal.y, body.normal.z).normalize();
    u.uTemp.value = body.temp;
    u.uTime.value = clock.elapsedTime;
    u.uFx.value = PHYSICS_FX;
    u.uSeed.value = (body.seed % 1000) * 0.137;
  });

  return <mesh ref={meshRef} geometry={geo} material={mat} renderOrder={-10} />;
}
