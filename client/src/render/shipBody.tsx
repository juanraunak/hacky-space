// The rescue ship's exterior model (voxels from voxelShip.ts). Nose points -Z,
// about 5 units long. `engine` (0 idle, 1 thrust, 1.6 boost) drives the nozzle
// glow and the length of the additive HDR flames.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { shipGeometry, shipGlassGeometry, NOZZLES, NOZZLE_FACE, WINGTIPS, SHIP_VOXEL } from './voxelShip';

// Matte, barely metallic: there is no environment map, so metal would go dark.
const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.62 });
const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.35, emissive: new THREE.Color('#0d3552') });

/** An open square pyramid, base (half-size `half`) on z = 0, apex at z = `len`. */
function pyramid(half: number, len: number): THREE.BufferGeometry {
  const h = half;
  const p = new Float32Array([
    -h, -h, 0, h, -h, 0, 0, 0, len,
    h, -h, 0, h, h, 0, 0, 0, len,
    h, h, 0, -h, h, 0, 0, 0, len,
    -h, h, 0, -h, -h, 0, 0, 0, len,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.computeBoundingSphere();
  return g;
}

// Shared by every ship.
const nozzleGeo = new THREE.PlaneGeometry(NOZZLE_FACE * 0.68, NOZZLE_FACE * 0.68);
const flameGeo = pyramid(NOZZLE_FACE * 0.29, 1.8);
const coreGeo = pyramid(NOZZLE_FACE * 0.16, 1.1);
const lampGeo = new THREE.BoxGeometry(SHIP_VOXEL * 1.04, SHIP_VOXEL * 1.04, SHIP_VOXEL * 1.04);
const additive = { toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } as const;
const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 2.0, 4.2), opacity: 0.8, ...additive });
const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 3.2, 4.4), opacity: 0.9, ...additive });
const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.3, 0.3), toneMapped: false });
const green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 5, 1), toneMapped: false });
const NOZZLE_Z = NOZZLES[0][2];

export function ShipBody({ color, engine }: { color: string; engine: React.RefObject<number> }) {
  const geo = useMemo(() => shipGeometry(color), [color]);
  const nozzle = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.2, 2.1), toneMapped: false }), []);
  useEffect(() => () => nozzle.dispose(), [nozzle]);
  const phase = useMemo(() => Math.random() * 100, []);
  const flames = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const e = engine.current ?? 0;
    // `on` fades the engines out below idle (0.08), so a dark ship is dark.
    const on = Math.min(1, e * 12);
    const fl = flames.current;
    if (fl) {
      fl.visible = on > 0.02;
      fl.scale.set(1, 1, 0.15 * on + e * (1 + Math.sin((t + phase) * 45) * 0.06));
    }
    nozzle.color.setRGB((0.5 + e * 1.2) * on, (1 + e * 2) * on, (1.8 + e * 4) * on);
    // Shared lamps: every ship writes the same blink, so order does not matter.
    const blink = Math.sin(t * 3) > 0.6 ? 1 : 0.1;
    red.color.setRGB(5 * blink, 0.3 * blink, 0.3 * blink);
    green.color.setRGB(0.3 * blink, 5 * blink, 1 * blink);
  });
  return (
    <group>
      <mesh geometry={geo} material={hullMat} />
      <mesh geometry={shipGlassGeometry()} material={glassMat} />
      {NOZZLES.map((p, i) => (
        <mesh key={i} geometry={nozzleGeo} material={nozzle} position={[p[0], p[1], NOZZLE_Z + 0.02]} />
      ))}
      <group ref={flames} position={[0, 0, NOZZLE_Z + 0.025]}>
        {NOZZLES.map((p, i) => (
          <group key={i} position={[p[0], p[1], 0]}>
            <mesh geometry={flameGeo} material={flameMat} />
            <mesh geometry={coreGeo} material={coreMat} />
          </group>
        ))}
      </group>
      <mesh geometry={lampGeo} material={green} position={WINGTIPS[0]} />
      <mesh geometry={lampGeo} material={red} position={WINGTIPS[1]} />
    </group>
  );
}
