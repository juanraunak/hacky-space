// An asteroid field: one InstancedMesh of displaced icosahedrons, lit by a
// directional light from the dying star at the world origin. The tumble is
// done in the vertex shader (per-instance axis and rate), so instance
// matrices are written once.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { LAPTOP } from '../quality';

const COUNT = LAPTOP ? 60 : 30;

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

function rockGeometry(seed: number) {
  const r = mulberry(seed);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, LAPTOP ? 3 : 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  // Lumpy: a few random sine lobes plus fine bumps, all functions of position.
  const lobes = Array.from({ length: 6 }, () => ({
    d: new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(),
    f: 1.5 + r() * 3, p: r() * 6.28, a: 0.06 + r() * 0.1,
  }));
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let s = 1;
    for (const l of lobes) s += l.a * Math.sin(v.dot(l.d) * l.f * 3 + l.p);
    s += 0.03 * Math.sin(v.x * 17 + v.y * 11) * Math.sin(v.z * 13 - v.x * 7);
    // One flattened facet, like an impact.
    const k = v.dot(lobes[0].d);
    if (k > 0.6) s -= (k - 0.6) * 0.5;
    v.multiplyScalar(s);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function Asteroids({ body }: { body: Body }) {
  const group = useRef<THREE.Group>(null);
  const time = useMemo(() => ({ value: 0 }), []);

  const geo = useMemo(() => {
    const g = rockGeometry(body.seed ^ 0xa57e);
    const r = mulberry(body.seed ^ 0x7713);
    const spin = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      const a = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
      spin[i * 4] = a.x; spin[i * 4 + 1] = a.y; spin[i * 4 + 2] = a.z;
      spin[i * 4 + 3] = (0.05 + r() * 0.3) * (r() < 0.5 ? -1 : 1);
    }
    g.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
    return g;
  }, [body.seed]);

  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5f574e'), roughness: 0.95, metalness: 0.0, flatShading: false });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = /* glsl */ `
uniform float uTime;
attribute vec4 aSpin;
vec3 rotAx(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
` + sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = rotAx(objectNormal, aSpin.xyz, uTime * aSpin.w);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = rotAx(transformed, aSpin.xyz, uTime * aSpin.w);');
    };
    return m;
  }, [time]);

  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(geo, mat, COUNT);
    const r = mulberry(body.seed ^ 0x3c1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
    const tint = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const z = r() * 2 - 1, a = r() * Math.PI * 2, sq = Math.sqrt(1 - z * z);
      const d = body.radius * 0.9 * Math.cbrt(r());
      p.set(sq * Math.cos(a) * d, z * d * 0.6, sq * Math.sin(a) * d);
      const size = 1.2 + Math.pow(r(), 3) * 9; // many small, few big
      s.set(size, size * (0.65 + r() * 0.35), size * (0.5 + r() * 0.4));
      q.setFromEuler(e.set(r() * 6.28, r() * 6.28, r() * 6.28));
      im.setMatrixAt(i, m4.compose(p, q, s));
      const v = 0.75 + r() * 0.5;
      im.setColorAt(i, tint.setRGB(v * (1 + (r() - 0.5) * 0.15), v, v * (1 - r() * 0.15)));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    if (im.boundingSphere) im.boundingSphere.radius += 12;
    return im;
  }, [geo, mat, body.seed, body.radius]);

  const light = useMemo(() => {
    const l = new THREE.DirectionalLight(new THREE.Color(1.0, 0.68, 0.45), 2.6);
    l.castShadow = false;
    return l;
  }, []);

  useEffect(() => () => { geo.dispose(); }, [geo]);
  useEffect(() => () => { mat.dispose(); }, [mat]);
  useEffect(() => () => { mesh.dispose(); }, [mesh]);
  useEffect(() => () => { light.dispose(); }, [light]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    place(g, body);
    time.value = state.clock.elapsedTime;
    // Light travels from the dying star (world origin) towards the field.
    const lx = -body.x, ly = -body.y, lz = -body.z;
    const l = Math.hypot(lx, ly, lz) || 1;
    light.position.set((lx / l) * 100, (ly / l) * 100, (lz / l) * 100);
    light.target.position.set(0, 0, 0);
  });

  return (
    <group ref={group}>
      <primitive object={mesh} />
    </group>
  );
}
