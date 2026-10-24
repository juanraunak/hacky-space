// The rescue ship (a clean voxel build, see voxelShip.ts) and its cockpit.
//
// The cockpit interior (first-person view) lives here too: dashboard, frame,
// the two clocks, and Einstein's hologram on the dash.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { VoxelChar } from './VoxelChar';
import { shipGeometry, NOZZLES, WINGTIPS } from './voxelShip';
import { drawDials, type Dial } from '../hud/dials';
import { comms } from '../play/einstein';
import { game, ship } from '../play/game';

const panelMat = new THREE.MeshStandardMaterial({ color: '#3a3f4a', metalness: 0.7, roughness: 0.45 });
const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1e25', metalness: 0.6, roughness: 0.5 });




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

// --- the cockpit ----------------------------------------------------------------

export const COCKPIT_EYE = new THREE.Vector3(0, 0.42, -0.62);

function useDialTexture() {
  const { canvas, texture } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 400;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { canvas: c, texture: t };
  }, []);
  const last = useRef(0);
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 0.05) return;
    last.current = clock.elapsedTime;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawDials(ctx, canvas.width, canvas.height, dialsNow());
    texture.needsUpdate = true;
  });
  return texture;
}

/** Your clock beside the mothership's, or beside the pod you are towing or nearest. */
export function dialsNow(): Dial[] {
  const you: Dial = { label: 'YOU', seconds: ship.tau, rate: ship.rate, color: ship.rate < 0.9 ? '#7cc4ff' : '#e8ecff' };
  let other: Dial = { label: 'MOTHERSHIP', seconds: Math.max(0, game.worldS), rate: 1, color: '#ffd28a' };
  let best = 250;
  for (const p of game.pods.values()) {
    if (p.crew.status !== 'waiting' && p.crew.status !== 'towed') continue;
    const d = Math.hypot(p.pos.x - ship.pos.x, p.pos.y - ship.pos.y, p.pos.z - ship.pos.z);
    const mine = game.tow?.crewId === p.crew.id;
    if (mine || d < best) {
      best = mine ? -1 : d;
      other = { label: p.crew.name.toUpperCase(), seconds: Math.max(0, 120 - p.air), rate: p.rate, color: '#ffb066' };
    }
  }
  return [you, other];
}

export function Cockpit() {
  const dials = useDialTexture();
  const camera = useThree(s => s.camera);
  const talk = useRef(0);
  const look = useRef<THREE.Vector3 | null>(new THREE.Vector3());
  const screen = useMemo(() => new THREE.MeshBasicMaterial({ map: dials, toneMapped: false, transparent: true }), [dials]);
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 2.4), toneMapped: false, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), []);
  const cone = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.4), toneMapped: false, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), []);
  useEffect(() => () => { dials.dispose(); }, [dials]);
  useFrame(() => {
    const age = performance.now() / 1000 - comms.shownAt;
    const want = comms.line && age < 5.5 ? 1 : 0;
    talk.current += (want - talk.current) * 0.1;
    camera.getWorldPosition(look.current!);
  });
  return (
    <group>
      {/* dashboard */}
      <mesh material={darkMat} position={[0, 0.12, -1.4]} rotation={[-0.5, 0, 0]}><boxGeometry args={[1.5, 0.08, 0.55]} /></mesh>
      <mesh material={panelMat} position={[0, -0.05, -1.45]}><boxGeometry args={[1.5, 0.3, 0.5]} /></mesh>
      <mesh material={screen} position={[-0.2, 0.2, -1.32]} rotation={[-0.5, 0, 0]}><planeGeometry args={[0.78, 0.3]} /></mesh>
      {/* canopy frame */}
      {[-1, 1].map(s => (
        <mesh key={s} material={darkMat} position={[s * 0.62, 0.5, -1.25]} rotation={[0.25, 0, s * 0.45]}><boxGeometry args={[0.05, 0.85, 0.05]} /></mesh>
      ))}
      <mesh material={darkMat} position={[0, 0.88, -1.15]} rotation={[0.9, 0, 0]}><boxGeometry args={[0.9, 0.04, 0.05]} /></mesh>
      <mesh material={darkMat} position={[0, 0.75, 0.2]}><boxGeometry args={[1.6, 0.06, 0.06]} /></mesh>
      {/* Einstein, live from his pod as a hologram on the dash */}
      <group position={[0.42, 0.18, -1.3]}>
        <mesh material={glow} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.13, 24]} /></mesh>
        <mesh material={cone} position={[0, 0.24, 0]}><cylinderGeometry args={[0.16, 0.12, 0.48, 20, 1, true]} /></mesh>
        <group rotation={[0, -0.35, 0]}>
          <VoxelChar src="/characters/einstein.json" mode="hologram" talk={talk} lookAt={look} height={0.46} />
        </group>
      </group>
    </group>
  );
}
