// A planet lit by the dying star at the world origin: banded gas giant
// (radius > 16) or rocky noise world, reddening terminator, an atmosphere
// shell with Fresnel rim and forward scatter when backlit, optional rings
// with ring-on-planet and planet-on-ring shadows (laptop), and up to two moons.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { NOISE_GLSL, BLACKBODY_GLSL } from '../sky';
import { LAPTOP, Q } from '../quality';
import { SUN } from '../../game/constants';

const OCT = LAPTOP ? 5 : 3;
const SUN_GAIN = 1.6;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Realistic palettes (sRGB hex; THREE.Color converts to linear): dark, mid, light.
const GAS_PALETTES = [
  ['#7a5a3c', '#c9a77c', '#efe0c4'], // Jupiter tans
  ['#8a6a32', '#cfa45a', '#f0d9a0'], // ochre
  ['#9c8a6a', '#d8c9a3', '#f4ecd6'], // Saturn cream
  ['#3d6a8c', '#7fb2cc', '#c9e4ee'], // Neptune / Uranus pale blue
  ['#5e6670', '#9aa6ae', '#d4dadc'], // blue-grey haze
];
const ROCK_PALETTES = [
  ['#3e3c3a', '#7d7a76', '#b5b1aa'], // lunar grey
  ['#5a2e1c', '#a65a36', '#d39a6c'], // Martian rust
  ['#6b5638', '#b39a6e', '#ddc9a0'], // desert tan
  ['#556270', '#93a3b0', '#dfe6ea'], // icy blue-grey
  ['#3a3028', '#6e5c4a', '#a08c74'], // basalt brown
];

const RING_GLSL = /* glsl */ `
float ringDensity(float rn, float seed) {
  if (rn < 1.4 || rn > 2.4) return 0.0;
  float x = rn - 1.4;
  float b = vnoise(vec3(x * 70.0, seed, 0.0)) * 0.55 + vnoise(vec3(x * 17.0, seed + 3.0, 0.0)) * 0.45;
  b = smoothstep(0.2, 0.8, b);
  float gap = 1.0 - 0.92 * (1.0 - smoothstep(0.0, 0.035, abs(x - 0.6 - 0.1 * fract(seed))));
  float edge = smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.88, 1.0, x));
  return clamp((0.25 + 0.85 * b) * gap * edge, 0.0, 1.0) * 0.9;
}
`;

const SURF_VERT = /* glsl */ `
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

const SURF_FRAG = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uCenter;
uniform vec3 uRingN;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uR;
uniform float uGas;
uniform float uSeed;
uniform float uTime;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
${NOISE_GLSL}
${BLACKBODY_GLSL}
${RING_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(uLightDir);
  vec3 p = normalize(vObj);
  vec3 alb;
  if (uGas > 0.5) {
    float turb = fbm(p * vec3(3.0, 10.0, 3.0) + uSeed, ${OCT});
    float swirl = fbm(p * 7.0 + vec3(uTime * 0.004, 0.0, 0.0) + uSeed * 1.3, ${Math.max(2, OCT - 1)});
    float b = sin(p.y * (13.0 + 8.0 * fract(uSeed * 0.37)) + turb * 3.2 + swirl * 1.4);
    float b2 = sin(p.y * 41.0 + turb * 5.0);
    alb = mix(uC1, uC2, smoothstep(-0.6, 0.6, b));
    alb = mix(alb, uC3, smoothstep(0.2, 1.0, b2) * 0.45);
    alb *= 0.88 + 0.24 * swirl;
  } else {
    float h = fbm(p * 2.4 + uSeed, ${OCT});
    float r = ridged(p * 5.5 + uSeed * 2.0, ${OCT});
    float fine = fbm(p * 22.0 + uSeed * 3.0, ${Math.max(2, OCT - 2)});
    alb = mix(uC1, uC2, smoothstep(0.35, 0.65, h));
    alb = mix(alb, uC3, smoothstep(0.55, 0.85, r) * 0.6);
    alb *= 0.85 + 0.3 * fine;
  }
  float ndl = dot(N, L);
  vec3 term = mix(vec3(1.0, 0.42, 0.22), vec3(1.0), smoothstep(0.0, 0.35, ndl)); // reddening terminator
  vec3 sun = blackbody(${SUN.temp.toFixed(1)}) * ${SUN_GAIN.toFixed(2)};
  vec3 light = sun * max(ndl, 0.0) * term;
#ifdef RING_SHADOW
  float denom = dot(L, uRingN);
  if (abs(denom) > 1e-4) {
    float t = dot(uCenter - vW, uRingN) / denom;
    if (t > 0.0) {
      vec3 hit = vW + L * t;
      light *= 1.0 - 0.85 * ringDensity(length(hit - uCenter) / uR, uSeed);
    }
  }
#endif
  vec3 col = alb * light + alb * 0.003;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Atmosphere shell. Uses the view ray's closest approach to the planet
// centre: rim brightens towards the limb and fades to zero at the shell edge.
const ATMO_FRAG = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uCenter;
uniform vec3 uAtmo;
uniform float uR;
uniform float uRa;
varying vec3 vW;
${BLACKBODY_GLSL}
void main() {
  vec3 L = normalize(uLightDir);
  vec3 rd = normalize(vW - cameraPosition);
  vec3 oc = cameraPosition - uCenter;
  float tca = -dot(oc, rd);
  float d = sqrt(max(dot(oc, oc) - tca * tca, 0.0));
  float glow;
  if (d < uR) glow = pow(d / uR, 8.0);
  else { float h = clamp((d - uR) / (uRa - uR), 0.0, 1.0); glow = exp(-3.5 * h) * (1.0 - h); }
  vec3 P = cameraPosition + rd * tca;
  float ndl = dot(normalize(P - uCenter), L);
  float lit = smoothstep(-0.3, 0.5, ndl);
  float fwd = pow(max(dot(rd, L), 0.0), 8.0) * step(uR, d) * 2.5; // backlit forward scatter
  vec3 sun = blackbody(${SUN.temp.toFixed(1)}) * ${SUN_GAIN.toFixed(2)};
  vec3 tint = mix(vec3(1.0, 0.5, 0.3), vec3(1.0), smoothstep(-0.1, 0.4, ndl));
  vec3 col = uAtmo * sun * tint * glow * (lit + fwd) * 0.55;
  gl_FragColor = vec4(col, 1.0);
}
`;

const RING_VERT = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uCenter;
uniform vec3 uRingN;
uniform vec3 uRingCol;
uniform float uR;
uniform float uSeed;
varying vec3 vW;
${NOISE_GLSL}
${BLACKBODY_GLSL}
${RING_GLSL}
void main() {
  float rn = length(vW - uCenter) / uR;
  float dens = ringDensity(rn, uSeed);
  if (dens < 0.01) discard;
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vW);
  float ndl = abs(dot(uRingN, L));
  float fwd = pow(max(dot(-V, L), 0.0), 6.0);
  float lit = 0.15 + 0.85 * ndl + fwd * 1.2 * (1.0 - dens);
#ifdef PLANET_SHADOW
  vec3 oc = vW - uCenter;
  float b = dot(oc, L);
  float c = dot(oc, oc) - uR * uR;
  float h = b * b - c;
  if (h > 0.0 && b < 0.0) lit *= 1.0 - 0.96 * smoothstep(0.0, uR * uR * 0.05, h);
#endif
  vec3 sun = blackbody(${SUN.temp.toFixed(1)}) * ${SUN_GAIN.toFixed(2)};
  vec3 col = uRingCol * sun * lit * (0.6 + 0.4 * dens);
  gl_FragColor = vec4(col, dens * 0.9);
}
`;

const MOON_FRAG = /* glsl */ `
uniform vec3 uLightDir;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
${NOISE_GLSL}
${BLACKBODY_GLSL}
void main() {
  float h = fbm(normalize(vObj) * 4.0, 3);
  vec3 alb = vec3(0.16, 0.155, 0.15) * (0.7 + 0.6 * h);
  float ndl = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
  gl_FragColor = vec4(alb * blackbody(${SUN.temp.toFixed(1)}) * ${SUN_GAIN.toFixed(2)} * ndl, 1.0);
}
`;

const Y = new THREE.Vector3(0, 1, 0);

export function Planet({ body }: { body: Body }) {
  const group = useRef<THREE.Group>(null);
  const moonRefs = useRef<(THREE.Mesh | null)[]>([]);
  const gas = body.radius > 16;
  const seedF = (body.seed % 1000) * 0.113;

  const setup = useMemo(() => {
    const r = mulberry(body.seed ^ 0x9e3779b9);
    const tilt = 0.08 + r() * 0.45, az = r() * Math.PI * 2;
    const ringN = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)).normalize();
    const pals = gas ? GAS_PALETTES : ROCK_PALETTES;
    const pal = pals[Math.min(pals.length - 1, Math.floor(body.hue * pals.length))];
    const cols = pal.map(h => new THREE.Color(h));
    const blue = gas ? body.hue >= 0.6 : body.hue >= 0.6 && body.hue < 0.8;
    const atmo = blue ? new THREE.Color(0.35, 0.6, 1.0) : gas ? new THREE.Color(0.9, 0.75, 0.55) : new THREE.Color(0.55, 0.65, 0.85);
    const atmoStrength = gas ? 1 : body.hue < 0.2 || body.hue >= 0.8 ? 0.25 : 0.7; // airless grey / basalt worlds: faint
    atmo.multiplyScalar(atmoStrength);
    const nMoons = Math.floor(r() * 3);
    const moons = Array.from({ length: nMoons }, () => ({
      dist: body.radius * (body.rings ? 3.0 : 2.2) + r() * body.radius * 2.5,
      size: body.radius * (0.08 + r() * 0.14),
      speed: (0.02 + r() * 0.05) * (r() < 0.5 ? 1 : -1),
      phase: r() * Math.PI * 2,
      incl: (r() - 0.5) * 0.3,
    }));
    const ringCol = cols[2].clone().lerp(new THREE.Color(0.6, 0.58, 0.55), 0.4);
    return { ringN, cols, atmo, moons, ringCol, quat: new THREE.Quaternion().setFromUnitVectors(Y, ringN) };
  }, [body.seed, body.hue, body.radius, body.rings, gas]);

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, Q.sphereSeg, Math.round(Q.sphereSeg / 2)), []);
  const atmoGeo = useMemo(() => new THREE.SphereGeometry(1, LAPTOP ? 64 : 32, LAPTOP ? 32 : 16), []);
  const ringGeo = useMemo(() => body.rings ? new THREE.RingGeometry(1.4 * body.radius, 2.4 * body.radius, LAPTOP ? 128 : 64, 1) : null, [body.rings, body.radius]);
  const moonGeo = useMemo(() => new THREE.SphereGeometry(1, 24, 16), []);

  const lightDir = useMemo(() => new THREE.Vector3(), []);
  const center = useMemo(() => new THREE.Vector3(), []);

  const surfMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SURF_VERT,
    fragmentShader: SURF_FRAG,
    defines: body.rings && LAPTOP ? { RING_SHADOW: '' } : {},
    uniforms: {
      uLightDir: { value: lightDir }, uCenter: { value: center }, uRingN: { value: setup.ringN },
      uC1: { value: setup.cols[0] }, uC2: { value: setup.cols[1] }, uC3: { value: setup.cols[2] },
      uR: { value: body.radius }, uGas: { value: gas ? 1 : 0 }, uSeed: { value: seedF }, uTime: { value: 0 },
    },
    toneMapped: false,
  }), [setup, body.rings, body.radius, gas, seedF, lightDir, center]);

  const atmoR = body.radius * (gas ? 1.035 : 1.05);
  const atmoMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: {
      uLightDir: { value: lightDir }, uCenter: { value: center }, uAtmo: { value: setup.atmo },
      uR: { value: body.radius }, uRa: { value: atmoR },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), [setup, body.radius, atmoR, lightDir, center]);

  const ringMat = useMemo(() => body.rings ? new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    defines: LAPTOP ? { PLANET_SHADOW: '' } : {},
    uniforms: {
      uLightDir: { value: lightDir }, uCenter: { value: center }, uRingN: { value: setup.ringN },
      uRingCol: { value: setup.ringCol }, uR: { value: body.radius }, uSeed: { value: seedF },
    },
    side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false,
  }) : null, [setup, body.rings, body.radius, seedF, lightDir, center]);

  const moonMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SURF_VERT,
    fragmentShader: MOON_FRAG,
    uniforms: { uLightDir: { value: lightDir } },
    toneMapped: false,
  }), [lightDir]);

  useEffect(() => () => { sphereGeo.dispose(); atmoGeo.dispose(); moonGeo.dispose(); }, [sphereGeo, atmoGeo, moonGeo]);
  useEffect(() => () => ringGeo?.dispose(), [ringGeo]);
  useEffect(() => () => surfMat.dispose(), [surfMat]);
  useEffect(() => () => atmoMat.dispose(), [atmoMat]);
  useEffect(() => () => ringMat?.dispose(), [ringMat]);
  useEffect(() => () => moonMat.dispose(), [moonMat]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    place(g, body);
    center.copy(g.position);
    // Light from the dying star at the world origin.
    lightDir.set(-body.x, -body.y, -body.z);
    if (lightDir.lengthSq() < 1e-9) lightDir.set(0, 1, 0);
    lightDir.normalize();
    const t = state.clock.elapsedTime;
    surfMat.uniforms.uTime.value = t;
    setup.moons.forEach((m, i) => {
      const mesh = moonRefs.current[i];
      if (!mesh) return;
      const a = m.phase + t * m.speed;
      mesh.position.set(Math.cos(a) * m.dist, Math.sin(a) * m.dist * m.incl, Math.sin(a) * m.dist);
    });
  });

  return (
    <group ref={group}>
      <group quaternion={setup.quat}>
        <mesh geometry={sphereGeo} material={surfMat} scale={body.radius} />
        <mesh geometry={atmoGeo} material={atmoMat} scale={atmoR} renderOrder={1} />
        {ringGeo && ringMat && (
          <mesh geometry={ringGeo} material={ringMat} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} />
        )}
        {setup.moons.map((m, i) => (
          <mesh key={i} ref={el => { moonRefs.current[i] = el; }} geometry={moonGeo} material={moonMat} scale={m.size} />
        ))}
      </group>
    </group>
  );
}
