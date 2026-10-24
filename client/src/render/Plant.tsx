// A little potted plant on the cockpit dashboard that grows by YOUR clock
// (ship.tau): a sprout, a stem that climbs, leaves that unfold one by one, a
// small flower, then it wilts as the ship wears out (8 minutes of your own
// time, the same clock that weathers the hull). Sit near a black hole and it
// barely changes: your time is running slow.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ship } from '../play/game';
import { AGE_TAU } from './shipBody';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const LEAVES = 6;
// where each leaf sits up the stem, 0 base .. 1 tip (low ones open first)
const leafAt = (i: number) => 0.28 + 0.66 * i / (LEAVES - 1);
const STEM_H = 0.17; // full height of the stem, metres-ish (cockpit units)

// Shared geometry: a stem segment with its base on y = 0, a leaf hanging off +Y.
const stemGeo = new THREE.CylinderGeometry(0.0045, 0.006, 1, 6).translate(0, 0.5, 0);
const leafGeo = new THREE.SphereGeometry(1, 10, 6).scale(0.017, 0.042, 0.004).translate(0, 0.04, 0);
const potGeo = new THREE.CylinderGeometry(0.048, 0.036, 0.07, 16).translate(0, 0.035, 0);
const rimGeo = new THREE.CylinderGeometry(0.053, 0.053, 0.014, 16).translate(0, 0.066, 0);
const soilGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.006, 16).translate(0, 0.062, 0);
const budGeo = new THREE.SphereGeometry(0.014, 10, 8);

const GREEN = new THREE.Color('#4fae4a');
const OLIVE = new THREE.Color('#8f8a3a');
const BROWN = new THREE.Color('#6b4a2a');
const PETAL = new THREE.Color('#ffb3c8');
const PETAL_DRY = new THREE.Color('#9a7464');

export function Plant(props: { position?: [number, number, number]; scale?: number }) {
  const { position = [-0.55, 0.193, -1.33], scale = 1 } = props;
  const mats = useMemo(() => ({
    pot: new THREE.MeshStandardMaterial({ color: '#b5643c', roughness: 0.85, metalness: 0 }),
    soil: new THREE.MeshStandardMaterial({ color: '#2b1d14', roughness: 1, metalness: 0 }),
    stem: new THREE.MeshStandardMaterial({ color: GREEN.clone(), roughness: 0.75, metalness: 0 }),
    leaf: new THREE.MeshStandardMaterial({ color: GREEN.clone(), roughness: 0.7, metalness: 0, side: THREE.DoubleSide }),
    bud: new THREE.MeshStandardMaterial({ color: PETAL.clone(), roughness: 0.6, metalness: 0, emissive: new THREE.Color('#401020') }),
  }), []);
  useEffect(() => () => { for (const m of Object.values(mats)) m.dispose(); }, [mats]);

  const lower = useRef<THREE.Mesh>(null);
  const upperGroup = useRef<THREE.Group>(null);
  const upper = useRef<THREE.Mesh>(null);
  const leaves = useRef<(THREE.Group | null)[]>([]);
  const bud = useRef<THREE.Mesh>(null);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    const g = Math.max(0, ship.tau) / AGE_TAU; // 0..1 over 8 minutes of your time
    const t = clock.elapsedTime;
    const grow = smooth(0, 0.6, g);
    const wilt = smooth(0.78, 1.0, g);
    const h = 0.012 + STEM_H * grow;
    // two stem segments: the upper one bends over as it wilts
    if (lower.current) lower.current.scale.set(1, h * 0.55, 1);
    if (upperGroup.current) {
      upperGroup.current.position.y = h * 0.55;
      upperGroup.current.rotation.z = wilt * 0.9 + Math.sin(t * 0.7) * 0.03;
    }
    if (upper.current) upper.current.scale.set(1, h * 0.45, 1);
    col.copy(GREEN).lerp(OLIVE, smooth(0.7, 0.9, g)).lerp(BROWN, smooth(0.9, 1.0, g));
    mats.stem.color.copy(col);
    mats.leaf.color.copy(col);
    // leaves unfold one by one, low ones first; wilting droops them past level
    for (let i = 0; i < LEAVES; i++) {
      const L = leaves.current[i];
      if (!L) continue;
      const born = 0.04 + i * 0.085;
      const open = smooth(born, born + 0.14, g);
      L.visible = open > 0.01;
      const frac = leafAt(i);
      const onUpper = frac > 0.55;
      L.position.y = onUpper ? h * 0.45 * ((frac - 0.55) / 0.45) : h * 0.55 * (frac / 0.55);
      L.rotation.set(0, i * 2.4, 0);
      const leaf = L.children[0];
      if (leaf) {
        leaf.rotation.x = 0.15 + open * 0.95 + wilt * 0.85 + Math.sin(t * 1.1 + i) * 0.04;
        const s = 0.35 + 0.65 * open * (1 - 0.25 * wilt);
        leaf.scale.set(s, s, s);
      }
    }
    // a small flower near the top: buds, opens, then dries
    if (bud.current) {
      const bloom = smooth(0.42, 0.62, g);
      bud.current.visible = bloom > 0.01;
      const s = 0.4 + 0.9 * bloom * (1 - 0.35 * wilt);
      bud.current.scale.set(s, s * (1 - 0.3 * bloom), s);
      bud.current.position.y = h * 0.45 + 0.008;
      mats.bud.color.copy(PETAL).lerp(PETAL_DRY, smooth(0.8, 0.97, g));
      mats.bud.emissiveIntensity = 1 - wilt;
    }
  });

  // Leaves attach to the lower or upper segment so they follow the bend.
  const leafNodes = (upperSeg: boolean) =>
    Array.from({ length: LEAVES }, (_, i) => i).filter(i => (leafAt(i) > 0.55) === upperSeg).map(i => (
      <group key={i} ref={el => { leaves.current[i] = el; }}>
        <mesh geometry={leafGeo} material={mats.leaf} />
      </group>
    ));

  return (
    <group position={position} scale={scale}>
      <mesh geometry={potGeo} material={mats.pot} />
      <mesh geometry={rimGeo} material={mats.pot} />
      <mesh geometry={soilGeo} material={mats.soil} />
      <group position={[0, 0.064, 0]}>
        <mesh ref={lower} geometry={stemGeo} material={mats.stem} />
        {leafNodes(false)}
        <group ref={upperGroup}>
          <mesh ref={upper} geometry={stemGeo} material={mats.stem} />
          {leafNodes(true)}
          <mesh ref={bud} geometry={budGeo} material={mats.bud} />
        </group>
      </group>
    </group>
  );
}
