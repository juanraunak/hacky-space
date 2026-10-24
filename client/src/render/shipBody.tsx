// The rescue ship's exterior model. Nose points -Z, about 5 units long.
// `engine` (0..1.6) drives the engine glow and flame length.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { shipGeometry, NOZZLES, WINGTIPS } from './voxelShip';

const voxelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.55 });

export function ShipBody({ color, engine }: { color: string; engine: React.RefObject<number> }) {
  const geo = useMemo(() => shipGeometry(color), [color]);
  const flame = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 2.8, 5), toneMapped: false, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), []);
  const nozzle = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.2, 4), toneMapped: false }), []);
  const nav = useMemo(() => [new THREE.MeshBasicMaterial({ color: '#f22', toneMapped: false }), new THREE.MeshBasicMaterial({ color: '#2f6', toneMapped: false })], []);
  const flames = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const e = engine.current ?? 0;
    if (flames.current) flames.current.scale.set(1, 1, 0.15 + e * (1 + Math.sin(clock.elapsedTime * 45) * 0.06));
    nozzle.color.setRGB(0.5 + e * 1.2, 1 + e * 2, 1.8 + e * 4);
    const blink = Math.sin(clock.elapsedTime * 3) > 0.6 ? 1 : 0.1;
    nav[0].color.setRGB(5 * blink, 0.3 * blink, 0.3 * blink);
    nav[1].color.setRGB(0.3 * blink, 5 * blink, 1 * blink);
  });
  return (
    <group>
      <mesh geometry={geo} material={voxelMat} />
      {NOZZLES.map((p, i) => (
        <mesh key={i} material={nozzle} position={[p[0], p[1], p[2] + 0.02]}><planeGeometry args={[0.46, 0.46]} /></mesh>
      ))}
      <group ref={flames} position={[0, 0, NOZZLES[0][2]]}>
        {NOZZLES.map((p, i) => (
          <mesh key={i} material={flame} position={[p[0], p[1], 0.85]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.22, 1.7, 4, 1, true]} /></mesh>
        ))}
      </group>
      <mesh material={nav[0]} position={[WINGTIPS[1][0], 0.35, WINGTIPS[1][2]]}><boxGeometry args={[0.13, 0.13, 0.13]} /></mesh>
      <mesh material={nav[1]} position={[WINGTIPS[0][0], 0.35, WINGTIPS[0][2]]}><boxGeometry args={[0.13, 0.13, 0.13]} /></mesh>
    </group>
  );
}

