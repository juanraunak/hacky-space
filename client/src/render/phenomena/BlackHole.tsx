// A Schwarzschild black hole: real light bending, an art-directed warm disc.
// Units: rs = 1, u = 1/r. Our own code; the equations follow
// oseiskar.github.io/black-hole/docs/physics.html and Starless (references
// only).
//
// Three pieces, drawn back to front:
//  Glow    a back-faced sphere (40 rs), additive: the analytic line integral
//          of a warm haze 1/(r^2 + c^2) (zero at its edge) along each view
//          ray, so the space around the hole is lit and never pops.
//  Lens    every pixel near the hole traces its view ray backwards along the
//          exact null geodesic. Far away it is drawn on a back-faced shell
//          sphere (14 rs). Close up (camera inside the shell or near it) the
//          same shader runs on a full-screen triangle and writes the shell's
//          depth itself, so the near plane can never cut a hole in it.
//  Disc    thin, ISCO (3) to 8, perpendicular to body.normal, up to three
//          crossings front to back (crossing angles are exact: the step lands
//          on them). Warm and art-directed like the disc Juan liked: white-gold
//          at the inner edge, gold, deep orange outside, Keplerian streaks.
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
//               impact parameter b_c = 3 sqrt(3) / 2: the shadow edge is exactly
//               b = b_c, decided analytically, with a bright thin photon ring
//               just outside it (never thinner than ~2 px) and a soft halo.
//  Doppler      1/g = u^t (1 - Omega L), L = photon angular momentum about the
//               disc axis (conserved: L = -b nrm.N from the camera ray). The
//               Doppler part D = 1 / (1 - Omega L) is shown damped (Interstellar
//               style): brightness x D^0.95, clamped to [0.55, 1.85], so the
//               approaching side is ~1.3-1.8x brighter and hotter in colour.
//  Lens fade    the lens fades to the plain scene where a straight ray would
//               never come within ~9 rs (closest approach, not impact
//               parameter, so it is continuous when the camera crosses the
//               shell).

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { sky, NOISE_GLSL } from '../sky';
import { Q, LAPTOP } from '../quality';
import { PHYSICS_FX, C } from '../../game/constants';

const SHELL = 14; // lens shell radius, rs
const NEAR_SWITCH = 1.3; // full-screen lens when the camera is within this x shell
const GLOW_R = 40; // glow sphere radius, rs
const GLOW_C = 4; // glow core softening, rs
const GLOW_CORE = 70; // tight warm glow around the hole
const GLOW_WIDE = 0.025; // faint wide haze
const GLOW_I = 1; // overall glow strength
const DISC_IN = 3; // ISCO
const DISC_OUT = 8;
const DISC_I = 4.4; // disc brightness at the inner edge, no Doppler
const RING_I = 6.5; // photon ring brightness
const BEAM = 0.95; // damped Doppler exponent
const B_CRIT = 1.5 * Math.sqrt(3);
const OCT = LAPTOP ? 4 : 3;

const STEPS = Math.min(256, Math.max(24, Q.bhSteps));
const STEP_SCALE = Math.max(1, 200 / Q.bhSteps); // phone: fewer, larger steps
const DPHI = Math.min(0.06 * STEP_SCALE, 0.22);
const KREL = Math.min(0.08 * STEP_SCALE, 0.3);

const fl = (x: number) => x.toExponential(7);

const VERT_SHELL = /* glsl */ `
uniform float uActive;
varying vec3 vWorld;
varying vec3 vCenter;
varying vec3 vDir;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vDir = vec3(0.0);
  gl_Position = projectionMatrix * viewMatrix * w;
  if (uActive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // off: no fragments
}
`;

// A full-screen triangle; the view ray is rebuilt from the camera matrices
// that are current for this very draw (no frame of lag).
const VERT_SCREEN = /* glsl */ `
uniform float uActive;
varying vec3 vWorld;
varying vec3 vCenter;
varying vec3 vDir;
void main() {
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 v = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = mat3(transpose(viewMatrix)) * (v.xyz / v.w);
  vWorld = cameraPosition + vDir;
  gl_Position = vec4(position.xy, 0.0, 1.0);
  if (uActive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const GLOW_GLSL = /* glsl */ `
// Line integrals along the ray ro + t rd (t >= 0, inside radius R) of a
// tight core 1/(r^2 + c^2)^2 and a faint wide haze 1/(r^2 + c^2), each minus
// its value at R so the glow is exactly zero at the glow sphere.
float glowLine(vec3 ro, vec3 rd) {
  float R = ${fl(GLOW_R)};
  float c2 = ${fl(GLOW_C * GLOW_C)};
  float tc = -dot(ro, rd);
  float d2 = max(dot(ro, ro) - tc * tc, 0.0);
  float h2 = R * R - d2;
  if (h2 <= 0.0) return 0.0;
  float h = sqrt(h2);
  float t1 = max(tc - h, 0.0) - tc, t2 = max(tc + h, 0.0) - tc;
  float D2 = d2 + c2, D = sqrt(D2);
  float q = R * R + c2;
  float a1 = atan(t1 / D), a2 = atan(t2 / D);
  float wide = (a2 - a1) / D - (t2 - t1) / q;
  float core = (t2 / (t2 * t2 + D2) - t1 / (t1 * t1 + D2) + (a2 - a1) / D) / (2.0 * D2) - (t2 - t1) / (q * q);
  return max(${fl(GLOW_CORE)} * core + ${fl(GLOW_WIDE)} * wide, 0.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vCenter;
varying vec3 vDir;
uniform samplerCube uSky;
uniform float uHasSky;
uniform float uCubeHalf;
uniform float uRs;
uniform float uShell;
uniform vec3 uNormal;
uniform vec3 uD1;
uniform vec3 uD2;
uniform float uHeat;
uniform float uExposure;
uniform vec3 uGlowCol;
uniform float uTime;
uniform float uSpin;
uniform float uFx;
uniform float uDphi;
uniform float uK;
uniform float uSeed;
#ifdef SCREEN
uniform mat4 projectionMatrix;
#endif

#define MAX_STEPS ${STEPS}
#define PI 3.14159265
#define TAU 6.28318531
#define DISC_IN ${fl(DISC_IN)}
#define DISC_OUT ${fl(DISC_OUT)}
#define B_CRIT ${fl(B_CRIT)}
#define DISC_I ${fl(DISC_I)}
#define RING_I ${fl(RING_I)}
#define BEAM ${fl(BEAM)}
#define OCT ${OCT}
#define OCT_NORM ${fl(1 / (1 - Math.pow(0.5, OCT)))}

${NOISE_GLSL}
${GLOW_GLSL}

// Warm ramp by 'heat' (inner-edge closeness x Doppler): deep red-orange,
// orange, gold, pale gold, near-white. Chromaticity only.
vec3 discRamp(float h) {
  vec3 c = vec3(0.80, 0.09, 0.012);
  c = mix(c, vec3(1.0, 0.22, 0.03), smoothstep(0.0, 0.16, h));
  c = mix(c, vec3(1.0, 0.38, 0.07), smoothstep(0.12, 0.40, h));
  c = mix(c, vec3(1.0, 0.56, 0.17), smoothstep(0.36, 0.70, h));
  c = mix(c, vec3(1.0, 0.76, 0.42), smoothstep(0.66, 1.05, h));
  c = mix(c, vec3(1.0, 0.90, 0.74), smoothstep(1.0, 1.6, h));
  return c;
}

// Phi a ray still sweeps between u and infinity, int_0^u du / sqrt(1/b^2 -
// u^2 + u^3), in closed form (u^3 / 3 fits the integral to < 1e-3 rad for
// b < 10 at the shell; the flat asin(b u) overshoots by up to 0.03).
float tailPhi(float b, float u) {
  return atan(u, sqrt(max(1.0 / (b * b) - u * u + u * u * u / 3.0, 0.0)));
}

// Emission (rgb, already edge-faded) and opacity (a) of the disc where the
// ray crosses it at P. aa = how far P moves across one pixel (rs).
vec4 discLayer(vec3 P, float valid, float L, float aa) {
  float r = length(P);
  if (valid < 0.5 || r < DISC_IN - 0.5 || r > DISC_OUT + 0.5) return vec4(0.0);
  float phiD = atan(dot(P, uD2), dot(P, uD1));
  float om = sqrt(0.5 / (r * r * r)); // Kepler, geometric units
  float pr = phiD - om * uSpin * uTime;
  float cp = cos(pr), sp = sin(pr);

  // Streaks sheared by the Kepler flow; detail fades out where one pixel
  // covers more than the feature, so it never shimmers far away.
  float d1 = 1.0 - smoothstep(0.35, 1.4, aa);
  float d2 = 1.0 - smoothstep(0.06, 0.3, aa);
  float f1 = fbm(vec3(r * 2.4 + uSeed, cp * 2.2, sp * 2.2), OCT) * OCT_NORM;
  float f2 = d2 > 0.0 ? vnoise(vec3(r * 10.0 + uSeed * 1.7, cp * 5.5, sp * 5.5)) : 0.5;
  float streak = max((1.0 + 1.5 * d1 * (f1 - 0.5)) * (1.0 + 0.8 * d2 * (f2 - 0.5)), 0.15);

  // Brightest at the inner edge, falling off outward.
  float ew = clamp(aa, 0.04, 0.4);
  float edge = smoothstep(DISC_IN - ew, DISC_IN + 0.25 + ew, r) * (1.0 - smoothstep(DISC_OUT - 2.8, DISC_OUT + ew, r));
  float prof = pow(DISC_IN / r, 3.0);

  // Damped Doppler beaming and a touch of gravitational dimming.
  float ut = inversesqrt(max(1.0 - 1.5 / r, 1e-3));
  float D = 1.0 / max(1.0 - om * L, 0.05);
  float beam = clamp(pow(D, BEAM * uFx), 0.55, 1.85);
  float grav = mix(1.0, 1.0 / ut, 0.5 * uFx);

  float heat = prof * beam * grav * (0.82 + 0.18 * streak) * uHeat;
  float I = min(DISC_I * uHeat * uExposure * prof * streak * beam * grav, 16.0);
  vec3 col = discRamp(heat) * I * edge;
  float a = edge * clamp(0.35 + 0.6 * prof + 0.25 * (streak - 1.0), 0.05, 0.96);
  return vec4(col, a);
}

void main() {
  vec3 ro = (cameraPosition - vCenter) / uRs;
#ifdef SCREEN
  vec3 rd = normalize(vDir);
#else
  vec3 rd = normalize(vWorld - cameraPosition);
#endif
  float rCam = length(ro);
  float bq = dot(ro, rd);
  float cIn = rCam * rCam - uShell * uShell;
#ifdef SCREEN
  // Only the rays that pass through the shell, with the shell's own depth
  // (its far side), exactly as the sphere would have had.
  float dq = bq * bq - cIn;
  if (cIn > 0.0 && (bq >= 0.0 || dq <= 0.0)) discard;
  vec3 pExit = cameraPosition + rd * ((-bq + sqrt(max(dq, 0.0))) * uRs);
  vec4 clipP = projectionMatrix * viewMatrix * vec4(pExit, 1.0);
  gl_FragDepth = clamp(0.5 * clipP.z / clipP.w + 0.5, 0.0, 1.0);
#endif
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
  if (cIn > 0.0) {
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
      if (r > DISC_IN - 0.5 && r < DISC_OUT + 0.5) {
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

  // How much this pixel is lensed: by the straight ray's closest approach
  // (the camera itself for rays heading away), fading out toward the shell.
  float rMin = cosA >= 0.0 ? rCam : bFlat;
  float lens = 1.0 - smoothstep(uShell * 0.62, uShell * 0.97, rMin);

  // Escaped: the asymptotic direction. Toward the fade the bend relaxes to
  // the straight ray so the lens meets the unlensed sky without ghosts.
  vec3 dir = rd;
  if (done) {
    float pinf = phi + tailPhi(bb, u);
    dir = cos(pinf) * e1 + sin(pinf) * e2;
  } else if (!fell) {
    float pinf = phi + atan(u, -w); // still winding: where it is heading
    dir = cos(pinf) * e1 + sin(pinf) * e2;
  }
  dir = normalize(mix(rd, dir, lens));
  // Mip level from the gentler screen axis: at fold lines (shadow edge,
  // Einstein ring) one axis jumps and would smear a blurry seam.
  float dd = min(length(dFdx(dir)), length(dFdy(dir)));
  float lod = clamp(log2(dd * uCubeHalf + 1e-6), 0.0, 4.0);
  vec3 skyC = uHasSky > 0.5 ? textureLod(uSky, dir, lod).rgb : vec3(0.0);
  float skyMask = esc * (fell ? 0.0 : 1.0);

  // Disc, front to back (derivatives taken outside any branch).
  float L = -b * dot(nrm, uNormal);
  float aa0 = length(fwidth(h0)), aa1 = length(fwidth(h1)), aa2 = length(fwidth(h2));
  vec4 d0 = discLayer(h0, hits > 0 ? 1.0 : 0.0, L, aa0);
  vec4 d1 = discLayer(h1, hits > 1 ? 1.0 : 0.0, L, aa1);
  vec4 d2 = discLayer(h2, hits > 2 ? 1.0 : 0.0, L, aa2);
  vec3 acc = d0.rgb;
  float A = d0.a;
  acc += (1.0 - A) * d1.rgb; A += (1.0 - A) * d1.a;
  acc += (1.0 - A) * d2.rgb; A += (1.0 - A) * d2.a;

  // Photon ring: a sharp bright line at b_c and a soft halo hugging it.
  float thin = exp(-max(m, 0.0) / max(0.03, 1.5 * fwB));
  float soft = exp(-max(m, 0.0) / 0.45);
  float omR = sqrt(0.5 / 27.0);
  float beamR = clamp(pow(1.0 / max(1.0 - omR * L, 0.05), 0.6 * uFx), 0.7, 1.5);
  vec3 ringCol = (vec3(1.0, 0.8, 0.52) * (RING_I * thin) + vec3(1.0, 0.42, 0.1) * (0.9 * soft)) * (beamR * esc * uHeat * uExposure);

  // The warm haze, matching the glow sphere behind (which shows through
  // where the lens fades), kept out of the shadow.
  vec3 glow = uGlowCol * glowLine(ro, rd) * (lens * esc);

  // Premultiplied: the lens is opaque near the hole and fades to nothing at
  // the shell edge so overlapping lenses and whatever lies behind still show.
  vec3 col = acc + (1.0 - A) * (skyC * skyMask * lens + ringCol + glow);
  float alpha = 1.0 - (1.0 - A) * (1.0 - lens);
  gl_FragColor = vec4(col, alpha);
}
`;

const GLOW_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vCenter;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const GLOW_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vCenter;
uniform float uRs;
uniform vec3 uGlowCol;
${GLOW_GLSL}
void main() {
  vec3 ro = (cameraPosition - vCenter) / uRs;
  vec3 rd = normalize(vWorld - cameraPosition);
  gl_FragColor = vec4(uGlowCol * glowLine(ro, rd), 1.0);
}
`;

const REF = new THREE.Vector3();
const CENTER = new THREE.Vector3();
const CAM = new THREE.Vector3();
const GLOW_RGB = new THREE.Vector3(1.0, 0.3, 0.07);

function screenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

export function BlackHole({ body }: { body: Body }) {
  const shellRef = useRef<THREE.Mesh>(null);
  const screenRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const skyVer = useRef(-1);

  const res = useMemo(() => {
    const shellGeo = new THREE.SphereGeometry(1, 48, 32);
    const glowGeo = new THREE.SphereGeometry(1, 32, 16);
    const triGeo = screenTriangle();
    const shared = {
      uSky: { value: null as THREE.CubeTexture | null },
      uHasSky: { value: 0 },
      uCubeHalf: { value: Q.cube / 2 },
      uRs: { value: 1 },
      uShell: { value: SHELL },
      uNormal: { value: new THREE.Vector3(0, 1, 0) },
      uD1: { value: new THREE.Vector3(1, 0, 0) },
      uD2: { value: new THREE.Vector3(0, 0, -1) },
      uHeat: { value: 1 },
      uExposure: { value: 1 },
      uGlowCol: { value: GLOW_RGB.clone().multiplyScalar(GLOW_I) },
      uTime: { value: 0 },
      uSpin: { value: 1 },
      uFx: { value: PHYSICS_FX },
      uDphi: { value: DPHI },
      uK: { value: KREL },
      uSeed: { value: 0 },
    };
    const lensProps = {
      fragmentShader: FRAG,
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
    } as const;
    const shellMat = new THREE.ShaderMaterial({
      ...lensProps,
      vertexShader: VERT_SHELL,
      side: THREE.BackSide,
      uniforms: { ...shared, uActive: { value: 1 } },
    });
    const screenMat = new THREE.ShaderMaterial({
      ...lensProps,
      vertexShader: VERT_SCREEN,
      side: THREE.DoubleSide,
      defines: { SCREEN: '' },
      uniforms: { ...shared, uActive: { value: 0 } },
    });
    const glowMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      transparent: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uRs: shared.uRs, uGlowCol: shared.uGlowCol },
    });
    return { shellGeo, glowGeo, triGeo, shared, shellMat, screenMat, glowMat };
  }, []);

  useEffect(() => () => {
    res.shellGeo.dispose(); res.glowGeo.dispose(); res.triGeo.dispose();
    res.shellMat.dispose(); res.screenMat.dispose(); res.glowMat.dispose();
  }, [res]);

  useFrame(({ clock, camera }) => {
    const shell = shellRef.current, screen = screenRef.current, glow = glowRef.current;
    if (!shell || !screen || !glow) return;
    place(shell, body);
    place(screen, body);
    place(glow, body);
    const rs = Math.max(body.rs || body.radius, 1e-3);
    shell.scale.setScalar(rs * SHELL);
    glow.scale.setScalar(rs * GLOW_R);

    // Close up, the full-screen lens takes over from the shell sphere (both
    // stay mounted so neither ever compiles mid-flight; the idle one emits
    // no fragments).
    CENTER.copy(shell.position);
    if (shell.parent) CENTER.applyMatrix4(shell.parent.matrixWorld);
    if (camera.parent) camera.getWorldPosition(CAM); else CAM.copy(camera.position);
    const camR = CAM.distanceTo(CENTER) / rs;
    const near = camR < SHELL * NEAR_SWITCH;
    res.shellMat.uniforms.uActive.value = near ? 0 : 1;
    res.screenMat.uniforms.uActive.value = near ? 1 : 0;

    const u = res.shared;
    if (skyVer.current !== sky.version) {
      skyVer.current = sky.version;
      u.uSky.value = sky.a;
      u.uHasSky.value = sky.a ? 1 : 0;
    }
    u.uRs.value = rs;
    const n = u.uNormal.value;
    n.set(body.normal.x, body.normal.y, body.normal.z);
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
    n.normalize();
    // Disc-plane basis with d1 x d2 = n, so azimuth grows with the orbit.
    const d1 = u.uD1.value;
    if (Math.abs(n.y) < 0.9) REF.set(0, 1, 0); else REF.set(1, 0, 0);
    d1.crossVectors(n, REF).normalize();
    u.uD2.value.crossVectors(n, d1);
    // Hotter holes burn a little brighter (7000 K is the reference).
    const heat = Math.min(1.25, Math.max(0.85, Math.pow((body.temp || 7000) / 7000, 0.5)));
    u.uHeat.value = heat;
    // Like an eye or a camera, exposure drops when the disc fills the view,
    // so close up it stays richly coloured instead of blooming to white.
    const e = Math.min(1, Math.max(0, (camR - 4) / 18));
    u.uExposure.value = 0.5 + 0.5 * e * e * (3 - 2 * e);
    // The glow is for seeing the hole from afar; close up it would only wash
    // the disc out, so it eases down (smoothly: no pop).
    const k = Math.min(1, Math.max(0, (camR - 7) / 22));
    u.uGlowCol.value.copy(GLOW_RGB).multiplyScalar(GLOW_I * heat * (0.15 + 0.85 * k * k * (3 - 2 * k)));
    u.uTime.value = clock.elapsedTime;
    u.uSpin.value = C / rs; // geometric time units (rs / c) per second
    u.uFx.value = PHYSICS_FX;
    u.uSeed.value = (body.seed % 1000) * 0.137;
  });

  return (
    <>
      <mesh ref={glowRef} geometry={res.glowGeo} material={res.glowMat} renderOrder={-11} />
      <mesh ref={shellRef} geometry={res.shellGeo} material={res.shellMat} renderOrder={-10} />
      <mesh ref={screenRef} geometry={res.triGeo} material={res.screenMat} renderOrder={-10} frustumCulled={false} />
    </>
  );
}
