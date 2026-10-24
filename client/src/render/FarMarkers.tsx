// Every star, black hole and rescue site in the system is also a distant
// point, so you always see where the big things are before their chunk
// loads. A point fades as you get close enough to see the real thing.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BLACKBODY_GLSL } from './sky';
import { origin } from './origin';
import { chunkBodies, type World } from '../universe/bodies';

const VERT = /* glsl */ `
attribute float aTemp;
attribute float aSize;
attribute float aKind; // 0 star, 1 black hole (dark with a warm rim), 2 other
uniform float uDpr;
varying vec3 vCol;
varying float vKind;
${BLACKBODY_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float d = distance(wp.xyz, cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
  float near = smoothstep(900.0, 2200.0, d);
  float ang = aSize / d;
  gl_PointSize = clamp(ang * 900.0, 1.5, 5.0) * uDpr;
  float bright = clamp(aSize * aSize * 4.0e4 / (d * d), 0.15, 25.0);
  vCol = (aKind < 0.5 ? blackbody(aTemp) * bright : aKind < 1.5 ? vec3(1.0, 0.55, 0.25) * 0.9 : vec3(0.7, 0.8, 1.0) * 0.6) * near;
  vKind = aKind;
}
`;

const FRAG = /* glsl */ `
varying vec3 vCol;
varying float vKind;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = vKind > 0.5 && vKind < 1.5 ? smoothstep(0.45, 0.7, r) * (1.0 - smoothstep(0.7, 1.0, r)) : exp(-r * r * 3.0);
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

const RADIUS = 9;

export function FarMarkers({ world }: { world: World }) {
  const ref = useRef<THREE.Points>(null);
  const { geometry, material } = useMemo(() => {
    const list: { x: number; y: number; z: number; t: number; s: number; k: number }[] = [];
    for (let i = -RADIUS; i <= RADIUS; i++) for (let j = -3; j <= 3; j++) for (let k = -RADIUS; k <= RADIUS; k++) {
      for (const b of chunkBodies(world, i, j, k)) {
        if (b.kind === 'star') list.push({ x: b.x, y: b.y, z: b.z, t: b.temp, s: b.radius, k: 0 });
        else if (b.kind === 'black_hole') list.push({ x: b.x, y: b.y, z: b.z, t: 0, s: b.rs * 3, k: 1 });
      }
    }
    for (const poi of world.pois) for (const b of poi.bodies) {
      if (b.kind === 'star') list.push({ x: b.x, y: b.y, z: b.z, t: b.temp, s: b.radius, k: 0 });
      else if (b.kind === 'black_hole') list.push({ x: b.x, y: b.y, z: b.z, t: 0, s: b.rs * 3, k: 1 });
      else if (b.kind === 'pulsar') list.push({ x: b.x, y: b.y, z: b.z, t: 30000, s: 40, k: 0 });
      else if (b.kind === 'wormhole') list.push({ x: b.x, y: b.y, z: b.z, t: 0, s: 60, k: 2 });
    }
    const n = list.length;
    const pos = new Float32Array(n * 3), temp = new Float32Array(n), size = new Float32Array(n), kind = new Float32Array(n);
    list.forEach((b, i) => { pos[i * 3] = b.x; pos[i * 3 + 1] = b.y; pos[i * 3 + 2] = b.z; temp[i] = b.t; size[i] = b.s; kind[i] = b.k; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aTemp', new THREE.BufferAttribute(temp, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, transparent: true,
      uniforms: { uDpr: { value: 1 } },
    });
    return { geometry: g, material: m };
  }, [world]);

  useFrame(({ gl }) => {
    ref.current?.position.set(-origin.x, -origin.y, -origin.z);
    material.uniforms.uDpr.value = gl.getPixelRatio();
  });

  return <points ref={ref} geometry={geometry} material={material} renderOrder={-15} frustumCulled={false} />;
}
