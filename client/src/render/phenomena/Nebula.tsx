// An emission nebula you can fly through: large soft camera-facing sprites,
// H-alpha red billows outside and OIII teal tighter inside, plus a few dark
// dust sprites. Faint (it is gas, not a light), and each sprite fades out as
// the camera gets inside it so there is never a flat wall.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { NOISE_GLSL } from '../sky';
import { LAPTOP } from '../quality';

const OCT = LAPTOP ? 5 : 3;
const N_GAS = LAPTOP ? 20 : 12;
const N_DUST = LAPTOP ? 5 : 3;

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

const VERT = /* glsl */ `
attribute vec3 aOffset;
attribute float aSize;
attribute vec3 aColor;
attribute float aSeed;
attribute float aBright;
varying vec2 vUv;
varying vec3 vColor;
varying float vSeed;
varying float vBright;
varying float vFade;
void main() {
  vUv = uv;
  vColor = aColor;
  vSeed = aSeed;
  vBright = aBright;
  vec4 mv = viewMatrix * (modelMatrix * vec4(aOffset, 1.0));
  float d = length(mv.xyz);
  vFade = smoothstep(aSize * 0.12, aSize * 0.6, d); // fade when we are inside it
  float a = aSeed * 6.2831853;
  vec2 pp = mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy;
  mv.xy += pp * aSize;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
varying float vSeed;
varying float vBright;
varying float vFade;
${NOISE_GLSL}
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0 || vFade < 0.002) discard;
  vec3 sp = vec3(q * 1.7, vSeed * 13.0);
  vec3 warp = vec3(fbm(sp + 3.1, 3), fbm(sp + 7.7, 3), 0.0);
  float n = fbm(sp + warp * 1.3 + vec3(0.0, 0.0, uTime * 0.008), ${OCT});
  float shape = 1.0 - smoothstep(0.0, 1.0, r);
  float dens = shape * shape * smoothstep(0.32, 0.78, n * 0.85 + shape * 0.4);
#ifdef DUST
  gl_FragColor = vec4(vColor, dens * vBright * vFade);
#else
  gl_FragColor = vec4(vColor * vBright * dens * vFade, 1.0);
#endif
}
`;

function spriteGeo(n: number) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('uv', plane.getAttribute('uv'));
  g.instanceCount = n;
  return g;
}

export function Nebula({ body }: { body: Body }) {
  const group = useRef<THREE.Group>(null);

  const geos = useMemo(() => {
    const r = mulberry(body.seed ^ 0x51ed27);
    const R = body.radius;
    const ha = new THREE.Color('#ff3a2e');
    const o3 = new THREE.Color('#2fd3c8');
    const split = 0.35 + 0.2 * body.hue; // more teal core on some nebulae
    const gas = spriteGeo(N_GAS);
    const dust = spriteGeo(N_DUST);
    const build = (g: THREE.InstancedBufferGeometry, n: number, isDust: boolean) => {
      const off = new Float32Array(n * 3), size = new Float32Array(n), col = new Float32Array(n * 3);
      const seed = new Float32Array(n), bright = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        const d = R * 0.85 * Math.pow(r(), isDust ? 0.8 : 0.6);
        off[i * 3] = s * Math.cos(a) * d;
        off[i * 3 + 1] = z * d * 0.75; // slightly flattened
        off[i * 3 + 2] = s * Math.sin(a) * d;
        const inner = d / R < split;
        let c: THREE.Color;
        if (isDust) {
          c = new THREE.Color(0.012, 0.009, 0.007);
          size[i] = R * (0.35 + r() * 0.35);
          bright[i] = 0.22 + r() * 0.18;
        } else if (inner) {
          c = o3.clone().lerp(new THREE.Color(0.75, 0.9, 0.95), r() * 0.2);
          size[i] = R * (0.3 + r() * 0.25);
          bright[i] = 0.15 + r() * 0.25;
        } else {
          c = ha.clone().lerp(new THREE.Color(1.0, 0.45, 0.55), r() * 0.25);
          size[i] = R * (0.5 + r() * 0.4);
          bright[i] = 0.05 + r() * 0.2;
        }
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        seed[i] = r();
      }
      g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
      g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
      g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
      g.setAttribute('aBright', new THREE.InstancedBufferAttribute(bright, 1));
    };
    build(gas, N_GAS, false);
    build(dust, N_DUST, true);
    return { gas, dust };
  }, [body.seed, body.radius, body.hue]);

  const mats = useMemo(() => {
    const time = { value: 0 };
    const gas = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: time },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const dust = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: time }, defines: { DUST: '' },
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, toneMapped: false,
    });
    return { gas, dust, time };
  }, []);

  useEffect(() => () => { geos.gas.dispose(); geos.dust.dispose(); }, [geos]);
  useEffect(() => () => { mats.gas.dispose(); mats.dust.dispose(); }, [mats]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    place(g, body);
    mats.time.value = state.clock.elapsedTime;
  });

  return (
    <group ref={group}>
      <mesh geometry={geos.dust} material={mats.dust} frustumCulled={false} renderOrder={6} />
      <mesh geometry={geos.gas} material={mats.gas} frustumCulled={false} renderOrder={5} />
    </group>
  );
}
