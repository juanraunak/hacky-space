// A dark matter halo: invisible mass, visible only by how it bends starlight.
//
// A back-faced lens shell around the cloud. Each fragment's view ray is bent
// toward the centre by a thin-lens deflection from a softened, NFW-like
// profile, alpha(b) = A0 * b / (b + core), tapered smoothly to zero at the
// cloud edge, and the baked sky is looked up along the bent direction. The
// lens is supercritical, so a tangential critical curve (the Einstein ring)
// circles the centre: stars near it smear into tangential arcs, and a source
// that lines up becomes a full ring. Flying in, the ring shrinks onto the
// hidden centre and closes about a third of the way from the edge; at the
// centre itself the rays run radially and the sky relaxes to normal.
//
// The shell covers the mid-layer point stars, so it draws its own: procedural
// point stars hashed on the BENT direction, filtered through the pixel's
// anisotropic footprint in the source plane (2x2 Jacobian from screen-space
// derivatives). That keeps them crisp and alias-free, makes magnified images
// brighter and stretched into arcs, and conserves flux like the real thing.
// The cubemap is sampled with explicit gradients so squeezed regions use the
// right mip instead of shimmering.
//
// The haze is a Gaussian column of brownish dust integrated analytically along
// the visible part of the ray (camera outside or inside), with faint wisps:
// a few percent at most. Output is premultiplied so the lens can replace the
// sky while the dust only attenuates what is behind it.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { sky, NOISE_GLSL, BLACKBODY_GLSL } from '../sky';
import { LAPTOP } from '../quality';
import { PHYSICS_FX } from '../../game/constants';

// --- tuning ----------------------------------------------------------------
const LENS_K = 0.046; // x radius: lens strength (Plummer deflection K b / (b^2 + c^2), rad)
const LENS_CORE = 0.47; // x body.core: lens softening c; the ring closes ~K/c^2... inside ~70 units
const EDGE0 = 0.7; // x radius: final smooth roll-off to exactly zero bending at the edge
const FAR = 4.2; // x radius: beyond this the bending falls as 1/D (the ring stays inside the cloud)
const HAZE_TAU = 0.07; // optical depth of the dust straight through the centre
const HAZE_R = 1.1; // x body.core: Gaussian scale of the dust

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
uniform float uEdge0;
uniform float uK;
uniform float uFar;
uniform float uHaze;
uniform float uHazeR;
uniform float uTime;
uniform vec3 uSeedV;

#define LAPTOP ${LAPTOP ? 1 : 0}
#define MRAD 1000.0
#define FOOT_K 0.3

${NOISE_GLSL}
${BLACKBODY_GLSL}

float erfa(float x) {
  float x2 = x * x;
  float t = sqrt(1.0 - exp(-x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2)));
  return x < 0.0 ? -t : t;
}

vec3 starTemp(float t) {
  float k = t < 0.6 ? mix(2800.0, 5000.0, t / 0.6)
          : t < 0.9 ? mix(5000.0, 8000.0, (t - 0.6) / 0.3)
          : mix(8000.0, 26000.0, (t - 0.9) / 0.1);
  return blackbody(k);
}

// One layer of point stars on a 3D hash grid, sampled at source direction d.
// Footprint M = FOOT_K * J J^T in the tangent frame (e1, e2), in mrad^2; apx
// is the unlensed pixel solid angle, mrad^2. Each star is a Gaussian of
// intrinsic size sig (mrad) convolved with the footprint; the result is the
// share of its flux that lands in this pixel. sigCap keeps stars point-like
// where the lens magnifies in every direction (no bokeh blobs), while along a
// critical curve (one axis squeezed) they keep their size and become arcs.
vec3 starLayer(vec3 d, vec3 e1, vec3 e2, vec3 M, float apx, float sigCap, float S, float thr, float sig0, float sig1, float flux0, float tail) {
  vec3 p = d * S + uSeedV;
  vec3 base = floor(p - 0.5);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) {
    vec3 cc = base + vec3(float(i), float(j), float(k));
    float h = h31(cc);
    if (h < thr) continue;
    vec3 sp = cc + 0.2 + 0.6 * vec3(h31(cc + 1.37), h31(cc + 2.71), h31(cc + 4.13)) - uSeedV;
    float rl = length(sp);
    // Only stars close to the sampling sphere: then the 2x2x2 search always
    // finds them while they matter, so nothing is clipped at a cell edge.
    if (abs(rl - S) > 0.3) continue;
    vec3 dd = (sp / rl - d) * MRAD;
    vec2 q2 = vec2(dot(dd, e1), dot(dd, e2));
    float br = pow(h31(cc + 9.1), tail);
    float F = flux0 * (0.05 + 14.0 * br);
    float sg = min(mix(sig0, sig1, sqrt(br)), sigCap);
    float s2 = sg * sg;
    float a = s2 + M.x, c = s2 + M.z;
    float det = max(a * c - M.y * M.y, 1e-12);
    float qq = (q2.x * q2.x * c - 2.0 * q2.x * q2.y * M.y + q2.y * q2.y * a) / det;
    col += starTemp(h31(cc + 5.5)) * (F * apx * exp(-0.5 * qq) / (6.2831853 * sqrt(det)));
  }
  return col;
}

// Fade a layer out where the footprint approaches its cell size (strongly
// squeezed regions), so no star is ever cut off by the 2x2x2 search.
float layerFade(float lmax, float sig1, float S) {
  return 1.0 - smoothstep(0.12, 0.18, sqrt(sig1 * sig1 + lmax) * S / MRAD);
}

void main() {
  vec3 ro = cameraPosition - vCenter;
  vec3 rd = normalize(vWorld - cameraPosition);
  float r0 = max(length(ro), 1e-3 * uR);
  float tc = -dot(ro, rd);            // along the ray to closest approach
  vec3 pc = ro + rd * tc;             // closest point, relative to the centre
  float b = length(pc);

  // Share of the bending still ahead of the camera: a point-mass kernel over
  // the chord inside the cloud. 1 from outside; 0 for a ray leaving from the
  // shell surface, so crossing the edge never pops.
  float L = sqrt(max(uR * uR - b * b, 0.0));
  float ahead = r0 >= uR ? 1.0 : clamp(0.5 + 0.5 * (tc / r0) * (uR / max(L, 1e-3 * uR)), 0.0, 1.0);

  // Plummer (cored point-mass) deflection, minus a uniform sheet so it is
  // exactly zero at the edge, then rolled off smoothly there. Falls as 1/D
  // for far observers so the ring always sits well inside the cloud.
  float c2 = uCore * uCore;
  float prof = max(b / (b * b + c2) - b / (uR * uR + c2), 0.0);
  float edge = 1.0 - smoothstep(uEdge0 * uR, uR, b);
  float far = min(1.0, uFar / r0);
  float alpha = uK * far * prof * edge * ahead;

  // Rotate the ray toward the centre by alpha (thin lens, source at infinity).
  vec3 d = normalize(rd * cos(alpha) - pc * (sin(alpha) / max(b, 1e-5 * uR)));

  // Pixel footprint, before and after the lens.
  vec3 dx = dFdx(d), dy = dFdy(d);
  float apx = length(cross(dFdx(rd), dFdy(rd))) * MRAD * MRAD;
  vec3 e1 = normalize(cross(d, abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(d, e1);
  vec2 jx = vec2(dot(dx, e1), dot(dx, e2)) * MRAD;
  vec2 jy = vec2(dot(dy, e1), dot(dy, e2)) * MRAD;
  vec3 M = FOOT_K * vec3(jx.x * jx.x + jy.x * jy.x, jx.x * jx.y + jy.x * jy.y, jx.y * jx.y + jy.y * jy.y);
  float mh = 0.5 * (M.x + M.z), md = sqrt(0.25 * (M.x - M.z) * (M.x - M.z) + M.y * M.y);
  float lmax = mh + md, lmin = max(mh - md, 1e-9);   // footprint axes^2, mrad^2
  float sigCap = 0.5 * sqrt(lmax / FOOT_K);

  // Baked sky along the bent ray. Explicit gradients pick the right mip where
  // the lens squeezes; where it stretches hard (near the ring) a touch of
  // extra blur keeps the cubemap texels from showing as fine contour lines.
  float stretch = smoothstep(2.0, 10.0, sqrt(lmax / lmin));
  float gs = 1.0 + 0.8 * stretch;
  vec3 col = uHasSky > 0.5 ? textureGrad(uSky, d, dx * gs, dy * gs).rgb : vec3(0.0);

  // Lensed point stars: a sparse bright layer, a fuller faint one, and a
  // dense population too faint to see unless the lens magnifies it.
  vec3 st = starLayer(d, e1, e2, M, apx, sigCap, 34.0, 0.86, 0.25, 0.6, 2.4, 22.0) * layerFade(lmax, 0.6, 34.0);
#if LAPTOP
  st += starLayer(d, e1, e2, M, apx, sigCap, 120.0, 0.9, 0.18, 0.35, 1.6, 30.0) * layerFade(lmax, 0.35, 120.0);
  st += starLayer(d, e1, e2, M, apx, sigCap, 260.0, 0.95, 0.12, 0.2, 0.3, 30.0) * layerFade(lmax, 0.2, 260.0);
#endif
  col += st;

  // Only as opaque as the bending is visible, so the edge (and the centre,
  // where rays run radially) blends into the normal sky and point stars.
  float op = smoothstep(0.001, 0.008, alpha) * uHasSky;

  // Dust: Gaussian column along the visible part of the ray, with wisps.
  float hr = uHazeR;
  float column = exp(-0.5 * b * b / (hr * hr)) * 0.5 * (1.0 + erfa(tc / (hr * 1.41421356)));
  vec3 wp = (tc > 0.0 ? pc : ro) / hr;
#if LAPTOP
  float n = fbm(wp * 1.3 + uSeedV * 0.37 + vec3(0.0, 0.0, uTime * 0.004), 4);
#else
  float n = fbm(wp * 1.3 + uSeedV * 0.37 + vec3(0.0, 0.0, uTime * 0.004), 2);
#endif
  float tau = uHaze * column * (0.35 + 1.3 * smoothstep(0.3, 0.75, n));
  float T = exp(-tau);
  vec3 inscatter = vec3(0.075, 0.056, 0.04) * (1.0 - T);

  // Premultiplied: the lens replaces the sky by op, the dust dims everything.
  gl_FragColor = vec4(col * op * T + inscatter, 1.0 - (1.0 - op) * T);
  #include <colorspace_fragment>
}
`;

export function DarkMatter({ body }: { body: Body }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const skyVer = useRef(-1);
  const geo = useMemo(() => new THREE.SphereGeometry(1, LAPTOP ? 48 : 32, LAPTOP ? 32 : 20), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    premultipliedAlpha: true,
    toneMapped: false,
    uniforms: {
      uSky: { value: null as THREE.CubeTexture | null },
      uHasSky: { value: 0 },
      uR: { value: 1 },
      uCore: { value: 0.1 },
      uEdge0: { value: EDGE0 },
      uK: { value: 0 },
      uFar: { value: FAR },
      uHaze: { value: HAZE_TAU },
      uHazeR: { value: 0.25 },
      uTime: { value: 0 },
      uSeedV: { value: new THREE.Vector3() },
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
    const core = body.core > 0 ? Math.min(body.core, R * 0.5) : R * 0.25;
    u.uR.value = R;
    u.uCore.value = core * LENS_CORE;
    u.uK.value = LENS_K * R * PHYSICS_FX;
    u.uFar.value = FAR * R;
    u.uHazeR.value = core * HAZE_R;
    u.uTime.value = clock.elapsedTime;
    const s = body.seed % 100000;
    (u.uSeedV.value as THREE.Vector3).set((s % 97) * 0.731, (s % 89) * 0.617, (s % 83) * 0.853);
  });

  return <mesh ref={meshRef} geometry={geo} material={mat} renderOrder={-10} />;
}
