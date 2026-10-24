// The cockpit interior (first-person view) lives here too: dashboard, frame,
// the two clocks, and Einstein's hologram on the dash.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Npc } from './Npc';
import { newDrive } from '../play/onfoot';
import { Plant } from './Plant';
import { drawDials, type Dial } from '../hud/dials';
import { comms } from '../play/einstein';
import { game, ship } from '../play/game';

const panelMat = new THREE.MeshStandardMaterial({ color: '#3a3f4a', metalness: 0.7, roughness: 0.45 });
const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1e25', metalness: 0.6, roughness: 0.5 });

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
  const camera = useThree(s => s.camera);
  // Hacky-style Einstein (render/Npc.tsx) in the co-pilot seat, turned a
  // little toward you; his head follows the camera and he gestures on the radio.
  const drive = useMemo(() => {
    const d = newDrive(0, 0, Math.PI - 0.45);
    d.seated = 1; d.armL = [-0.35, 0.1]; d.armR = [-0.35, 0.1]; d.look = new THREE.Vector3();
    return d;
  }, []);
  useFrame(() => {
    const age = performance.now() / 1000 - comms.shownAt;
    const want = comms.line && age < 5.5 && comms.who === 'EINSTEIN' ? 1 : 0;
    drive.talk += (want - drive.talk) * 0.1;
    drive.armR = drive.talk > 0.5 ? [-0.9, 0.35] : [-0.35, 0.1];
    camera.getWorldPosition(drive.look!);
  });
  return (
    <group>
      {/* dashboard and canopy frame */}
      <mesh material={darkMat} position={[0, 0.12, -1.4]} rotation={[-0.5, 0, 0]}><boxGeometry args={[1.9, 0.08, 0.55]} /></mesh>
      <mesh material={panelMat} position={[0, -0.05, -1.45]}><boxGeometry args={[1.9, 0.3, 0.5]} /></mesh>
      {[-1, 1].map(s => (
        <mesh key={s} material={darkMat} position={[s * 0.8, 0.5, -1.25]} rotation={[0.25, 0, s * 0.45]}><boxGeometry args={[0.05, 0.85, 0.05]} /></mesh>
      ))}
      <mesh material={darkMat} position={[0, 0.88, -1.15]} rotation={[0.9, 0, 0]}><boxGeometry args={[1.1, 0.04, 0.05]} /></mesh>
      <Plant />
      {/* Einstein in the co-pilot seat, turned toward you */}
      <mesh material={darkMat} position={[0.62, -0.25, -0.55]}><boxGeometry args={[0.42, 0.5, 0.42]} /></mesh>
      <group position={[0.62, -0.15, -0.5]}>
        <Npc who="einstein" drive={drive} scale={0.36} />
      </group>
    </group>
  );
}
