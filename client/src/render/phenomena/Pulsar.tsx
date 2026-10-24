// A pulsar: a tiny blinding neutron star, a faint bluish wind-nebula torus in
// its equator, and two lighthouse beams along +/- pulsarAxis(body, worldS).
// The cones use BEAM_LENGTH and BEAM_HALF_ANGLE from hazards.ts so what you
// see is exactly what damages you.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body, Vec } from '../../universe/bodies';
import { place } from '../origin';
import { NOISE_GLSL } from '../sky';
import { LAPTOP } from '../quality';
import { BEAM_HALF_ANGLE, BEAM_LENGTH, pulsarAxis } from '../../relativity/hazards';
import { game } from '../../play/game';

const OCT = LAPTOP ? 3 : 2;
const TAN = Math.tan(BEAM_HALF_ANGLE);

/** 0..1 flash when a beam sweeps across the camera: max(0, dot(beamDir, dirToCam))^45 over both beams. */
export function pulsarFlash(body: Body, camPos: Vec): number {
  const m = pulsarAxis(body, game.worldS);
  const dx = camPos.x - body.x, dy = camPos.y - body.y, dz = camPos.z - body.z;
  const l = Math.hypot(dx, dy, dz) || 1;
  const c = Math.abs((m.x * dx + m.y * dy + m.z * dz) / l); // both beams (+axis and -axis)
  return Math.pow(Math.max(0, c), 45);
}

const BEAM_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Volumetric look from one cone surface: find where the view ray passes
// closest to the beam axis and use a Gaussian radial profile there.
const BEAM_FRAG = /* glsl */ `
uniform vec3 uCamLocal;
uniform float uInside;
uniform float uTime;
uniform float uL;
uniform float uTan;
uniform float uSeed;
varying vec3 vLocal;
${NOISE_GLSL}
void main() {
  if (uInside < 0.5 && !gl_FrontFacing) discard; // outside: one layer only
  vec3 ro = uCamLocal;
  vec3 rd = normalize(vLocal - ro);
  vec2 o = ro.xz, d2 = rd.xz;
  float dd = dot(d2, d2);
  float t = dd > 1e-5 ? max(-dot(o, d2) / dd, 0.0) : 0.0;
  vec3 c = ro + rd * t;
  float y = clamp(c.y, 0.0, uL);
  float rr = length(c.xz) / max(y * uTan, 0.6);
  float prof = exp(-rr * rr / 0.30);
  float along = 1.0 - y / uL;
  float n = fbm(vec3(c.x * 0.09, c.z * 0.09, y * 0.02 - uTime * 2.2) + uSeed, ${OCT});
  float glow = prof * along * (0.35 + 1.1 * n);
  glow *= 1.0 + 6.0 * exp(-y * 0.025);
  vec3 col = vec3(0.6, 0.78, 1.0) * glow * 1.3;
  gl_FragColor = vec4(col, 1.0);
}
`;

const BILLBOARD_FREE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Equatorial torus of the wind nebula, on a disc in the spin equator.
const PWN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float r = length(q);
  if (r > 1.0) discard;
  float n = fbm(vec3(q * 3.5, uSeed) + vec3(0.0, 0.0, uTime * 0.04), ${OCT + 1});
  float ring = exp(-pow((r - 0.42) / 0.13, 2.0)) * (0.4 + 1.2 * n);
  float halo = exp(-r * r / 0.05) * 0.6 + exp(-r * 3.0) * 0.15 * n;
  float I = (ring + halo) * (1.0 - smoothstep(0.8, 1.0, r));
  gl_FragColor = vec4(vec3(0.35, 0.55, 1.0) * I * 0.22, 1.0);
}
`;

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export function Pulsar({ body }: { body: Body }) {
  const group = useRef<THREE.Group>(null);
  const beamA = useRef<THREE.Mesh>(null);
  const beamB = useRef<THREE.Mesh>(null);
  const disc = useRef<THREE.Mesh>(null);
  const seed = (body.seed % 1000) * 0.137;
  const tmp = useMemo(() => ({ ax: new THREE.Vector3(), cam: new THREE.Vector3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion() }), []);

  const coreGeo = useMemo(() => new THREE.SphereGeometry(1, 24, 16), []);
  const coreMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ toneMapped: false });
    m.color.setRGB(0.8 * 80, 0.88 * 80, 1.0 * 80);
    return m;
  }, []);
  const coneGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(BEAM_LENGTH * TAN, BEAM_LENGTH, LAPTOP ? 48 : 24, LAPTOP ? 24 : 8, true);
    g.rotateX(Math.PI); // tip down
    g.translate(0, BEAM_LENGTH / 2, 0); // tip at origin, base at +L along +Y
    return g;
  }, []);
  const beamMats = useMemo(() => [0, 1].map(i => new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: {
      uCamLocal: { value: new THREE.Vector3() }, uInside: { value: 0 }, uTime: { value: 0 },
      uL: { value: BEAM_LENGTH }, uTan: { value: TAN }, uSeed: { value: seed + i * 17.0 },
    },
    side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  })), [seed]);
  const discGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const discMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: BILLBOARD_FREE_VERT,
    fragmentShader: PWN_FRAG,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed } },
    side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), [seed]);

  useEffect(() => () => { coreGeo.dispose(); coneGeo.dispose(); discGeo.dispose(); coreMat.dispose(); }, [coreGeo, coneGeo, discGeo, coreMat]);
  useEffect(() => () => beamMats.forEach(m => m.dispose()), [beamMats]);
  useEffect(() => () => discMat.dispose(), [discMat]);

  useFrame((state) => {
    const g = group.current, a = beamA.current, b = beamB.current, d = disc.current;
    if (!g || !a || !b || !d) return;
    place(g, body);
    const t = state.clock.elapsedTime;
    const m = pulsarAxis(body, game.worldS);
    tmp.ax.set(m.x, m.y, m.z);
    state.camera.getWorldPosition(tmp.cam);
    tmp.cam.sub(g.position);
    const beams: [THREE.Mesh, number][] = [[a, 1], [b, -1]];
    beams.forEach(([mesh, sgn], i) => {
      tmp.q.setFromUnitVectors(Y, tmp.ax.clone().multiplyScalar(sgn));
      mesh.quaternion.copy(tmp.q);
      tmp.qi.copy(tmp.q).invert();
      const local = tmp.cam.clone().applyQuaternion(tmp.qi);
      const u = beamMats[i].uniforms;
      (u.uCamLocal.value as THREE.Vector3).copy(local);
      const inside = local.y > 0 && local.y < BEAM_LENGTH && Math.hypot(local.x, local.z) < local.y * TAN;
      u.uInside.value = inside ? 1 : 0;
      u.uTime.value = t;
    });
    d.quaternion.setFromUnitVectors(Z, new THREE.Vector3(body.spinAxis.x, body.spinAxis.y, body.spinAxis.z).normalize());
    discMat.uniforms.uTime.value = t;
  });

  return (
    <group ref={group}>
      <mesh geometry={coreGeo} material={coreMat} scale={body.radius} />
      <mesh ref={disc} geometry={discGeo} material={discMat} scale={body.radius * 14} renderOrder={2} />
      <mesh ref={beamA} geometry={coneGeo} material={beamMats[0]} frustumCulled={false} renderOrder={3} />
      <mesh ref={beamB} geometry={coneGeo} material={beamMats[1]} frustumCulled={false} renderOrder={3} />
    </group>
  );
}
