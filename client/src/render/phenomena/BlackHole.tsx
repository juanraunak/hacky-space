// A Schwarzschild black hole drawn as a lens shell: a back-faced sphere of
// radius 14 rs whose fragments trace each view ray backwards along its exact
// null geodesic. Units: rs = 1, u = 1/r. Our own code; the equations follow
// oseiskar.github.io/black-hole/docs/physics.html and Starless (references
// only).
//
//  Orbit plane  A ray never leaves the plane through the hole spanned by the
//               camera position and the ray direction. Basis e1 (radial at
//               the start), e2 (forward); position r (cos phi e1 + sin phi e2).
//  Binet        d2u/dphi2 = -u + 1.5 u^2, RK4 in phi, adaptive dphi
//               (dphi <= uK * u / |du/dphi| keeps head-on rays stable).
//  Camera       a static observer: b = r sin(a) / sqrt(1 - 1/r),
//               du/dphi = -u sqrt(1 - u) cot(a), a = angle from outward radial.
//               Outside the shell the ray starts at the shell with the same b.
//  Fate         (du/dphi)^2 = 1/b^2 - u^2 + u^3. Photon sphere r = 1.5, critical
//               impact parameter b_c = 3 sqrt(3) / 2: the shadow edge is
//               exactly b = b_c, decided analytically, with a thin photon ring
//               just outside it (never thinner than ~2 px).
//  Escape       at r > 14 moving out: phi_inf = phi + int_0^u du/sqrt(...)
//               (closed-form fit, same on the way in); the sky is sampled
//               along cos(phi_inf) e1 + sin(phi_inf) e2.
//  Disc         thin, ISCO (3) to 8, perpendicular to body.normal, up to three
//               crossings front to back (crossing angles are exact: the step
//               lands on them). Emitted T(r) ∝ [r^-3 (1 - sqrt(3/r))]^(1/4).
//  Redshift     u^t = 1/sqrt(1 - 3/(2r)), Omega = sqrt(1/(2 r^3)),
//               1/g = u^t (1 - Omega L), L = photon angular momentum about the
//               disc axis (conserved: L = -b nrm.N from the camera ray),
//               g in [0.2, 3]. Observed I ∝ g^4 I_em, observed T = g T_em.
//  DISC_SHIFT   shown shift = g^(DISC_SHIFT * PHYSICS_FX): 1 is the full
//               physical shift, 0 none (Interstellar's choice). Default 0.6.
//  Kepler       the disc is ten flat "voxel" rings, each one temperature,
//               broken into arc blocks turning at its own Omega(r) in real
//               time (one rs/c = rs / C seconds), so the shear reads as rings
//               sliding past each other.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { sky, NOISE_GLSL } from '../sky';
import { Q } from '../quality';
import { PHYSICS_FX, C } from '../../game/constants';

const SHELL = 14; // lens shell radius, rs
const DISC_IN = 3; // ISCO
const DISC_OUT = 8;
const RINGS = 10; // flat temperature rings across the disc
const CELL = 1.25; // arc block length along a ring, rs
const DISC_SHIFT = 0.6; // share of the true g shown (x PHYSICS_FX)
const DISC_I = 2.4; // disc brightness at the profile peak, g = 1
const RING_I = 3.4; // photon ring brightness
const B_CRIT = 1.5 * Math.sqrt(3);
const F_PEAK = (() => { const r = (49 / 36) * DISC_IN; return Math.pow(r, -3) * (1 - Math.sqrt(DISC_IN / r)); })();

const STEPS = Math.min(256, Math.max(24, Q.bhSteps));
const STEP_SCALE = Math.max(1, 200 / Q.bhSteps); // phone: fewer, larger steps
const DPHI = Math.min(0.06 * STEP_SCALE, 0.22);
const KREL = Math.min(0.08 * STEP_SCALE, 0.3);

const fl = (x: number) => x.toExponential(7);

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
uniform float uCubeHalf;
uniform float uRs;
uniform float uShell;
uniform vec3 uNormal;
uniform vec3 uD1;
uniform vec3 uD2;
uniform float uTemp;
uniform float uTime;
uniform float uSpin;
uniform float uFx;
uniform float uShift;
uniform float uDphi;
uniform float uK;
uniform float uSeed;

#define MAX_STEPS ${STEPS}
#define PI 3.14159265
#define TAU 6.28318531
#define DISC_IN ${fl(DISC_IN)}
#define DISC_OUT ${fl(DISC_OUT)}
#define RINGS ${fl(RINGS)}
#define RING_W ${fl((DISC_OUT - DISC_IN) / RINGS)}
#define CELL ${fl(CELL)}
#define F_PEAK ${fl(F_PEAK)}
#define B_CRIT ${fl(B_CRIT)}
#define DISC_I ${fl(DISC_I)}
#define RING_I ${fl(RING_I)}

${NOISE_GLSL}

// Curated warm ramp by observed temperature: deep orange, gold, white-hot
// (always a touch warm, never flat white). Chromaticity only.
vec3 warmRamp(float t) {
  vec3 c = vec3(1.0, 0.13, 0.015);
  c = mix(c, vec3(1.0, 0.22, 0.02), smoothstep(2500.0, 4000.0, t));
  c = mix(c, vec3(1.0, 0.34, 0.05), smoothstep(4000.0, 5500.0, t));
  c = mix(c, vec3(1.0, 0.48, 0.11), smoothstep(5500.0, 7000.0, t));
  c = mix(c, vec3(1.0, 0.64, 0.24), smoothstep(7000.0, 8500.0, t));
  c = mix(c, vec3(1.0, 0.80, 0.48), smoothstep(8500.0, 10500.0, t));
  c = mix(c, vec3(1.0, 0.92, 0.76), smoothstep(10500.0, 13500.0, t));
  return c;
}

// Brightness of one arc block: mostly even, the odd dimmer gap.
float cellLight(float ring, float j) {
  float h = h31(vec3(ring * 1.37 + uSeed, j, 3.1));
  return h < 0.12 ? 0.72 : 0.9 + 0.2 * h;
}

// One voxel ring at disc azimuth phiD: (emitted flux / peak, block light).
vec2 ringSample(float ring, float phiD, float dAng) {
  float rc = DISC_IN + (ring + 0.5) * RING_W;
  float flux = pow(rc, -3.0) * (1.0 - sqrt(DISC_IN / rc)) / F_PEAK;
  float n = floor(TAU * rc / CELL);
  float om = sqrt(0.5 / (rc * rc * rc)) * uSpin; // Kepler, rad per second
  float x = (phiD - om * uTime) / TAU * n;
  float bnd = floor(x + 0.5);
  float s = x - bnd;
  float wc = clamp(dAng / TAU * n, 0.04, 0.5);
  float v = mix(cellLight(ring, mod(bnd - 1.0, n)), cellLight(ring, mod(bnd, n)), smoothstep(-wc, wc, s));
  float tone = 0.93 + 0.14 * h31(vec3(ring + uSeed, 7.0, 1.9));
  return vec2(flux * tone, v);
}

// Phi a ray still sweeps between u and infinity, int_0^u du / sqrt(1/b^2 -
// u^2 + u^3), in closed form (u^3 / 3 fits the integral to < 1e-3 rad for
// b < 10 at the shell; the flat asin(b u) overshoots by up to 0.03).
float tailPhi(float b, float u) {
  return atan(u, sqrt(max(1.0 / (b * b) - u * u + u * u * u / 3.0, 0.0)));
}

// Emission (rgb) and opacity (a) of the disc where the ray crosses it at P.
vec4 discLayer(vec3 P, float valid, float L) {
  float rr = length(P);
  float r = clamp(rr, 1.6, 40.0);
  float aa = length(fwidth(P));
  float phiD = atan(dot(P, uD2), dot(P, uD1));

  float xr = (r - DISC_IN) / RING_W;
  float bnd = floor(xr + 0.5);
  float s = xr - bnd;
  float wr = clamp(aa / RING_W, 0.03, 0.5);
  float dAng = aa / r;
  vec2 q = mix(ringSample(clamp(bnd - 1.0, 0.0, RINGS - 1.0), phiD, dAng),
               ringSample(clamp(bnd, 0.0, RINGS - 1.0), phiD, dAng),
               smoothstep(-wr, wr, s));
  float tEm = uTemp * pow(max(q.x, 0.0), 0.25);

  float ut = inversesqrt(max(1.0 - 1.5 / r, 1e-3));
  float om = sqrt(0.5 / (r * r * r));
  float g = clamp(1.0 / (ut * max(1.0 - om * L, 1e-3)), 0.2, 3.0);
  float ge = pow(g, uShift);
  float I = min(DISC_I * q.x * ge * ge * ge * ge * q.y, 14.0);
  vec3 col = warmRamp(tEm * ge) * I;

  float ew = clamp(aa, 0.03, 0.3);
  float edge = smoothstep(DISC_IN - ew, DISC_IN + ew, rr) * (1.0 - smoothstep(DISC_OUT - ew, DISC_OUT + ew, rr));
  float a = valid * edge * clamp(0.66 + 0.3 * q.y, 0.0, 0.97);
  return vec4(col, a);
}

void main() {
  vec3 ro = (cameraPosition - vCenter) / uRs;
  vec3 rd = normalize(vWorld - cameraPosition);
  float rCam = length(ro);
  if (rCam < 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // Ray geometry at the camera (a static observer).
  vec3 er = ro / rCam;
  float cosA = dot(er, rd);
  vec3 cr = cross(er, rd);
  float sinA = length(cr);
  float uc = 1.0 / max(rCam, 1.0005);
  float b = rCam * sinA * inversesqrt(1.0 - uc); // conserved impact parameter
  float bFlat = rCam * sinA;                      // straight-line miss distance
  vec3 nrm = sinA > 1e-6 ? cr / sinA
    : normalize(cross(er, abs(er.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));

  // Start: at the camera if inside the shell, else where the straight ray
  // meets it, moved back by the bend the true ray picks up on the way in.
  float bb = max(b, 1e-6);
  vec3 p0 = ro;
  float u, w;
  float phi = 0.0;
  float cIn = rCam * rCam - uShell * uShell;
  if (cIn > 0.0) {
    float bq = dot(ro, rd);
    p0 = ro + rd * max(-bq - sqrt(max(bq * bq - cIn, 0.0)), 0.0);
    u = 1.0 / length(p0);
    w = sqrt(max(1.0 / (bb * bb) - u * u + u * u * u, 0.0)); // inward
    phi = (tailPhi(bb, u) - tailPhi(bb, uc)) - (asin(min(bFlat * u, 1.0)) - asin(min(bFlat * uc, 1.0)));
  } else {
    u = uc;
    w = -u * sqrt(1.0 - u) * cosA / max(sinA, 1e-6);
  }
  vec3 e1 = normalize(p0);
  vec3 e2 = cross(nrm, e1);

  // Disc plane crossings: n1 cos(phi) + n2 sin(phi) = 0, every PI.
  float n1 = dot(e1, uNormal), n2 = dot(e2, uNormal);
  float phiC = 1e9;
  if (n1 * n1 + n2 * n2 > 1e-8) {
    phiC = mod(atan(n2, n1) + 0.5 * PI, PI);
    if (phiC < phi + 1e-4) phiC += PI; // the start itself is no crossing
  }

  float uEsc = 1.0 / uShell;
  int hits = 0;
  vec3 h0 = uD1 * 20.0, h1 = uD1 * 20.0, h2 = uD1 * 20.0;
  bool done = false;
  bool fell = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    float hs = min(uDphi, uK * u / max(abs(w), 1e-6));
    bool land = phiC - phi <= hs;
    if (land) hs = phiC - phi;
    float k1u = w;                     float k1w = -u + 1.5 * u * u;
    float ua = u + 0.5 * hs * k1u;
    float k2u = w + 0.5 * hs * k1w;    float k2w = -ua + 1.5 * ua * ua;
    float ub = u + 0.5 * hs * k2u;
    float k3u = w + 0.5 * hs * k2w;    float k3w = -ub + 1.5 * ub * ub;
    float uq = u + hs * k3u;
    float k4u = w + hs * k3w;          float k4w = -uq + 1.5 * uq * uq;
    u += hs / 6.0 * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    w += hs / 6.0 * (k1w + 2.0 * k2w + 2.0 * k3w + k4w);
    phi += hs;
    if (u >= 1.0) { fell = true; break; }
    if (land) {
      phi = phiC;
      phiC += PI;
      float r = 1.0 / u;
      if (r > DISC_IN - 0.3 && r < DISC_OUT + 0.3) {
        vec3 P = r * (cos(phi) * e1 + sin(phi) * e2);
        if (hits == 0) h0 = P; else if (hits == 1) h1 = P; else h2 = P;
        hits++;
        if (hits >= 3) phiC = 1e9;
      }
    }
    if (u <= uEsc && w < 0.0) { done = true; break; }
  }

  // Fate, analytically: inward rays from outside the photon sphere escape iff
  // b > b_c; from inside it only outward rays with b < b_c do.
  float m;
  if (rCam >= 1.5) m = cosA < 0.0 ? b - B_CRIT : 1e4;
  else m = cosA < 0.0 ? -1e4 : B_CRIT - b;
  float fwB = max(fwidth(b), 1e-5);
  float esc = clamp(m / fwB + 0.5, 0.0, 1.0);

  // Escaped: the asymptotic direction. Toward the shell edge the bend relaxes
  // to the straight ray so the lens meets the unlensed sky without ghosts.
  float lens = 1.0 - smoothstep(uShell * 0.62, uShell * 0.97, bFlat);
  vec3 dir = rd;
  if (done) {
    float pinf = phi + tailPhi(bb, u);
    dir = cos(pinf) * e1 + sin(pinf) * e2;
  } else if (!fell) {
    float pinf = phi + atan(u, -w); // still winding: where it is heading
    dir = cos(pinf) * e1 + sin(pinf) * e2;
  }
  dir = normalize(mix(rd, dir, lens));
  float lod = clamp(log2(max(length(dFdx(dir)), length(dFdy(dir))) * uCubeHalf + 1e-6), 0.0, 6.0);
  vec3 skyC = uHasSky > 0.5 ? textureLod(uSky, dir, lod).rgb : vec3(0.0);
  float skyMask = esc * (fell ? 0.0 : 1.0);

  // Disc, front to back.
  float L = -b * dot(nrm, uNormal);
  vec4 d0 = discLayer(h0, hits > 0 ? 1.0 : 0.0, L);
  vec4 d1 = discLayer(h1, hits > 1 ? 1.0 : 0.0, L);
  vec4 d2 = discLayer(h2, hits > 2 ? 1.0 : 0.0, L);
  vec3 acc = d0.rgb * d0.a;
  float A = d0.a;
  acc += (1.0 - A) * d1.a * d1.rgb; A += (1.0 - A) * d1.a;
  acc += (1.0 - A) * d2.a * d2.rgb; A += (1.0 - A) * d2.a;

  // Photon ring: sharp inner edge at b_c, falling off outward.
  float ring = esc * exp(-max(m, 0.0) / max(0.035, 2.0 * fwB));
  float utR = inversesqrt(1.0 - 1.5 / 4.0);
  float omR = sqrt(0.5 / 64.0);
  float gR = clamp(1.0 / (utR * max(1.0 - omR * L, 1e-3)), 0.2, 3.0);
  float geR = pow(gR, uShift);
  vec3 ringCol = warmRamp(uTemp * 1.15 * geR) * (RING_I * geR * geR * geR * geR * ring * uFx);

  // Premultiplied: the lens is opaque near the hole and fades to nothing at
  // the shell edge so overlapping lenses and whatever lies behind still show.
  vec3 col = acc + (1.0 - A) * (skyC * skyMask * lens + ringCol);
  float alpha = 1.0 - (1.0 - A) * (1.0 - lens);
  gl_FragColor = vec4(col, alpha);
}
`;

const REF = new THREE.Vector3();

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
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uSky: { value: null as THREE.CubeTexture | null },
      uHasSky: { value: 0 },
      uCubeHalf: { value: Q.cube / 2 },
      uRs: { value: 1 },
      uShell: { value: SHELL },
      uNormal: { value: new THREE.Vector3(0, 1, 0) },
      uD1: { value: new THREE.Vector3(1, 0, 0) },
      uD2: { value: new THREE.Vector3(0, 0, -1) },
      uTemp: { value: 7000 },
      uTime: { value: 0 },
      uSpin: { value: 1 },
      uFx: { value: PHYSICS_FX },
      uShift: { value: DISC_SHIFT * PHYSICS_FX },
      uDphi: { value: DPHI },
      uK: { value: KREL },
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
    const n = u.uNormal.value as THREE.Vector3;
    n.set(body.normal.x, body.normal.y, body.normal.z);
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
    n.normalize();
    // Disc-plane basis with d1 x d2 = n, so azimuth grows with the orbit.
    const d1 = u.uD1.value as THREE.Vector3;
    if (Math.abs(n.y) < 0.9) REF.set(0, 1, 0); else REF.set(1, 0, 0);
    d1.crossVectors(n, REF).normalize();
    (u.uD2.value as THREE.Vector3).crossVectors(n, d1);
    u.uTemp.value = body.temp;
    u.uTime.value = clock.elapsedTime;
    u.uSpin.value = C / rs; // geometric time units (rs / c) per second
    u.uFx.value = PHYSICS_FX;
    u.uShift.value = DISC_SHIFT * PHYSICS_FX;
    u.uSeed.value = (body.seed % 1000) * 0.137;
  });

  return <mesh ref={meshRef} geometry={geo} material={mat} renderOrder={-10} />;
}
