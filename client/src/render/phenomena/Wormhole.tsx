// A wormhole mouth, Interstellar style: a perfect sphere showing a different
// piece of sky (the other side), with the sky around it lensed into rings and
// the far side squeezed toward the rim. Each pixel integrates its light ray
// through the James et al. 2015 wormhole metric (arXiv:1502.03809; see
// wormholeGlsl.ts). A thin blue-white rim and a slow swirl mark the doorway,
// and a small glow keeps the mouth findable from across the system.
//
// Both mouths beat slowly (rim and far glow), each on its own clock: the exit
// mouth sits deep beside a heavy mass, so its heartbeat is visibly slower.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { sky, NOISE_GLSL } from '../sky';
import { LAPTOP, Q } from '../quality';
import { PHYSICS_FX } from '../../game/constants';
import { game } from '../../play/game';
import { field } from '../../relativity/physics';
import { WH_SHELL, whL, wormholeLensFrag, LENS_VERT, BEACON_VERT, BEACON_FRAG } from './wormholeGlsl';

const FRAG = wormholeLensFrag({
  steps: LAPTOP ? 100 : 40,
  k: LAPTOP ? 0.1 : 0.22,
  oct: LAPTOP ? 3 : 2,
  bias: LAPTOP ? -0.75 : -0.5, // a little sharper than the footprint: far stars stay points
  cube: Q.cube,
  aniso: LAPTOP ? 4 : 2,
  noise: NOISE_GLSL,
});
const L_SHELL = whL(WH_SHELL);
// Art grade on light from the far side: a touch cooler and brighter so the
// sphere reads as somewhere else even when both skies share a palette.
// (1, 1, 1) is the untouched physics.
const THERE_GRADE: [number, number, number] = [0.95, 1.05, 1.25];
const BEAT_S = 2.6; // heartbeat period in the mouth's own seconds
const BEACON_PX = 22; // far glow radius, CSS pixels
// The far glow is full while the mouth looks smaller than this (CSS px of
// throat radius) and gone once it looks bigger than BEACON_OFF.
const BEACON_ON = 8;
const BEACON_OFF = 30;

const tmpCam = new THREE.Vector3();
const tmpCtr = new THREE.Vector3();
const tmpBuf = new THREE.Vector2();

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** dtau/dt at this mouth (the game's own clock law, from its site's bodies). */
function mouthRate(body: Body): number {
  const poi = game.world?.pois.find(p => p.crewId === body.poi);
  return poi ? field(body, poi.bodies).gravRate : 1;
}

export function Wormhole({ body }: { body: Body }) {
  const group = useRef<THREE.Group>(null);
  const lens = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const skyVer = useRef(-1);
  const mouthRef = useRef<Body['mouth'] | null>(null);
  const clock = useRef({ key: '\u0000', rate: 1, t: 0 });

  const geo = useMemo(() => new THREE.SphereGeometry(1, LAPTOP ? 64 : 40, LAPTOP ? 40 : 24), []);
  const quad = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    toneMapped: false,
    uniforms: {
      uHere: { value: null as THREE.CubeTexture | null },
      uThere: { value: null as THREE.CubeTexture | null },
      uHasHere: { value: 0 },
      uHasThere: { value: 0 },
      uRho: { value: 1 },
      uShell: { value: WH_SHELL },
      uLShell: { value: L_SHELL },
      uLCam: { value: -L_SHELL },
      uSwirl: { value: 0 },
      uSpin: { value: 1 },
      uPulse: { value: 0 },
      uThereGrade: { value: new THREE.Vector3(...THERE_GRADE) },
      uFx: { value: PHYSICS_FX },
      uSeed: { value: 0 },
    },
  }), []);
  const beacon = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: BEACON_VERT,
    fragmentShader: BEACON_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uPx: { value: BEACON_PX },
      uI: { value: 0 },
    },
  }), []);

  useEffect(() => () => { mat.dispose(); beacon.dispose(); geo.dispose(); quad.dispose(); }, [mat, beacon, geo, quad]);

  // Where the camera sits in the metric, read at draw time so it never lags
  // the camera rig. Only used while the camera is inside the shell.
  useEffect(() => {
    const m = lens.current;
    if (!m) return;
    const u = mat.uniforms;
    m.onBeforeRender = (_r, _s, camera) => {
      tmpCam.setFromMatrixPosition(camera.matrixWorld);
      tmpCtr.setFromMatrixPosition(m.matrixWorld);
      u.uLCam.value = -whL(tmpCam.distanceTo(tmpCtr) / Math.max(body.radius, 1e-3));
    };
    return () => { m.onBeforeRender = () => {}; };
  }, [body, mat]);

  useFrame(({ camera, size, gl }, dt) => {
    const g = group.current, m = lens.current, s = glow.current;
    if (!g || !m || !s) return;
    place(g, body);
    const rho = Math.max(body.radius, 1e-3);
    m.scale.setScalar(rho * WH_SHELL);
    const u = mat.uniforms;
    if (skyVer.current !== sky.version || mouthRef.current !== body.mouth) {
      skyVer.current = sky.version;
      mouthRef.current = body.mouth;
      // Around either mouth is our sky; through the entry, sky B; back
      // through the exit, sky A.
      const there = body.mouth === 'exit' ? sky.a : sky.b;
      u.uHere.value = sky.a;
      u.uThere.value = there;
      u.uHasHere.value = sky.a ? 1 : 0;
      u.uHasThere.value = there ? 1 : 0;
      u.uSeed.value = (body.seed % 1000) * 0.113;
      u.uSpin.value = body.seed % 2 === 0 ? 1 : -1;
    }

    // The mouth's own clock.
    const c = clock.current;
    if (c.key !== game.worldKey) { c.key = game.worldKey; c.rate = mouthRate(body); }
    c.t += Math.min(Math.max(dt, 0), 0.1) * c.rate;
    const beat = Math.sin((c.t / BEAT_S) * Math.PI * 2);
    u.uRho.value = rho;
    u.uSwirl.value = c.t;
    u.uPulse.value = beat;
    u.uFx.value = PHYSICS_FX;

    // The far glow gives way to the real mouth as it grows on screen.
    tmpCam.setFromMatrixPosition(camera.matrixWorld);
    const d = Math.max(tmpCam.distanceTo(g.position), 1e-3);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 60;
    const px = (rho / d) * (size.height / 2) / Math.tan((fov * Math.PI) / 360);
    const on = 1 - smooth(BEACON_ON, BEACON_OFF, px);
    s.visible = on > 0.002;
    const bu = beacon.uniforms;
    bu.uI.value = on * (0.82 + 0.18 * beat);
    gl.getDrawingBufferSize(tmpBuf);
    (bu.uRes.value as THREE.Vector2).copy(tmpBuf);
    bu.uPx.value = BEACON_PX * gl.getPixelRatio();
  });

  return (
    <group ref={group}>
      <mesh ref={lens} geometry={geo} material={mat} renderOrder={-10} />
      <mesh ref={glow} geometry={quad} material={beacon} renderOrder={-9} frustumCulled={false} />
    </group>
  );
}
