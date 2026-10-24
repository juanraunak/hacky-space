// A comet drifting across the path (PLAN.md v4 scenery): an icy nucleus, a
// glowing head and two tails pointing away from the twin stars, a straight
// blue ion tail and a wider, curving dust tail. Pure decoration.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { place } from '../origin';
import { COMET } from '../../play/story';
import { OPEN } from '../../play/onfoot';

const STAR = new THREE.Vector3(OPEN.x + 470, OPEN.y + 230, OPEN.z - 1180); // the twin stars light it

const TAIL_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vFace = abs(dot(n, normalize(cameraPosition - wp.xyz)));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const TAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
varying float vFace;
void main() {
  float along = vUv.y; // 1 at the head, 0 at the far end
  float streak = 0.75 + 0.25 * sin(vUv.x * 40.0 + uTime * 0.6) * sin(vUv.x * 17.0 - uTime * 0.3);
  float a = pow(along, 1.6) * pow(vFace, 1.4) * streak;
  gl_FragColor = vec4(uColor * a, a);
}
`;

function tailMat(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    vertexShader: TAIL_VERT, fragmentShader: TAIL_FRAG,
    uniforms: { uColor: { value: color }, uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
}

const UP = new THREE.Vector3(0, 1, 0);

export function Comet() {
  const group = useRef<THREE.Group>(null);
  const ion = useRef<THREE.Mesh>(null);
  const dust = useRef<THREE.Mesh>(null);
  const r = useMemo(() => ({
    rock: new THREE.MeshStandardMaterial({ color: '#8d8a86', roughness: 0.95, metalness: 0, emissive: '#223040', emissiveIntensity: 0.4 }),
    head: new THREE.SpriteMaterial({ color: new THREE.Color(1.6, 2.0, 2.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, map: glowTexture() }),
    ionMat: tailMat(new THREE.Color(0.35, 0.8, 2.2)),
    dustMat: tailMat(new THREE.Color(1.6, 1.4, 1.0)),
    dir: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    bend: new THREE.Quaternion(),
  }), []);

  useFrame((state) => {
    const g = group.current;
    if (!g || !ion.current || !dust.current) return;
    place(g, COMET);
    // tails point away from the light
    r.dir.set(COMET.x - STAR.x, COMET.y - STAR.y, COMET.z - STAR.z).normalize();
    r.q.setFromUnitVectors(UP, r.dir.clone().negate()); // cone tip (+y) at the head
    ion.current.quaternion.copy(r.q);
    ion.current.position.copy(r.dir).multiplyScalar(110);
    r.bend.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.22);
    dust.current.quaternion.copy(r.bend).multiply(r.q);
    dust.current.position.copy(r.dir).applyQuaternion(r.bend).multiplyScalar(75);
    const t = state.clock.elapsedTime;
    r.ionMat.uniforms.uTime.value = t;
    r.dustMat.uniforms.uTime.value = t;
  });

  return (
    <group ref={group}>
      <mesh material={r.rock}><icosahedronGeometry args={[2.6, 1]} /></mesh>
      <sprite material={r.head} scale={[22, 22, 1]} />
      <mesh ref={ion} material={r.ionMat}><coneGeometry args={[7, 220, 24, 1, true]} /></mesh>
      <mesh ref={dust} material={r.dustMat}><coneGeometry args={[18, 150, 24, 1, true]} /></mesh>
    </group>
  );
}

let glow: THREE.Texture | null = null;
function glowTexture() {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c);
  return glow;
}
