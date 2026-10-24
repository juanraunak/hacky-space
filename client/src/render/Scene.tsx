// Everything in the canvas. Draw order: sky background, mid-layer stars, far
// markers, lens shells, then solid things (pods and ships always on top of a
// lens). Near content streams by chunk around the camera: built nearest first
// out to radius 3 (radius 2 visible plus one hidden ahead ring), dropped only
// past radius 4 (hysteresis), a few chunks per frame.

import { useMemo, useRef, useState, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerformanceMonitor, AdaptiveDpr } from '@react-three/drei';
import { EffectComposer, Bloom, ChromaticAberration, Noise, Vignette, ToneMapping, HueSaturation, BrightnessContrast } from '@react-three/postprocessing';
import { ToneMappingMode, BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { SkyBaker } from './sky';
import { Starfield } from './Starfield';
import { FarMarkers } from './FarMarkers';
import { LocalShip, RemoteShips, Pods, Tethers, Mothership, SpeedDust } from './craft';
import { Bridge } from './Bridge';
import { Warp } from './Warp';
import { GameLoop, CameraRig } from './CameraRig';
import { camWorld, origin } from './origin';
import { LAPTOP, Q } from './quality';
import { BlackHole } from './phenomena/BlackHole';
import { DarkMatter } from './phenomena/DarkMatter';
import { Wormhole } from './phenomena/Wormhole';
import { Star } from './phenomena/Star';
import { Pulsar } from './phenomena/Pulsar';
import { Planet } from './phenomena/Planet';
import { Nebula } from './phenomena/Nebula';
import { Asteroids } from './phenomena/Asteroids';
import { Supernova } from './phenomena/Supernova';
import { ExitWell } from './phenomena/ExitWell';
import { game, syncWorld } from '../play/game';
import { fx, introPod } from '../cutscenes/cutscenes';
import { chunkBodies, chunkKey, type Body, type World } from '../universe/bodies';
import { CHUNK } from '../game/constants';
import { useNet, net } from '../net';

function BodyView({ body, anger }: { body: Body; anger?: number }) {
  switch (body.kind) {
    case 'sun': return <Star body={body} anger={anger} />;
    case 'star': return <Star body={body} />;
    case 'black_hole': return <BlackHole body={body} />;
    case 'dark_matter': return <DarkMatter body={body} />;
    case 'wormhole': return <Wormhole body={body} />;
    case 'pulsar': return <Pulsar body={body} />;
    case 'planet': return <Planet body={body} />;
    case 'nebula': return <Nebula body={body} />;
    case 'asteroids': return <Asteroids body={body} />;
    case 'exit_well': return <ExitWell body={body} />;
    default: return null;
  }
}

/** The dying star reads the cutscene anger every frame through this wrapper. */
function Sun({ world }: { world: World }) {
  const [anger, setAnger] = useState(0.3);
  const last = useRef(0.3);
  useFrame(() => {
    if (Math.abs(fx.anger - last.current) > 0.04) { last.current = fx.anger; setAnger(fx.anger); }
  });
  return <BodyView body={world.core[0]} anger={anger} />;
}

function ChunkStreamer({ world }: { world: World }) {
  const [loaded, setLoaded] = useState<string[]>([]);
  const set = useRef(new Set<string>());
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    if (t.current < 0.1) return;
    t.current = 0;
    const cx = Math.floor(camWorld.x / CHUNK), cy = Math.floor(camWorld.y / CHUNK), cz = Math.floor(camWorld.z / CHUNK);
    const want: { k: string; d: number }[] = [];
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let k = -3; k <= 3; k++) {
      const key = chunkKey(cx + i, cy + j, cz + k);
      if (set.current.has(key)) continue;
      if (chunkBodies(world, cx + i, cy + j, cz + k).length === 0) continue;
      want.push({ k: key, d: i * i + j * j + k * k });
    }
    want.sort((a, b) => a.d - b.d);
    let changed = false;
    for (const w of want.slice(0, 3)) { set.current.add(w.k); changed = true; }
    for (const key of [...set.current]) {
      const [x, y, z] = key.split(',').map(Number);
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) > 4) { set.current.delete(key); changed = true; }
    }
    if (changed) setLoaded([...set.current]);
  });
  return (
    <>
      {loaded.map(key => {
        const [x, y, z] = key.split(',').map(Number);
        return chunkBodies(world, x, y, z).map(b => <BodyView key={b.id} body={b} />);
      })}
    </>
  );
}

/** Light from the dying star, following the camera so it is never far away. */
function SunLight() {
  const light = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const cx = camWorld.x - origin.x, cy = camWorld.y - origin.y, cz = camWorld.z - origin.z;
    const d = Math.hypot(camWorld.x, camWorld.y, camWorld.z) || 1;
    l.position.set(cx - (camWorld.x / d) * 100, cy - (camWorld.y / d) * 100, cz - (camWorld.z / d) * 100);
    l.target.position.set(cx, cy, cz);
    l.target.updateMatrixWorld();
  });
  return (
    <>
      <directionalLight ref={light} intensity={3.2} color="#ffd2b0" />
      <ambientLight intensity={0.55} color="#8a96b8" />
      <hemisphereLight args={['#7d8db8', '#2a1c16', 0.9]} />
    </>
  );
}

function SupernovaLayer() {
  const [t, setT] = useState(-1);
  useFrame(() => {
    const s = fx.supernova;
    if ((s < 0) !== (t < 0) || Math.abs(s - t) > 1 / 30) setT(s);
  });
  return t >= 0 ? <Supernova t={t} at={{ x: 0, y: 0, z: 0 }} /> : null;
}

function Shockwave() {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 1.6), transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const s = fx.shockwave;
    m.visible = s >= 0 && s < 4;
    if (!m.visible) return;
    m.position.set(-origin.x, -origin.y, -origin.z);
    const r = 70 + s * 260;
    m.scale.setScalar(r);
    mat.opacity = 0.6 * (1 - s / 4);
  });
  return <mesh ref={ref} material={mat}><sphereGeometry args={[1, 48, 24]} /></mesh>;
}

function PostFX() {
  if (!LAPTOP) {
    return (
      <EffectComposer frameBufferType={THREE.HalfFloatType} multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={1.4} luminanceSmoothing={0.3} intensity={0.35} levels={Q.bloomLevels} />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer frameBufferType={THREE.HalfFloatType} multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={1.4} luminanceSmoothing={0.3} intensity={0.4} levels={Q.bloomLevels} />
      <ChromaticAberration offset={new THREE.Vector2(0.0005, 0.0005)} radialModulation modulationOffset={0.4} />
      <Noise opacity={0.03} blendFunction={BlendFunction.SCREEN} />
      <Vignette offset={0.3} darkness={0.55} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <BrightnessContrast contrast={0.06} />
      <HueSaturation saturation={0.06} />
    </EffectComposer>
  );
}

const OFF = new Set((new URLSearchParams(location.search).get('off') ?? '').split(','));
const on = (k: string) => !OFF.has(k);

function World3D() {
  useNet();
  syncWorld();
  const world = game.world;
  const run = net.run();
  const pods = useMemo(() => (id: number) => {
    if (fx.active !== 'intro') return null;
    const p = introPod(id, fx.t);
    return p ? new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z) : null;
  }, []);
  if (!world || !run) return null;
  return (
    <>
      {on('sky') && <SkyBaker seed={run.seed} />}
      {on('stars') && <Starfield seed={run.seed} />}
      {on('far') && <FarMarkers world={world} />}
      {on('sun') && <Sun world={world} />}
      {on('pois') && world.pois.flatMap(p => p.bodies).map(b => <BodyView key={b.id} body={b} />)}
      {on('chunks') && <ChunkStreamer world={world} />}
      {on('ms') && <Mothership />}
      <Bridge />
      {on('pods') && <Pods override={pods} />}
      <Tethers />
      {on('ship') && <LocalShip />}
      <RemoteShips />
      {on('dust') && <SpeedDust />}
      <Warp />
      <Shockwave />
      <SupernovaLayer />
    </>
  );
}

export function Scene() {
  return (
    <Canvas
      dpr={Q.dpr}
      gl={{ antialias: LAPTOP, powerPreference: 'high-performance', alpha: false, toneMapping: THREE.NoToneMapping, stencil: false }}
      camera={{ fov: 60, near: 0.3, far: 120000, position: [0, 0, 0] }}
      onCreated={({ gl, scene }) => { gl.toneMapping = THREE.NoToneMapping; gl.setClearColor('#000000'); if (import.meta.env.DEV) Object.assign(window, { __scene: scene, __gl: gl }); }}
    >
      <PerformanceMonitor onDecline={() => {}} />
      <AdaptiveDpr pixelated={false} />
      <GameLoop />
      <CameraRig />
      <SunLight />
      <Suspense fallback={null}>
        <World3D />
      </Suspense>
      {on('post') && <PostFX />}
    </Canvas>
  );
}
