// The opening: Newton and Einstein stand on a glowing sheet of space.
// Newton: gravity is a rope. Einstein drops a heavy ball: the sheet dips. A
// marble curves around the dip with no rope. Two clocks: the one down in the
// dip ticks slower. The ball grows too heavy, becomes a black hole, and Newton
// is pulled in (stretched, spiralling, gone). Everything is driven by the
// cutscene clock fx.t (server time), so every player sees the same moment.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fx } from '../cutscenes/cutscenes';
import { comms } from '../play/einstein';
import { place } from './origin';
import { Figure } from './Figures';
import { BlackHole } from './phenomena/BlackHole';
import { v, type Body } from '../universe/bodies';

/** Where the opening happens: ahead of the ships' spawn point (they face -Z). */
export const OPEN = { x: 55, y: 8, z: 230 };
export const SHEET_Y = -4; // the sheet's flat height, relative to OPEN
export const DIP = { x: 0, z: -12 }; // the dip's centre on the sheet, relative to OPEN
const W = 9; // width of the dip

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** How deep the sheet is at t (0 flat .. ). */
export function dipDepth(t: number) {
  return t < 10.5 ? 0 : t < 12 ? ease((t - 10.5) / 1.5) * 6 : t < 19 ? 6 : 6 + ease((t - 19) / 2.5) * 14;
}
/** Height of the sheet at (x, z) relative to OPEN (a Plummer-shaped well). */
export function sheetY(x: number, z: number, t: number) {
  const d = Math.hypot(x - DIP.x, z - DIP.z);
  return SHEET_Y - dipDepth(t) * (W / Math.sqrt(d * d + W * W));
}

const SHEET_VERT = /* glsl */ `
uniform float uDepth;
uniform vec2 uDip;
varying vec2 vXZ;
varying float vD;
void main() {
  vec3 p = position;
  float d = length(p.xz - uDip);
  p.y -= uDepth * ${W.toFixed(1)} / sqrt(d * d + ${(W * W).toFixed(1)});
  vXZ = p.xz;
  vD = d;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const SHEET_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
varying vec2 vXZ;
varying float vD;
float gridLine(vec2 p, float s) {
  vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  float l = max(gridLine(vXZ, 3.0), gridLine(vXZ, 15.0) * 1.0);
  float edge = 1.0 - smoothstep(40.0, 68.0, length(vXZ));
  float glow = 0.5 + 0.5 * exp(-vD * 0.08);
  float pulse = 0.85 + 0.15 * sin(vD * 0.6 - uTime * 3.0);
  vec3 c = vec3(0.55, 0.85, 1.0) * l * glow * pulse * 1.6;
  gl_FragColor = vec4(c, l * edge * uAlpha);
}
`;

function Clock({ rate }: { rate: number }) {
  const hand = useRef<THREE.Mesh>(null);
  const a = useRef(0);
  useFrame((_, dt) => { a.current -= dt * rate * Math.PI; if (hand.current) hand.current.rotation.z = a.current; });
  const face = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.95, 1.1), toneMapped: false }), []);
  const dark = useMemo(() => new THREE.MeshBasicMaterial({ color: '#05070c' }), []);
  return (
    <group>
      <mesh material={face}><circleGeometry args={[1.25, 40]} /></mesh>
      <mesh material={dark} position={[0, 0, 0.01]}><circleGeometry args={[1.1, 40]} /></mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} material={face} position={[Math.sin(i * Math.PI / 6) * 0.92, Math.cos(i * Math.PI / 6) * 0.92, 0.02]} rotation={[0, 0, -i * Math.PI / 6]}>
          <boxGeometry args={[0.06, 0.2, 0.01]} />
        </mesh>
      ))}
      <mesh ref={hand} material={face} position={[0, 0, 0.03]}><boxGeometry args={[0.07, 1.6, 0.01]} /></mesh>
    </group>
  );
}

export function Opening() {
  const root = useRef<THREE.Group>(null);
  const ball = useRef<THREE.Mesh>(null);
  const marble = useRef<THREE.Mesh>(null);
  const newton = useRef<THREE.Group>(null);
  const einstein = useRef<THREE.Group>(null);
  const clocks = useRef<THREE.Group>(null);
  const holeShown = useRef(false);
  const holeGroup = useRef<THREE.Group>(null);
  const talkE = useRef(0), talkN = useRef(0), flailN = useRef(0), flailE = useRef(0);
  const look = useRef<THREE.Vector3 | null>(new THREE.Vector3());

  const sheet = useMemo(() => {
    const g = new THREE.PlaneGeometry(140, 140, 140, 140);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({
      vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uDepth: { value: 0 }, uDip: { value: new THREE.Vector2(DIP.x, DIP.z) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
    });
    return { g, m };
  }, []);
  const ballMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9e4ff', emissive: new THREE.Color(0.6, 0.75, 1.0), emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.2 }), []);
  const marbleMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.4), toneMapped: false }), []);
  // the black hole the ball becomes (visual only: it is not in the world's physics)
  const hole = useMemo<Body>(() => ({
    id: 'opening-hole', kind: 'black_hole', x: 0, y: 0, z: 0, radius: 0.01, gm: 0, rs: 0.01, core: 0, clockRs: 0, temp: 6500, seed: 7,
    drag: 0, period: 1, spinAxis: v(0, 1, 0), beamTilt: 0, rings: false, hue: 0, normal: v(0.15, 1, 0.25),
  }), []);

  useFrame(({ camera, clock }) => {
    const on = fx.active === 'intro';
    const g = root.current;
    if (!g) return;
    g.visible = on && fx.t < 24;
    if (holeGroup.current) holeGroup.current.visible = on && fx.t > 18.5 && fx.t < 24;
    if (!on) return;
    const t = fx.t;
    place(g, OPEN);
    camera.getWorldPosition(look.current!);

    sheet.m.uniforms.uDepth.value = dipDepth(t);
    sheet.m.uniforms.uAlpha.value = ease((t - 1) / 2.5);
    sheet.m.uniforms.uTime.value = clock.elapsedTime;

    // who is talking
    const age = performance.now() / 1000 - comms.shownAt;
    const talking = comms.line && age < 5;
    talkE.current += ((talking && comms.who === 'EINSTEIN' ? 1 : 0) - talkE.current) * 0.1;
    talkN.current += ((talking && comms.who === 'NEWTON' ? 1 : 0) - talkN.current) * 0.1;

    // the heavy ball drops in at 10 s and sits in the dip
    const bottom = sheetY(DIP.x, DIP.z, t);
    if (ball.current) {
      const drop = ease((t - 9.5) / 1.5);
      ball.current.visible = t > 9 && t < 19.5;
      ball.current.position.set(DIP.x, bottom + 1.6 + (1 - drop) * 18, DIP.z);
      const heavy = ease((t - 17.5) / 2);
      ballMat.emissiveIntensity = 1.4 * (1 - heavy);
      ballMat.color.setScalar(1 - heavy * 0.95);
    }
    // a marble rolls past and curves around the dip
    if (marble.current) {
      const s = (t - 12) / 4;
      marble.current.visible = s > 0 && s < 1;
      const a = -2.4 + s * 3.4;
      const r = 26 - Math.sin(s * Math.PI) * 15;
      const x = DIP.x + Math.cos(a) * r, z = DIP.z + Math.sin(a) * r;
      marble.current.position.set(x, sheetY(x, z, t) + 0.5, z);
    }
    // two clocks: high on the sheet, and down in the dip
    if (clocks.current) clocks.current.visible = t > 14.5 && t < 19.5;

    // Newton, then the pull
    const nStart = { x: 4.5, z: 4 };
    if (newton.current) {
      const s = ease((t - 19.8) / 3.6);
      flailN.current = t > 19.5 ? 1 : 0;
      const ang = Math.atan2(nStart.z - DIP.z, nStart.x - DIP.x) + s * s * 5;
      const r0 = Math.hypot(nStart.x - DIP.x, nStart.z - DIP.z);
      const r = r0 * (1 - s);
      const x = DIP.x + Math.cos(ang) * r, z = DIP.z + Math.sin(ang) * r;
      newton.current.position.set(x, sheetY(x, z, t) + s * 2, z);
      newton.current.rotation.set(s * 1.4, -s * 3, s * 0.8);
      newton.current.scale.set(1 - s * 0.85, 1 + s * 2.4, 1 - s * 0.85);
      newton.current.visible = s < 0.97;
    }
    if (einstein.current) {
      einstein.current.position.set(-4.5, sheetY(-4.5, 4, t), 4);
      flailE.current = t > 20.5 && t < 23 ? 0.35 : 0;
    }
    // the hole grows where the ball was
    hole.x = OPEN.x + DIP.x; hole.y = OPEN.y + bottom - 1; hole.z = OPEN.z + DIP.z;
    hole.rs = hole.radius = 0.01 + ease((t - 18.5) / 2) * 2.4;
    if (!holeShown.current && t > 18.5) holeShown.current = true;
  });

  return (
    <>
      <group ref={root} visible={false}>
        <mesh geometry={sheet.g} material={sheet.m} position={[0, 0, 0]} renderOrder={2} frustumCulled={false} />
        <mesh ref={ball} material={ballMat} visible={false}><sphereGeometry args={[1.6, 32, 24]} /></mesh>
        <mesh ref={marble} material={marbleMat} visible={false}><sphereGeometry args={[0.45, 16, 12]} /></mesh>
        <group ref={clocks} visible={false}>
          <group position={[-14, sheetY(-14, -2, 15) + 3.5, -2]} rotation={[0, 0.3, 0]}><Clock rate={1} /></group>
          <group position={[DIP.x + 4, sheetY(DIP.x + 4, DIP.z + 3, 15) + 2.6, DIP.z + 3]} rotation={[0, -0.2, 0]}><Clock rate={0.3} /></group>
        </group>
        <group ref={einstein}><Figure who="einstein" talk={talkE} flail={flailE} lookAt={look} /></group>
        <group ref={newton}><Figure who="newton" talk={talkN} flail={flailN} lookAt={look} /></group>
      </group>
      <group ref={holeGroup} visible={false}><BlackHole body={hole} /></group>
    </>
  );
}
