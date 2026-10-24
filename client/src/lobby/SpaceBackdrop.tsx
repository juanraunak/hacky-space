// The real generated universe behind the title and lobby: the same baked sky
// and starfield as the game, the camera drifting slowly. No images.

import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SkyBaker } from '../render/sky';
import { Starfield } from '../render/Starfield';
import './space.css';

const SEED = 271828;

function Drift() {
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime * 0.02;
    camera.rotation.set(Math.sin(t * 0.7) * 0.15, t, 0, 'YXZ');
  });
  return null;
}

export function SpaceBackdrop() {
  return (
    <div className="space-backdrop" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: false, powerPreference: 'low-power' }}
        camera={{ fov: 60, near: 0.3, far: 120000, position: [0, 0, 0] }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.AgXToneMapping; gl.setClearColor('#000000'); }}
      >
        <SkyBaker seed={SEED} />
        <Starfield seed={SEED} />
        <Drift />
      </Canvas>
      <div className="space-vignette" />
    </div>
  );
}
