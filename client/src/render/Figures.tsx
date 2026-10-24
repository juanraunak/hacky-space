// Plain voxel figures, recognisable by silhouette alone: no faces, no eyes.
// Einstein = wild white hair and moustache, grey jumper. Newton = long brown
// curly wig, dark long coat. Built from a few clean blocks with a small rig
// (head, arms, body) so they can talk, gesture, flail and float.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type Who = 'einstein' | 'newton';

const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.05 });
const M = {
  skin: mat('#e9c2a0'),
  white: mat('#f4f4f2'),
  jumper: mat('#8a8f99'),
  trousers: mat('#4a4f58'),
  shoes: mat('#2a2c31'),
  wig: mat('#7a5c3e'),
  coat: mat('#23262d'),
  cravat: mat('#efeee8'),
  stockings: mat('#d9d6cc'),
};

const B = ({ m, p, s }: { m: THREE.Material; p: [number, number, number]; s: [number, number, number] }) => (
  <mesh material={m} position={p} castShadow={false}><boxGeometry args={s} /></mesh>
);

function EinsteinHair() {
  // a wild white halo: chunky tufts sticking out, plus the moustache
  const tufts: [number, number, number, number][] = [
    [0, 0.33, 0, 0.5], [0.22, 0.25, -0.02, 0.26], [-0.22, 0.25, -0.02, 0.26], [0.3, 0.12, -0.04, 0.22], [-0.3, 0.12, -0.04, 0.22],
    [0.34, -0.02, -0.06, 0.18], [-0.34, -0.02, -0.06, 0.18], [0, 0.22, -0.2, 0.4], [0.16, 0.36, 0.08, 0.2], [-0.16, 0.36, 0.08, 0.2],
    [0.4, 0.2, -0.1, 0.12], [-0.4, 0.2, -0.1, 0.12], [0.1, 0.44, -0.08, 0.16], [-0.12, 0.43, -0.1, 0.14],
  ];
  return (
    <group>
      {tufts.map(([x, y, z, s], i) => <B key={i} m={M.white} p={[x, y, z]} s={[s, s * 0.8, s]} />)}
      <B m={M.white} p={[0, -0.1, 0.2]} s={[0.3, 0.07, 0.06]} />
    </group>
  );
}

function NewtonWig() {
  const curls: [number, number, number][] = [];
  for (let i = 0; i < 5; i++) for (const s of [1, -1]) curls.push([s * 0.24, 0.18 - i * 0.13, -0.04]);
  return (
    <group>
      <B m={M.wig} p={[0, 0.26, -0.02]} s={[0.5, 0.18, 0.46]} />
      <B m={M.wig} p={[0, 0.0, -0.22]} s={[0.48, 0.6, 0.12]} />
      {curls.map((p, i) => <B key={i} m={M.wig} p={p} s={[0.14, 0.15, 0.36]} />)}
      <B m={M.wig} p={[0.27, -0.45, 0.0]} s={[0.12, 0.2, 0.2]} />
      <B m={M.wig} p={[-0.27, -0.45, 0.0]} s={[0.12, 0.2, 0.2]} />
    </group>
  );
}

/**
 * A figure about 1.8 units tall, feet at y=0, facing +Z. `talk` 0..1 makes
 * it gesture; `flail` 0..1 throws its arms about; `lookAt` turns the head.
 */
export function Figure({ who, talk, flail, lookAt, scale = 1 }: {
  who: Who; talk?: React.RefObject<number>; flail?: React.RefObject<number>; lookAt?: React.RefObject<THREE.Vector3 | null>; scale?: number;
}) {
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const E = who === 'einstein';
  const top = E ? M.jumper : M.coat;
  const legs = E ? M.trousers : M.stockings;

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const k = talk?.current ?? 0;
    const f = flail?.current ?? 0;
    if (body.current) body.current.rotation.z = Math.sin(t * 0.8) * 0.03;
    if (armR.current) armR.current.rotation.set(-k * (0.9 + Math.sin(t * 2.4) * 0.35) - f * 2.6 + Math.sin(t * 13) * f * 0.6, 0, -0.08 - f * 0.5);
    if (armL.current) armL.current.rotation.set(-k * 0.35 * (1 + Math.sin(t * 1.7)) - f * 2.4 + Math.cos(t * 11) * f * 0.6, 0, 0.08 + f * 0.5);
    const h = head.current;
    if (h) {
      let yaw = Math.sin(t * 0.5) * 0.1, pitch = Math.sin(t * 6.5) * 0.06 * k;
      const target = lookAt?.current;
      if (target && root.current) {
        tmp.copy(target);
        root.current.worldToLocal(tmp);
        tmp.y -= 1.55;
        yaw = Math.max(-1, Math.min(1, Math.atan2(tmp.x, tmp.z)));
        pitch += Math.max(-0.5, Math.min(0.5, -Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z))));
      }
      h.rotation.y += (yaw - h.rotation.y) * 0.12;
      h.rotation.x += (pitch - h.rotation.x) * 0.15;
    }
  });

  return (
    <group ref={root} scale={scale}>
      <group ref={body}>
        {/* legs and shoes */}
        <B m={legs} p={[0.11, 0.42, 0]} s={[0.17, 0.7, 0.18]} />
        <B m={legs} p={[-0.11, 0.42, 0]} s={[0.17, 0.7, 0.18]} />
        <B m={M.shoes} p={[0.11, 0.04, 0.04]} s={[0.19, 0.09, 0.27]} />
        <B m={M.shoes} p={[-0.11, 0.04, 0.04]} s={[0.19, 0.09, 0.27]} />
        {/* torso; Newton's coat runs down to the knees */}
        <B m={top} p={[0, 1.1, 0]} s={[0.5, 0.66, 0.28]} />
        {!E && <B m={M.coat} p={[0, 0.66, 0]} s={[0.54, 0.34, 0.3]} />}
        {!E && <B m={M.cravat} p={[0, 1.33, 0.15]} s={[0.14, 0.18, 0.04]} />}
        {/* arms */}
        <group ref={armL} position={[0.33, 1.38, 0]}>
          <B m={top} p={[0, -0.28, 0]} s={[0.15, 0.58, 0.16]} />
          <B m={M.skin} p={[0, -0.62, 0]} s={[0.12, 0.12, 0.12]} />
        </group>
        <group ref={armR} position={[-0.33, 1.38, 0]}>
          <B m={top} p={[0, -0.28, 0]} s={[0.15, 0.58, 0.16]} />
          <B m={M.skin} p={[0, -0.62, 0]} s={[0.12, 0.12, 0.12]} />
        </group>
        {/* head: plain, no face; the hair says who it is */}
        <group ref={head} position={[0, 1.62, 0]}>
          <B m={M.skin} p={[0, 0.02, 0]} s={[0.38, 0.4, 0.36]} />
          {E ? <EinsteinHair /> : <NewtonWig />}
        </group>
      </group>
    </group>
  );
}
