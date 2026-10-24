// Shaders for the pulsar rescue site (Pulsar.tsx). All original code.
//
// Beams: a closed cone mesh drawn back-faces-only is just a rasteriser for
// the pixels the beam can cover. Each pixel intersects its view ray with the
// exact hazard volume (half-angle BEAM_HALF_ANGLE, reach BEAM_LENGTH, a cone
// capped by a sphere, as beamOn() tests it) and shades the chord
// analytically: a soft body, a crisp axial filament and a faint sheath that
// peaks just inside the danger edge and falls to zero exactly on it. No
// ray-march, so no banding and it costs one small fbm per pixel.

import { NOISE_GLSL } from '../sky';

// Value noise that repeats in z with an integer period, so the outward flow
// can scroll forever (the scroll offset wraps on the CPU) without a pop.
const PERIODIC_NOISE = /* glsl */ `
float pvn(vec3 p, float per) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec3 a = vec3(i.xy, mod(i.z, per));
  vec3 b = vec3(i.xy, mod(i.z + 1.0, per));
  float n000 = h31(a);
  float n100 = h31(a + vec3(1.0, 0.0, 0.0));
  float n010 = h31(a + vec3(0.0, 1.0, 0.0));
  float n110 = h31(a + vec3(1.0, 1.0, 0.0));
  float n001 = h31(b);
  float n101 = h31(b + vec3(1.0, 0.0, 0.0));
  float n011 = h31(b + vec3(0.0, 1.0, 0.0));
  float n111 = h31(b + vec3(1.0, 1.0, 0.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
`;

/** Period, in noise cells, of the beam flow along its length. */
export const FLOW_PERIOD = 64;

export const BEAM_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export function beamFrag(oct: number): string {
  return /* glsl */ `
uniform vec3 uCam;      // camera in beam space: apex at 0, beam along +y
uniform float uScroll;  // outward flow offset, wrapped to FLOW_PERIOD
uniform float uSeed;
uniform float uBright;
uniform float uL;       // BEAM_LENGTH
uniform float uTan;     // tan(BEAM_HALF_ANGLE)
uniform float uPix;     // radians per device pixel
varying vec3 vLocal;
${NOISE_GLSL}
${PERIODIC_NOISE}

float flowNoise(vec3 p) {
  float s = 0.0;
  float amp = 0.5;
  float per = ${FLOW_PERIOD.toFixed(1)};
  for (int i = 0; i < ${oct}; i++) {
    s += amp * pvn(p, per);
    p = vec3(p.xy * 2.0 + 17.3, p.z * 2.0);
    per *= 2.0;
    amp *= 0.5;
  }
  return s;
}

void main() {
  vec3 o = uCam;
  vec3 d = normalize(vLocal - o);

  // View ray against the cone x^2 + z^2 = k y^2, upper nappe only.
  float k = uTan * uTan;
  float a = dot(d.xz, d.xz) - k * d.y * d.y;
  float b = dot(o.xz, d.xz) - k * o.y * d.y;
  float c = dot(o.xz, o.xz) - k * o.y * o.y;
  float disc = b * b - a * c;
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float q = -(b + (b >= 0.0 ? sq : -sq));
  float aa = a >= 0.0 ? max(a, 1e-8) : min(a, -1e-8);
  float r1 = q / aa;
  float r2 = c / q;
  float t0 = min(r1, r2);
  float t1 = max(r1, r2);
  float tIn = t0;
  float tOut = t1;
  if (a >= 0.0) {
    if (o.y + d.y * 0.5 * (t0 + t1) <= 0.0) discard; // the mirror nappe
  } else if (d.y > 0.0) {
    tIn = t1; tOut = 1e9;
  } else {
    tIn = -1e9; tOut = t0;
  }

  // The beam's reach is a sphere of radius uL, exactly as the hazard tests it.
  float sb = dot(o, d);
  float sd = sb * sb - (dot(o, o) - uL * uL);
  if (sd <= 0.0) discard;
  float ss = sqrt(sd);
  tIn = max(max(tIn, -sb - ss), 0.0);
  tOut = min(tOut, -sb + ss);
  if (tOut <= tIn) discard;

  // Closest approach to the beam axis inside the chord.
  float chord = tOut - tIn;
  float dd = dot(d.xz, d.xz);
  float ts = dd > 1e-6 ? -dot(o.xz, d.xz) / dd : tIn;
  ts = clamp(ts, tIn, tOut);
  vec3 p = o + d * ts;
  float y = max(p.y, 1e-3);
  float rad = y * uTan;                            // danger radius here
  float u = min(length(p.xz) / max(rad, 1e-3), 1.0); // 0 on axis, 1 on the edge
  float h2 = 1.0 - u * u;
  float h = sqrt(h2);
  float r = length(p);
  float R = rad + 0.35;
  float path = min(chord / R, 10.0);               // chord in beam radii
  float obl = clamp(chord / (2.0 * R * max(h, 0.25)), 1.0, 3.0);
  float px = rad / max(uPix * ts, 1e-4);           // beam radius in pixels
  float near = exp(-r / 22.0);
  // Body and filament ease out over the last tenth of the reach; the danger
  // edge rails stay until the very end so the true limit still reads.
  float env = uBright * (1.0 - smoothstep(uL * 0.88, uL, r));
  float envEdge = uBright * (1.0 - smoothstep(uL * 0.97, uL, r));

  // Streaky light flowing outward, in coordinates that ride the cone.
  vec2 ang = p.xz / (rad + 0.5);
  float n = flowNoise(vec3(ang * 2.3 + uSeed, r * 0.011 - uScroll));
  float flow = 0.3 + n * 1.6;

  // Soft body: a faint flat floor plus a centre-weighted profile, integrated
  // over the chord.
  float body = path * (0.08 + 0.62 * h2 * h2) * flow
             * (0.12 + 0.88 * exp(-r / 170.0)) * (1.0 + 2.5 * exp(-r / 45.0) + 3.0 * near);

  // Axial filament, widened (energy kept) once it would go sub-pixel.
  float fw = 1.0 / max(px, 1e-3);
  float w = 0.010 + 2.0 * fw * fw;
  float core = exp(-u * u / w) * sqrt(0.010 / w) * obl
             * (0.12 + 0.88 * exp(-r / 120.0)) * (1.0 + 4.0 * exp(-r / 35.0) + 4.0 * near) * 1.8;

  // Sheath: chord through a shell between 0.88 and 1.0 of the danger radius.
  // Brightest at 0.88, exactly zero on the edge, so the edge reads crisply
  // without an aliased silhouette.
  float shell = (h - sqrt(max(0.7744 - u * u, 0.0))) / 0.4750;
  float sheath = shell * obl * (0.3 + 0.7 * exp(-r / 250.0)) * 0.35 * smoothstep(2.0, 8.0, px);

  vec3 col = env * (body * vec3(0.15, 0.44, 1.0) + core * vec3(0.62, 0.84, 1.0))
            + envEdge * sheath * vec3(0.32, 0.50, 1.0);
  col = 7.0 * (vec3(1.0) - exp(-col / 7.0)); // soft ceiling for the in-beam flash
  gl_FragColor = vec4(col, 1.0);
}
`;
}

// Impact preview: a hairline ring on each sweep cone at the pod's distance.
// The arc just ahead of each beam brightens (where it is about to pass), the
// arc it just left goes dark (the safe gap). The tube is inflated in the
// vertex shader so it never gets thinner than about a pixel.
export const RING_VERT = /* glsl */ `
attribute vec3 aRing;   // phi around the spin axis, psi around the tube, side (+1/-1)
uniform float uRadius;  // slant distance from the star
uniform float uCosT;    // cos/sin of the beam's tilt from the spin axis
uniform float uSinT;
uniform float uPix;
varying float vPhi;
varying float vSide;
varying float vFacing;
varying float vDist;
void main() {
  float phi = aRing.x;
  float psi = aRing.y;
  float side = aRing.z;
  vec3 radial = vec3(cos(phi), 0.0, sin(phi));
  vec3 centre = radial * (uRadius * uSinT) + vec3(0.0, side * uRadius * uCosT, 0.0);
  vec3 wc = (modelMatrix * vec4(centre, 1.0)).xyz;
  float dist = length(cameraPosition - wc);
  float w = max(0.035, 0.9 * uPix * dist);
  vec3 n = cos(psi) * radial + sin(psi) * vec3(0.0, 1.0, 0.0);
  vec3 wp = (modelMatrix * vec4(centre + n * w, 1.0)).xyz;
  vec3 wn = normalize(mat3(modelMatrix) * n);
  vFacing = abs(dot(wn, normalize(cameraPosition - wp)));
  vPhi = phi;
  vSide = side;
  vDist = dist;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const RING_FRAG = /* glsl */ `
uniform float uPhaseA;  // azimuth of the +axis beam on its ring
uniform float uPhaseB;  // azimuth of the -axis beam on its ring
uniform float uDir;     // +1 or -1: which way the beams move in phi
uniform float uI;
varying float vPhi;
varying float vSide;
varying float vFacing;
varying float vDist;
const float TAU = 6.28318530718;
void main() {
  float beam = vSide > 0.0 ? uPhaseA : uPhaseB;
  float ahead = mod(uDir * (vPhi - beam), TAU); // radians until the beam gets here
  float lead = exp(-ahead / 1.6);
  float trail = exp(-(TAU - ahead) / 0.22);
  float I = 0.16 + 0.95 * lead + 0.6 * trail;
  float far = mix(1.0, 0.35, smoothstep(250.0, 700.0, vDist));
  vec3 col = vec3(0.62, 0.8, 1.0) * I * pow(vFacing, 1.5) * uI * far;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Pulsar wind nebula: a soft, slowly turning torus in the spin equator with a
// faint inner wind glow, blue inside going violet outside. Ray-marched inside
// a bounding sphere clipped to a slab around the equator.
export const NEB_VERT = BEAM_VERT;

export function nebFrag(steps: number, oct: number): string {
  return /* glsl */ `
uniform vec3 uCam;     // camera in nebula space: spin axis along +y
uniform vec2 uRot;     // cos/sin of the swirl angle
uniform float uSeed;
uniform float uRt;     // torus radius
uniform float uRb;     // bounding sphere radius
uniform float uI;
varying vec3 vLocal;
${NOISE_GLSL}
void main() {
  vec3 o = uCam;
  vec3 d = normalize(vLocal - o);
  float sb = dot(o, d);
  float sd = sb * sb - (dot(o, o) - uRb * uRb);
  if (sd <= 0.0) discard;
  float ss = sqrt(sd);
  float t0 = max(-sb - ss, 0.0);
  float t1 = -sb + ss;
  float H = uRt * 0.7;
  if (abs(d.y) > 1e-4) {
    float ta = (-H - o.y) / d.y;
    float tb = (H - o.y) / d.y;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (abs(o.y) > H) {
    discard;
  }
  if (t1 <= t0) discard;
  float dt = (t1 - t0) / ${steps.toFixed(1)};
  float j = fract(gl_FragCoord.x * 0.7548776662 + gl_FragCoord.y * 0.5698402910);
  float inv = 1.0 / uRt;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${steps}; i++) {
    vec3 p = (o + d * (t0 + (float(i) + j) * dt)) * inv; // in torus radii
    float rc = length(p.xz);
    float dr = (rc - 1.0) / 0.30;
    float dy = p.y / (0.13 + 0.12 * rc);
    float tor = exp(-(dr * dr + dy * dy));
    float wind = exp(-rc * rc / 0.30 - p.y * p.y / 0.035) * 0.7;
    float m = tor + wind;
    if (m < 0.004) continue;
    vec3 q = vec3(uRot.x * p.x - uRot.y * p.z, p.y, uRot.y * p.x + uRot.x * p.z);
    float n = fbm(q * 2.6 + uSeed, ${oct});
    float rho = m * (0.2 + 2.2 * n * n);
    vec3 tint = mix(vec3(0.42, 0.6, 1.0), vec3(0.6, 0.44, 1.0), smoothstep(0.55, 1.35, rc));
    acc += tint * rho;
  }
  gl_FragColor = vec4(acc * dt * inv * uI, 1.0);
}
`;
}

// The neutron star: blue-white HDR disc, gently limb-darkened, with hot
// polar caps on the magnetic axis so you can see where the beams come from.
export const CORE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vVN;
varying vec3 vVP;
void main() {
  vN = normal;
  vVN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vVP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const CORE_FRAG = /* glsl */ `
uniform vec3 uAxis;   // magnetic axis (world orientation; the mesh is unrotated)
uniform float uI;
uniform float uFlash;
varying vec3 vN;
varying vec3 vVN;
varying vec3 vVP;
void main() {
  vec3 n = normalize(vN);
  float mu = clamp(dot(normalize(vVN), normalize(-vVP)), 0.0, 1.0);
  float limb = 0.6 + 0.4 * mu;
  float cap = smoothstep(0.80, 0.97, abs(dot(n, uAxis)));
  vec3 col = vec3(0.72, 0.82, 1.0) * uI * limb * (1.0 + 1.2 * uFlash);
  col += vec3(0.92, 0.96, 1.0) * uI * 2.5 * cap;
  gl_FragColor = vec4(col, 1.0);
}
`;

// A tight camera-facing glow around the star. It flares when a beam sweeps
// across the line of sight: the lighthouse blink, readable from any range.
export const GLOW_VERT = /* glsl */ `
uniform float uSize;  // half-size, world units
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

export const GLOW_FRAG = /* glsl */ `
uniform float uI;
uniform float uFlash;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float g = exp(-r * r * 30.0) * 1.6 + exp(-r * 9.0) * 0.1;
  g *= 1.0 - smoothstep(0.7, 1.0, r);
  vec3 col = vec3(0.62, 0.78, 1.0) * g * uI * (1.0 + 5.0 * uFlash);
  gl_FragColor = vec4(col, 1.0);
}
`;
