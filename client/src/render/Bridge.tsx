// The mothership's bridge: where the opening, the reunions and the ending
// happen. A room with a great window onto the dying star, consoles, the crew
// at their stations and Einstein at the glass. It sits where the mothership
// is; the hull is hidden while the camera is in here.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { place } from './origin';
import { VoxelChar, crewModel } from './VoxelChar';
import { net } from '../net';
import { comms } from '../play/einstein';
import { MOTHERSHIP } from '../game/constants';
import { fx } from '../cutscenes/cutscenes';

/** The room's centre in world space. The window (local -z) faces the star. */
export const BRIDGE = { x: MOTHERSHIP.x, y: MOTHERSHIP.y + 3, z: MOTHERSHIP.z - 20 };
export const bridgeLocal = (x: number, y: number, z: number) => ({ x: BRIDGE.x + x, y: BRIDGE.y + y, z: BRIDGE.z + z });

const wall = new THREE.MeshStandardMaterial({ color: '#2b2f38', metalness: 0.5, roughness: 0.6 });
const floor = new THREE.MeshStandardMaterial({ color: '#1a1d23', metalness: 0.4, roughness: 0.35 });
const trim = new THREE.MeshStandardMaterial({ color: '#8d939e', metalness: 0.9, roughness: 0.25 });

function emissive(r: number, g: number, b: number) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });
}

export function Bridge() {
  const ref = useRef<THREE.Group>(null);
  const einstein = useRef<THREE.Group>(null);
  const crewGroup = useRef<THREE.Group>(null);
  const talk = useRef(0);
  const look = useRef<THREE.Vector3 | null>(null);
  const screens = useMemo(() => emissive(0.12, 0.42, 0.62), []);
  const strip = useMemo(() => emissive(1.2, 1.15, 1.0), []);
  const alarm = useMemo(() => emissive(0, 0, 0), []);
  const camPos = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, clock }) => {
    const g = ref.current;
    if (!g) return;
    g.visible = fx.bridge;
    if (!fx.bridge) return;
    place(g, BRIDGE);
    camera.getWorldPosition(camPos);
    look.current = fx.einsteinLooks ? camPos : null;
    const age = performance.now() / 1000 - comms.shownAt;
    talk.current += ((comms.line && age < 5.5 ? 1 : 0) - talk.current) * 0.1;
    if (einstein.current) {
      einstein.current.visible = fx.einsteinOnBridge;
      einstein.current.rotation.y = Math.PI * (1 - fx.einsteinTurn);
      einstein.current.position.set(fx.einsteinAt.x, -2.4, fx.einsteinAt.z);
    }
    if (crewGroup.current) {
      crewGroup.current.rotation.z = Math.sin(clock.elapsedTime * 23) * 0.01 * fx.shake;
      crewGroup.current.children.forEach((c, i) => { c.rotation.x = -fx.crewFall * (1.2 + (i % 3) * 0.2); });
    }
    const a = fx.alarm > 0 && Math.sin(clock.elapsedTime * 8) > 0 ? fx.alarm : 0;
    alarm.color.setRGB(4 * a, 0.2 * a, 0.1 * a);
  });

  // Who stands on the bridge: everyone home (reunions, the ending) or the
  // whole crew before the disaster (the opening).
  const crew = net.crew().filter(c => !c.isEinstein && (fx.bridgeAll || c.status === 'home'));

  return (
    <group ref={ref} visible={false}>
      {/* floor, ceiling, walls */}
      <mesh material={floor} position={[0, -2.5, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[26, 18]} /></mesh>
      <mesh material={wall} position={[0, 3.2, 0]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[26, 18]} /></mesh>
      <mesh material={wall} position={[0, 0.35, 9]} rotation={[0, Math.PI, 0]}><planeGeometry args={[26, 5.7]} /></mesh>
      <mesh material={wall} position={[-13, 0.35, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[18, 5.7]} /></mesh>
      <mesh material={wall} position={[13, 0.35, 0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[18, 5.7]} /></mesh>
      {/* the window wall: a frame around open glass onto the star */}
      <mesh material={wall} position={[0, -1.8, -9]}><boxGeometry args={[26, 1.4, 0.4]} /></mesh>
      <mesh material={wall} position={[0, 2.8, -9]}><boxGeometry args={[26, 0.8, 0.4]} /></mesh>
      {[-12, -6, 0, 6, 12].map(x => <mesh key={x} material={trim} position={[x, 0.3, -9]}><boxGeometry args={[0.25, 4.2, 0.3]} /></mesh>)}
      {/* light strips and alarm */}
      {[-6, 0, 6].map(z => <mesh key={z} material={strip} position={[0, 3.15, z]}><boxGeometry args={[14, 0.05, 0.2]} /></mesh>)}
      <mesh material={alarm} position={[0, 3.1, 8.5]}><boxGeometry args={[20, 0.1, 0.1]} /></mesh>
      {/* consoles in an arc */}
      {[-8, -4, 4, 8].map((x, i) => (
        <group key={x} position={[x, -2.5, -3 + Math.abs(x) * 0.25]} rotation={[0, -x * 0.04, 0]}>
          <mesh material={wall} position={[0, 0.5, 0]}><boxGeometry args={[3, 1, 1.2]} /></mesh>
          <mesh material={screens} position={[0, 1.05, -0.3]} rotation={[-0.6, 0, 0]}><planeGeometry args={[2.6, 0.7]} /></mesh>
          <mesh material={trim} position={[0, 1.0, 0.6]}><boxGeometry args={[3, 0.06, 0.06]} /></mesh>
          {i % 2 === 0 && <mesh material={screens} position={[0, 2.2, -0.6]}><planeGeometry args={[1.8, 1]} /></mesh>}
        </group>
      ))}
      <pointLight position={[0, 2.4, 2]} intensity={160} distance={30} decay={1.6} color="#c8dcff" />
      <pointLight position={[-7, 2.2, 5]} intensity={70} distance={20} decay={1.6} color="#c8dcff" />
      <pointLight position={[7, 2.2, 5]} intensity={70} distance={20} decay={1.6} color="#c8dcff" />
      <pointLight position={[0, 1, -7]} intensity={120} distance={24} decay={1.6} color="#ff8a55" />
      {/* the crew */}
      <group ref={crewGroup}>
        {crew.map((c, i) => {
          const slots = [[-8, -2], [-4, -1], [4, -1], [8, -2], [-10, 3], [-6, 4], [6, 4], [10, 3], [-2, 5], [2, 5], [-12, 6], [12, 6]];
          const [x, z] = slots[i % slots.length];
          return (
            <group key={c.id} position={[x, -2.4, z]} rotation={[0, Math.atan2(-x, 6 - z) * 0.6, 0]}>
              <VoxelChar src={crewModel(c.slot)} height={1.9} lookAt={look} pose={fx.waveId === c.id ? 'wave' : 'stand'} />
            </group>
          );
        })}
      </group>
      {/* Einstein */}
      <group ref={einstein}>
        <VoxelChar src="/characters/einstein.json" talk={talk} lookAt={look} height={1.85} />
      </group>
    </group>
  );
}
