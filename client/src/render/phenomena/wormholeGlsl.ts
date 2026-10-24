// Shaders and metric helpers for the wormhole rescue site (Wormhole.tsx and
// ExitWell.tsx). No React here, so the GLSL can be built and checked alone.
//
// The lens traces light through the "Dneg" wormhole of
//   O. James, E. von Tunzelmann, P. Franklin & K. S. Thorne,
//   "Visualizing Interstellar's Wormhole", Am. J. Phys. 83, 486 (2015),
//   arXiv:1502.03809.
// Metric: ds^2 = -dt^2 + dl^2 + r(l)^2 (dθ^2 + sin^2θ dφ^2), with
//   r = ρ                                  for |l| <= a  (a cylindrical tunnel)
//   r = ρ + M [x atan x - ½ ln(1 + x^2)]   for |l| >  a,  x = 2(|l| - a) / (π M)
//   dr/dl = sign(l) (2/π) atan x.
// A ray stays in one plane through the centre, so each pixel is a 2D problem
// in (l, φ) with the impact parameter b conserved:
//   dl/ds = p_l,   dφ/ds = b / r^2,   dp_l/ds = b^2 (dr/dl) / r^3.
// We integrate that per pixel (our own code: leapfrog in s with a step
// proportional to r, and an exact jump through the tunnel where nothing
// bends). Rays ending at l < 0 see this side's sky, l > 0 the other side's.
// Everything is in throat radii (ρ = 1).

/** Tunnel half-length a and lensing width M, in throat radii. */
export const WH_A = 0.1;
export const WH_M = 0.4;
/** Lens shell radius in throat radii. Rays are only bent inside it. */
export const WH_SHELL = 4;

/** r(l) of the Dneg wormhole, throat radius 1. */
export function whR(l: number): number {
  const L = Math.abs(l);
  if (L <= WH_A) return 1;
  const x = (2 * (L - WH_A)) / (Math.PI * WH_M);
  return 1 + WH_M * (x * Math.atan(x) - 0.5 * Math.log1p(x * x));
}

/**
 * |l| where r(l) = r. Our flat game world has points closer to the centre
 * than the throat (r < 1); those map linearly into the tunnel so the view is
 * continuous right up to the moment the ship drops through.
 */
export function whL(r: number): number {
  if (!(r > 1)) return WH_A * Math.max(0, r);
  const y = (r - 1) / WH_M;
  let lo = 0, hi = 2 * y + 4; // g(x) = x atan x - ½ ln(1+x^2) is increasing, g(hi) > y
  for (let i = 0; i < 48; i++) {
    const x = 0.5 * (lo + hi);
    if (x * Math.atan(x) - 0.5 * Math.log1p(x * x) < y) lo = x; else hi = x;
  }
  return WH_A + 0.25 * Math.PI * WH_M * (lo + hi);
}

const f = (n: number) => n.toFixed(5);

/** Shared by both lens shells: world position and the shell centre. */
export const LENS_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vCenter;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export interface WormholeLensOpts {
  steps: number; // integration steps (constant loop bound)
  k: number; // step = k * r
  oct: number; // swirl noise octaves
  bias: number; // cubemap LOD bias
  cube: number; // sky cubemap face size, texels
  aniso: number; // sky taps per pixel along the squeeze (1 = plain mip)
  noise: string; // NOISE_GLSL
}

/**
 * The mouth: a back-faced sphere whose fragments integrate their ray through
 * the metric, then sample this side's sky (uHere) or the other side's
 * (uThere). On top, a thin blue-white rim at the throat's apparent edge
 * (b = 1) and a faint slow swirl just outside it, so it reads as a door.
 */
export function wormholeLensFrag(o: WormholeLensOpts): string {
  return /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vCenter;
uniform samplerCube uHere;
uniform samplerCube uThere;
uniform float uHasHere;
uniform float uHasThere;
uniform float uRho;     // throat radius, world units
uniform float uShell;   // shell radius, throat radii
uniform float uLShell;  // |l| at the shell
uniform float uLCam;    // the camera's l (<= 0), used when it is inside the shell
uniform float uSwirl;   // swirl clock: the mouth's own time, seconds
uniform float uSpin;    // swirl direction, +1 or -1
uniform float uPulse;   // -1..1, the mouth's slow heartbeat
uniform vec3 uThereGrade; // art grade on the far side's light (1,1,1 = untouched)
uniform float uFx;
uniform float uSeed;

#define STEPS ${Math.max(8, Math.round(o.steps))}
#define KSTEP ${f(o.k)}
#define WH_A ${f(WH_A)}
#define WH_M ${f(WH_M)}
#define LOD_BIAS ${o.bias.toFixed(2)}
#define TEXELS ${f(Math.max(16, o.cube) / (Math.PI / 2))}
#define ANISO ${Math.max(1, Math.round(o.aniso))}
#define PI 3.14159265

${o.noise}

// (r, dr/dl) at l.
vec2 whR(float l) {
  float L = abs(l);
  if (L <= WH_A) return vec2(1.0, 0.0);
  float x = (L - WH_A) * (2.0 / (PI * WH_M));
  float r = 1.0 + WH_M * (x * atan(x) - 0.5 * log(1.0 + x * x));
  return vec2(r, sign(l) * (2.0 / PI) * atan(x));
}

vec3 safeNorm(vec3 v) { return v / max(length(v), 1e-6); }

void main() {
  vec3 ro = (cameraPosition - vCenter) / uRho;
  vec3 rd = normalize(vWorld - cameraPosition);
  float camD = length(ro);

  // Start at the shell entry (camera outside) or at the camera itself.
  vec3 p0 = ro;
  float l = uLCam;
  if (camD > uShell) {
    float bq = dot(ro, rd);
    float c = camD * camD - uShell * uShell;
    float t0 = -bq - sqrt(max(bq * bq - c, 0.0));
    p0 = ro + rd * max(t0, 0.0);
    l = -uLShell;
  }

  // The ray's plane: er points away from the centre, et along the ray's sideways motion.
  float p0len = length(p0);
  vec3 er = p0len > 1e-5 ? p0 / p0len : vec3(0.0, 0.0, 1.0);
  float nr = dot(rd, er);
  vec3 tv = rd - nr * er;
  float nt = length(tv);
  vec3 alt = abs(er.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 et = nt > 1e-5 ? tv / nt : safeNorm(cross(er, alt));

  vec2 rr = whR(l);
  float b = rr.x * nt;   // impact parameter, conserved
  float b2 = b * b;
  float pl = -nr;        // this side is l < 0, so outward is -l
  float phi = 0.0;
  float F = b2 * rr.y / (rr.x * rr.x * rr.x);
  float done = 0.0;

  for (int i = 0; i < STEPS; i++) {
    if (abs(l) < WH_A) {
      // Inside the tunnel r = 1 and nothing bends: go straight to its end.
      float sp = pl >= 0.0 ? max(pl, 1e-5) : min(pl, -1e-5);
      float tgt = sp > 0.0 ? WH_A + 1e-4 : -WH_A - 1e-4;
      float ds = min((tgt - l) / sp, 40.0);
      phi += b * ds;
      l += sp * ds;
      rr = whR(l);
      F = b2 * rr.y / (rr.x * rr.x * rr.x);
      continue;
    }
    // Leapfrog, kick-drift-kick, step proportional to r.
    float h = KSTEP * rr.x;
    pl += 0.5 * h * F;
    l += h * pl;
    vec2 rn = whR(l);
    phi += h * b * 0.5 * (1.0 / (rr.x * rr.x) + 1.0 / (rn.x * rn.x));
    F = b2 * rn.y / (rn.x * rn.x * rn.x);
    pl += 0.5 * h * F;
    rr = rn;
    if (abs(l) > uLShell && pl * l > 0.0) { done = 1.0; break; }
  }

  // Out-going direction as an angle in the ray's plane. The other mouth is
  // glued antipodally (a ray flown straight in comes straight out, as the
  // game's jump does), which is a half turn in this plane.
  bool there = l > 0.0;
  float nrF = there ? pl : -pl;
  float ntF = b / rr.x;
  float th0 = atan(nt, nr);
  float thF = phi + atan(ntF, nrF) + (there ? PI : 0.0);
  // This side's bending tapers to nothing at the shell so its edge is invisible.
  float k = uFx * (there ? 1.0 : 1.0 - smoothstep(1.35, uShell, b));
  float th = th0 + (thF - th0) * k;
  vec3 dir = cos(th) * er + sin(th) * et;

  // The pixel's footprint on the sky. Near the rim the image is squeezed
  // hard one way and barely the other, and one mip would smear the rings
  // along their length. So filter by hand: a few taps along the footprint's
  // long axis, each at the mip of its short axis.
  vec3 ddx = dFdx(dir), ddy = dFdy(dir);
  float ja = dot(ddx, ddx), jd = dot(ddy, ddy), jc = dot(ddx, ddy);
  float jt = 0.5 * (ja + jd);
  float jq = sqrt(max(0.25 * (ja - jd) * (ja - jd) + jc * jc, 0.0));
  float l1 = jt + jq, l2 = max(jt - jq, 0.0);
  vec2 ev = abs(jc) > 1e-14 ? vec2(jc, l1 - ja) : (ja >= jd ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  ev /= max(length(ev), 1e-14);
  vec3 major = ddx * ev.x + ddy * ev.y;
  float lod = clamp(log2(max(sqrt(l1) / float(ANISO), sqrt(l2)) * TEXELS + 1e-6) + LOD_BIAS, 0.0, 8.0);
  vec3 col = vec3(0.0);
  for (int j = 0; j < ANISO; j++) {
    vec3 dj = dir + major * ((float(j) + 0.5) / float(ANISO) - 0.5);
    if (there) col += textureLod(uThere, dj, lod).rgb;
    else col += textureLod(uHere, dj, lod).rgb;
  }
  col *= (there ? uHasThere * uThereGrade : vec3(uHasHere)) / float(ANISO);
  // Light still circling the throat when the step budget ran out (a hair
  // at b = 1, under the rim): a soft blend of both skies.
  vec3 fb = 0.5 * (textureLod(uHere, er, 6.0).rgb * uHasHere + textureLod(uThere, -er, 6.0).rgb * uHasThere * uThereGrade);
  col = mix(fb, col, done);

  // The doorway: a thin rim at the throat's apparent edge and a faint swirl
  // that drifts in toward it. Off when the camera is in the throat itself.
  float bw = fwidth(b);
  float tc = -dot(ro, rd);
  float gate = step(0.0, tc) * smoothstep(1.05, 1.7, camD);
  float x = b - 1.0;
  float soft = x > 0.0 ? exp(-x / 0.2) : exp(x / 0.04);
  if (gate * soft > 0.002) {
    float w = max(0.01, bw * 1.3);
    float ring = exp(-x * x / (w * w));
    vec3 pc = ro + rd * tc;
    vec3 fw = safeNorm(-ro);
    vec3 e1 = safeNorm(cross(fw, abs(fw.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(fw, e1);
    float ang = uSpin * atan(dot(pc, e2), dot(pc, e1));
    float lr = log(max(b, 0.05));
    float arms = 0.5 + 0.5 * sin(2.0 * ang + 8.0 * lr + 0.45 * uSwirl);
    float a2 = ang + 2.5 * lr + 0.22 * uSwirl;
    float n = fbm(vec3(1.7 * cos(a2), 1.7 * sin(a2), 3.0 * lr) + uSeed, ${Math.max(1, Math.round(o.oct))});
    float swirl = smoothstep(0.25, 0.95, mix(arms, n, 0.45));
    vec3 glow = vec3(0.85, 0.93, 1.0) * 1.7 * ring * (0.85 + 0.3 * n) * (0.9 + 0.1 * uPulse)
              + vec3(0.52, 0.72, 1.0) * soft * (0.05 + 0.5 * swirl);
    col += glow * gate;
  }

  // Opaque only where the light is visibly bent (more than ~2 px), then
  // transparent: no doubled stars where the bending dies away, and a lens
  // overlapping this one still shows through. Always gone by the shell edge.
  float pixA = max(length(fwidth(rd)) * 0.7, 1e-6);
  float bend = there ? 1e3 : abs(th - th0);
  float alpha = min(clamp(bend / (2.0 * pixA), 0.0, 1.0), 1.0 - smoothstep(0.9 * uShell, 0.99 * uShell, b));
  gl_FragColor = vec4(col, alpha);
}
`;
}

/** A small camera-facing glow of fixed pixel size: the mouth seen from far away. */
export const BEACON_VERT = /* glsl */ `
uniform vec2 uRes;
uniform float uPx;
varying vec2 vQ;
void main() {
  vQ = position.xy;
  vec4 c = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += position.xy * (2.0 * uPx / uRes) * c.w;
  gl_Position = c;
}
`;

export const BEACON_FRAG = /* glsl */ `
uniform float uI;
varying vec2 vQ;
void main() {
  float r = length(vQ);
  float core = exp(-r * r * 80.0);
  float halo = exp(-r * 4.5) * (1.0 - smoothstep(0.6, 1.0, r));
  vec3 col = vec3(0.86, 0.94, 1.0) * 3.2 * core + vec3(0.5, 0.72, 1.0) * 0.32 * halo;
  gl_FragColor = vec4(col * uI, 1.0);
}
`;

// --- the heavy dark mass beside the exit -----------------------------------

/** Lens shell radius around the dark mass, in body radii. */
export const WELL_SHELL = 3.5;

export const WELL_BALL_VERT = /* glsl */ `
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

/** Near-black body: a dark heart and a faint deep red-brown limb. */
export function wellBallFrag(oct: number, noise: string): string {
  return /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
${noise}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float mu = abs(dot(normalize(vN), V));
  float limb = pow(1.0 - mu, 2.5);
  float n = fbm(vObj * 2.6 + vec3(uSeed, uTime * 0.025, 0.0), ${Math.max(1, Math.round(oct))});
  vec3 ember = vec3(0.30, 0.075, 0.032);
  vec3 col = ember * (limb * 0.6 + 0.01) * (0.45 + 1.1 * n);
  col *= 1.0 - 0.95 * smoothstep(0.35, 0.95, mu); // dark heart
  gl_FragColor = vec4(col, 1.0);
}
`;
}

/**
 * Weak lensing around the dark mass: the sky behind is bent toward it by
 * uK * R / b (the 2 r_s / b of a point mass, kept small), only the part of
 * the bend still ahead of the camera, tapering to nothing at the shell. Plus
 * a breath of red-brown light hugging the limb. The body itself is a
 * separate opaque mesh, so it hides the stars behind it.
 */
export function wellLensFrag(oct: number, noise: string): string {
  return /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vCenter;
uniform samplerCube uSky;
uniform float uHasSky;
uniform float uR;     // body radius, world units
uniform float uS;     // shell radius, world units
uniform float uK;     // bend at the limb, radians
uniform float uFx;
uniform float uTime;
uniform float uSeed;
${noise}
void main() {
  vec3 ro = cameraPosition - vCenter;
  vec3 rd = normalize(vWorld - cameraPosition);
  float tc = -dot(ro, rd);
  vec3 pc = ro + rd * tc;
  float b = max(length(pc), 1e-4 * uR);
  vec3 toC = -pc / b;
  float ahead = 0.5 * (1.0 + tc / sqrt(tc * tc + b * b));
  float defl = uK * uR / max(b, uR) * ahead * (1.0 - smoothstep(0.3 * uS, uS, b)) * uFx;
  vec3 d = normalize(rd * cos(defl) + toC * sin(defl));
  vec3 col = texture(uSky, d).rgb * uHasSky;

  float x = (b - uR) / uR;
  // Continues the limb's glow outward (same ember, about half as bright at
  // the edge) so the body has no drawn outline.
  float halo = exp(-max(x, 0.0) * 4.0) * step(0.0, x) * step(0.0, tc);
  if (halo > 0.002) {
    float n = fbm(toC * 2.2 + vec3(uSeed, x * 1.5, uTime * 0.02), ${Math.max(1, Math.round(oct))});
    col += vec3(0.30, 0.075, 0.032) * 0.3 * halo * (0.45 + 1.1 * n);
  }

  // Opaque only where the bend is visible (see the wormhole lens), so the
  // shell never paints plain sky over a neighbouring lens.
  float pixA = max(length(fwidth(rd)) * 0.7, 1e-6);
  float alpha = min(clamp(max(defl, halo * 0.05) / (2.0 * pixA), 0.0, 1.0), 1.0 - smoothstep(0.9 * uS, 0.99 * uS, b));
  gl_FragColor = vec4(col, alpha);
}
`;
}
