// Light-speed streaks: past half the speed of light, stars stretch into
// lines rushing past from the direction you are flying. Their length grows
// as you approach c. Drawn around the camera along the velocity.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ship } from '../play/game';
import { C } from '../game/constants';
import { LAPTOP } from './quality';

const N = LAPTOP ? 1400 : 600;
const DEPTH = 420;

export function Warp() {
  const ref = useRef<THREE.LineSegments>(null);
  const { geometry, material, seeds } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    const s = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      s[i * 3] = Math.random() * Math.PI * 2; // angle around the axis
      s[i * 3 + 1] = 6 + Math.pow(Math.random(), 0.6) * 90; // distance from the axis
      s[i * 3 + 2] = Math.random() * DEPTH; // place along the axis
    }
    const m = new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 2.2, 3.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    return { geometry: g, material: m, seeds: s };
  }, []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const fwd = useMemo(() => new THREE.Vector3(0, 0, -1), []);
  const travel = useRef(0);

  useFrame(({ camera }, dt) => {
    const l = ref.current;
    if (!l) return;
    const b = ship.speed / C;
    const k = THREE.MathUtils.smoothstep(b, 0.5, 0.9);
    material.opacity = k * 0.8;
    l.visible = k > 0.01;
    if (!l.visible) return;
    dir.set(ship.vel.x, ship.vel.y, ship.vel.z).normalize();
    q.setFromUnitVectors(fwd, dir);
    l.position.copy(camera.position);
    l.quaternion.copy(q);
    travel.current = (travel.current + ship.speed * 6 * Math.min(dt, 0.05)) % DEPTH;
    const len = 4 + k * k * 70;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < N; i++) {
      const a = seeds[i * 3], r = seeds[i * 3 + 1];
      // z runs from far ahead (-DEPTH) toward and past the camera (+)
      const z = ((seeds[i * 3 + 2] + travel.current) % DEPTH) - DEPTH * 0.85;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      pos.setXYZ(i * 2, x, y, z);
      pos.setXYZ(i * 2 + 1, x, y, z - len);
    }
    pos.needsUpdate = true;
  });

  return <lineSegments ref={ref} geometry={geometry} material={material} frustumCulled={false} renderOrder={-5} />;
}
