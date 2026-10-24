// The dying star lets go: a blinding flash, then a turbulent shell racing
// outward, Fresnel-bright at its limb, cooling from white through OIII teal
// to H-alpha red as it thins.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec } from '../../universe/bodies';
import { place } from '../origin';
import { NOISE_GLSL } from '../sky';
import { LAPTOP } from '../quality';

const OCT = LAPTOP ? 5 : 3;

/**
 * Shell radius at t seconds: a fast early t^0.4 blast (about 300 units, the
 * mothership's distance, by t ~ 4) that keeps accelerating to ~2000 by t = 12.
 */
export function supernovaRadius(t: number): number {
  const s = Math.max(0, t);
  return 140 * Math.pow(s, 0.4) + 0.6 * Math.pow(s, 3.2);
}

const SHELL_VERT = /* glsl */ `
uniform float uTime;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
${NOISE_GLSL}
void main() {
  vec3 n = normalize(position);
  vObj = n;
  float disp = fbm(n * 3.0 + vec3(uTime * 0.15), 4) - 0.5;
  vec3 p = n * (1.0 + disp * 0.14);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uI;
uniform vec3 uColor;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
${NOISE_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float f = pow(1.0 - abs(dot(normalize(vN), V)), 3.0);
  float fil = fbm(vObj * 6.0 + vec3(uTime * 0.1), ${OCT});
  float rid = ridged(vObj * 11.0 - vec3(uTime * 0.05), ${OCT});
  float m = f * (0.4 + 1.4 * fil) + 0.06 * smoothstep(0.55, 0.9, rid) + 0.02;
  gl_FragColor = vec4(uColor * uI * m, 1.0);
}
`;

const FLASH_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FLASH_FRAG = /* glsl */ `
uniform float uI;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float c = pow(abs(dot(normalize(vN), V)), 1.5);
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * uI * c, 1.0);
}
`;

const WHITE = new THREE.Color(1.0, 0.97, 0.93);
const OIII = new THREE.Color(0.184, 0.827, 0.784);
const HA = new THREE.Color(1.0, 0.227, 0.18);

export function Supernova({ t, at }: { t: number; at: Vec }) {
  const group = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Mesh>(null);
  const flash = useRef<THREE.Mesh>(null);

  const shellGeo = useMemo(() => new THREE.IcosahedronGeometry(1, LAPTOP ? 6 : 4), []);
  const flashGeo = useMemo(() => new THREE.SphereGeometry(1, 32, 16), []);
  const shellMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    uniforms: { uTime: { value: 0 }, uI: { value: 30 }, uColor: { value: WHITE.clone() } },
    side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), []);
  const flashMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: FLASH_VERT,
    fragmentShader: FLASH_FRAG,
    uniforms: { uI: { value: 80 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), []);

  useEffect(() => () => { shellGeo.dispose(); flashGeo.dispose(); }, [shellGeo, flashGeo]);
  useEffect(() => () => { shellMat.dispose(); flashMat.dispose(); }, [shellMat, flashMat]);

  useFrame(() => {
    const g = group.current, s = shell.current, f = flash.current;
    if (!g || !s || !f) return;
    place(g, at);
    const tt = Math.max(0, t);
    s.scale.setScalar(Math.max(1, supernovaRadius(tt)));
    const u = shellMat.uniforms;
    u.uTime.value = tt;
    u.uI.value = 30 * Math.exp(-tt / 1.8) + 1.2;
    const c = u.uColor.value as THREE.Color;
    if (tt < 4) c.copy(WHITE).lerp(OIII, THREE.MathUtils.smoothstep(tt, 0.8, 4));
    else c.copy(OIII).lerp(HA, THREE.MathUtils.smoothstep(tt, 4, 9));
    f.visible = tt < 1.5;
    if (f.visible) {
      f.scale.setScalar(70 * (1 + tt * 8));
      const k = 1 - tt / 1.5;
      flashMat.uniforms.uI.value = 80 * k * k;
    }
  });

  return (
    <group ref={group}>
      <mesh ref={shell} geometry={shellGeo} material={shellMat} frustumCulled={false} renderOrder={8} />
      <mesh ref={flash} geometry={flashGeo} material={flashMat} frustumCulled={false} renderOrder={9} />
    </group>
  );
}
