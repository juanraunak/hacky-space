// The heavy dark mass beside a wormhole exit, where clocks run slow. Mostly
// felt, barely seen: a near-black body that hides the stars behind it, a
// faint deep red-brown limb, and a gentle lens that nudges the background
// stars around it (a faint Einstein ring from far off). Nothing here blooms.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body } from '../../universe/bodies';
import { place } from '../origin';
import { sky, NOISE_GLSL } from '../sky';
import { LAPTOP, Q } from '../quality';
import { PHYSICS_FX } from '../../game/constants';
import { LENS_VERT, WELL_BALL_VERT, WELL_SHELL, wellBallFrag, wellLensFrag } from './wormholeGlsl';

const OCT = LAPTOP ? 4 : 2;
const BALL_FRAG = wellBallFrag(OCT, NOISE_GLSL);
const LENS_FRAG = wellLensFrag(LAPTOP ? 3 : 2, NOISE_GLSL);
const BEND = 0.07; // radians of bending for light grazing the limb

export function ExitWell({ body }: { body: Body }) {
  const group = useRef<THREE.Group>(null);
  const seed = (body.seed % 1000) * 0.131;

  const ballGeo = useMemo(() => new THREE.SphereGeometry(1, Math.round(Q.sphereSeg * 0.6), Math.round(Q.sphereSeg * 0.3)), []);
  const shellGeo = useMemo(() => new THREE.SphereGeometry(1, LAPTOP ? 48 : 32, LAPTOP ? 32 : 20), []);
  const ball = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: WELL_BALL_VERT,
    fragmentShader: BALL_FRAG,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed } },
    toneMapped: false,
  }), [seed]);
  const lens = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    transparent: true,
    toneMapped: false,
    uniforms: {
      uSky: { value: null as THREE.CubeTexture | null },
      uHasSky: { value: 0 },
      uR: { value: 1 },
      uS: { value: WELL_SHELL },
      uK: { value: BEND },
      uFx: { value: PHYSICS_FX },
      uTime: { value: 0 },
      uSeed: { value: seed },
    },
  }), [seed]);

  useEffect(() => () => { ballGeo.dispose(); shellGeo.dispose(); }, [ballGeo, shellGeo]);
  useEffect(() => () => ball.dispose(), [ball]);
  useEffect(() => () => lens.dispose(), [lens]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    place(g, body);
    const t = state.clock.elapsedTime;
    const u = lens.uniforms;
    if (u.uSky.value !== sky.a) {
      u.uSky.value = sky.a;
      u.uHasSky.value = sky.a ? 1 : 0;
    }
    const r = Math.max(body.radius, 1e-3);
    u.uR.value = r;
    u.uS.value = r * WELL_SHELL;
    u.uFx.value = PHYSICS_FX;
    u.uTime.value = t;
    ball.uniforms.uTime.value = t;
  });

  return (
    <group ref={group}>
      <mesh geometry={ballGeo} material={ball} scale={body.radius} />
      {/* Drawn before the wormhole's lens (-10) so the doorway always lands
          on top of this faint bend; the opaque body still hides the mouth
          behind it through the depth buffer. */}
      <mesh geometry={shellGeo} material={lens} scale={body.radius * WELL_SHELL} renderOrder={-11} />
    </group>
  );
}
