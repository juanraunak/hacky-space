// The opening, on foot: a small bridge whose whole nose is glass, no frames.
// Outside, space as a glowing rubber sheet with a star resting in the dip it
// makes (the trampoline picture). Newton and Einstein pace and argue at the
// glass in typed bubbles. The star grows heavier and the dip deepens; then it
// collapses into a spinning black hole and the dip becomes a deep funnel,
// matter spirals in, the ship shakes, the lights go red, the glass gives way
// and Newton is pulled out, bent round the hole like its light. Black. Then
// Einstein: "We have to find Newton." You take the pilot seat and fly.
//
// Everything after the argument runs from the 'collapse' room event's server
// time (play/onfoot.ts foot.c), so every player sees the same moment.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { place, origin } from './origin';
import { BlackHole } from './phenomena/BlackHole';
import { v, type Body } from '../universe/bodies';
import { Npc, SpeechBubble } from './Npc';
import { MatContext, makeLensMats, makeLensUniforms } from './toon';
import { LAPTOP } from './quality';
import { input, isTouch } from '../input/input';
import { net } from '../net';
import { remote } from '../play/game';
import {
  BEAT, COL, COPILOT, EYE, HOLE, HOLE_RS, OPEN, PILOT, ROOM, SCRIPT, SHEET_Y, STAR,
  beatNow, foot, npcs, saying, strain, type NpcDrive,
} from '../play/onfoot';

export { OPEN, STAR };

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeIn = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The star collapsing: 1 = star, 0 = gone. */
const starLeft = (c: number) => (c < 0 ? 1 : 1 - ease((c - COL.starOut) / 2));
/** The hole's size (rs) as it forms. */
const holeRs = (c: number) => (c < 0 ? 0 : ease((c - COL.hole) / 3) * HOLE_RS);
const RING = HOLE_RS * 2.6;

// --- the rubber sheet of space -------------------------------------------------
// A grid of lines plus a faint skin, displaced on the GPU: a soft dip under
// the star (Lorentzian, depth uA, width uW) plus a deep 1/r funnel once the
// hole forms (uF, uH), and ripples running outward while it collapses.

const SHEET_HALF = 62, SHEET_STEP = 3.1, SHEET_SUB = 90;

const SHEET_VERT = /* glsl */ `
uniform float uA; uniform float uW; uniform float uF; uniform float uH; uniform float uRip; uniform float uTime;
varying float vDepth; varying float vFade;
float dip(float r) {
  float rr = max(r, 0.6);
  return -uA / (1.0 + (rr * rr) / (uW * uW)) - uF * uH / (rr + uH);
}
void main() {
  vec3 p = position;
  float r = length(p.xz);
  float y = dip(r) + uRip * sin(r * 0.32 - uTime * 4.5) * exp(-r / 38.0);
  p.y += y;
  vDepth = clamp(-y / 14.0, 0.0, 1.0);
  vFade = 1.0 - smoothstep(SHEET_HALF * 0.62, SHEET_HALF, max(abs(position.x), abs(position.z)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`.replace(/SHEET_HALF/g, SHEET_HALF.toFixed(1));

const SHEET_FRAG = /* glsl */ `
uniform float uHot; uniform float uOpacity; uniform vec3 uCool;
varying float vDepth; varying float vFade;
void main() {
  vec3 hot = vec3(1.7, 0.75, 0.32);
  vec3 col = mix(uCool, hot, clamp(vDepth * 1.4, 0.0, 1.0) * uHot);
  float glow = 0.45 + 1.5 * vDepth;
  gl_FragColor = vec4(col * glow * vFade * uOpacity, 1.0);
}
`;

/** Where the sheet is at distance r from the star's axis (same as the shader). */
export function sheetDip(r: number, u: SheetUniforms) {
  const rr = Math.max(r, 0.6);
  return -u.uA.value / (1 + (rr * rr) / (u.uW.value * u.uW.value)) - u.uF.value * u.uH.value / (rr + u.uH.value);
}

type U = { value: number };
interface SheetUniforms { uA: U; uW: U; uF: U; uH: U; uRip: U; uTime: U; uHot: U }

function useSheet() {
  return useMemo(() => {
    const u: SheetUniforms = { uA: { value: 4 }, uW: { value: 12 }, uF: { value: 0 }, uH: { value: 6 }, uRip: { value: 0 }, uTime: { value: 0 }, uHot: { value: 0 } };
    const make = (opacity: number, cool: THREE.Color) => new THREE.ShaderMaterial({
      uniforms: { ...u, uOpacity: { value: opacity }, uCool: { value: cool } },
      vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    // grid lines, each cut into many short pieces so they can bend
    const n = Math.round((SHEET_HALF * 2) / SHEET_STEP) + 1;
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = -SHEET_HALF + i * SHEET_STEP;
      for (let j = 0; j < SHEET_SUB; j++) {
        const b0 = -SHEET_HALF + (j / SHEET_SUB) * SHEET_HALF * 2, b1 = -SHEET_HALF + ((j + 1) / SHEET_SUB) * SHEET_HALF * 2;
        pts.push(a, 0, b0, a, 0, b1, b0, 0, a, b1, 0, a);
      }
    }
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const skin = new THREE.PlaneGeometry(SHEET_HALF * 2, SHEET_HALF * 2, 110, 110);
    skin.rotateX(-Math.PI / 2);
    return {
      u, lines, skin,
      lineMat: make(1, new THREE.Color(0.32, 0.78, 1.25)),
      skinMat: make(0.07, new THREE.Color(0.25, 0.45, 1.0)),
    };
  }, []);
}

// --- materials -------------------------------------------------------------

const std = (color: string, roughness = 0.6, metalness = 0.25) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const glow = (r: number, g: number, b: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });

function screenTexture(r: number, g: number, b: number, seed: number) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  if (x) {
    const col = (a: number) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
    x.fillStyle = col(0.12); x.fillRect(0, 0, 256, 96);
    x.strokeStyle = col(0.35); x.lineWidth = 1;
    for (let i = 0; i < 96; i += 12) { x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
    x.strokeStyle = col(1); x.lineWidth = 3; x.beginPath();
    for (let i = 0; i <= 256; i += 4) x.lineTo(i, 48 + Math.sin(i * 0.05 + seed) * 22 * Math.sin(i * 0.013 + seed * 2));
    x.stroke();
    x.fillStyle = col(0.9);
    for (let i = 0; i < 6; i++) x.fillRect(12 + i * 40, 78, 26, 8 - (i % 3) * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The glass at each side of the nose: the room's profile from the front to z = -1.2. */
const GLASS_BACK = -1.2;
function sideGlassGeometry() {
  // in (u = -z, v = y)
  const s = new THREE.Shape();
  s.moveTo(-GLASS_BACK, 0);
  s.lineTo(-ROOM.z0, 0);
  s.lineTo(-ROOM.z0, 1.85);
  s.absarc(2.75, 1.85, 1.25, 0, Math.PI / 2, false);
  s.lineTo(-GLASS_BACK, ROOM.h);
  s.lineTo(-GLASS_BACK, 0);
  return new THREE.ShapeGeometry(s, 20);
}

const PARTS = 700;
const SHARDS = 70;

// --- the room ------------------------------------------------------------------

function Cabin({ strips, seatGlow, door, glassRef }: { strips: THREE.Material; seatGlow: THREE.Material; door: THREE.Material; glassRef: React.RefObject<THREE.Group | null> }) {
  const m = useMemo(() => ({
    floor: std('#272c36', 0.75, 0.2),
    walk: std('#1c2028', 0.85, 0.1),
    wall: std('#363c4a', 0.65, 0.2),
    trim: std('#1f232c', 0.5, 0.4),
    ceil: std('#21252e', 0.8, 0.15),
    panel: std('#2d323e', 0.55, 0.3),
    leather: std('#b4623a', 0.55, 0.05),
    seatFrame: std('#2a2f3a', 0.45, 0.45),
    shade: std('#2b2f38', 0.5, 0.5),
    bench: std('#3c4760', 0.7, 0.05),
    glass: new THREE.MeshBasicMaterial({ color: '#b4dcff', transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide }),
    glassFloor: new THREE.MeshBasicMaterial({ color: '#9fcfff', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }),
    bulb: glow(3.4, 2.1, 1.1),
    dots: glow(0.25, 0.75, 1.3),
    amber: glow(1.6, 0.85, 0.25),
    green: glow(0.3, 1.3, 0.55),
    screens: [screenTexture(0.3, 0.9, 1, 1), screenTexture(1, 0.65, 0.25, 2)].map(t => new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new THREE.Color(1.25, 1.25, 1.25) })),
  }), []);
  const sideGlass = useMemo(sideGlassGeometry, []);
  const canopy = useMemo(() => new THREE.CylinderGeometry(1.25, 1.25, ROOM.x1 - ROOM.x0, 24, 1, true, Math.PI / 2, Math.PI / 2), []);
  const W = ROOM.x1 - ROOM.x0;
  const solidD = ROOM.z1 - GLASS_BACK, solidZ = (ROOM.z1 + GLASS_BACK) / 2;
  const floorFront = -3.0; // the floor is glass in front of this

  return (
    <group>
      {/* floor, a darker walkway with guide lights, glowing edges along the walls */}
      <mesh material={m.floor} position={[0, -0.05, (floorFront + ROOM.z1) / 2]}><boxGeometry args={[W, 0.1, ROOM.z1 - floorFront]} /></mesh>
      <mesh material={m.walk} position={[0, 0.004, 1.2]}><boxGeometry args={[2.1, 0.01, 5.6]} /></mesh>
      {[-1.05, 1.05].flatMap(x => [-1.2, -0.4, 0.4, 1.2, 2.0, 2.8, 3.6].map(z => (
        <mesh key={`${x},${z}`} material={m.dots} position={[x, 0.012, z]}><boxGeometry args={[0.05, 0.01, 0.16]} /></mesh>
      )))}
      {[-1, 1].map(s => <mesh key={s} material={strips} position={[s * 3.96, 0.04, solidZ]}><boxGeometry args={[0.04, 0.04, solidD - 0.1]} /></mesh>)}

      {/* ceiling (solid behind the glass) with two cool light strips */}
      <mesh material={m.ceil} position={[0, ROOM.h + 0.05, solidZ]}><boxGeometry args={[W, 0.1, solidD]} /></mesh>
      {[-1.3, 1.3].map(x => <mesh key={x} material={strips} position={[x, ROOM.h - 0.01, solidZ + 0.2]}><boxGeometry args={[0.07, 0.03, solidD - 1.2]} /></mesh>)}

      {/* side walls behind the glass, with a little trim */}
      {[-1, 1].map(s => (
        <group key={s}>
          <mesh material={m.wall} position={[s * 4.05, ROOM.h / 2, solidZ]}><boxGeometry args={[0.1, ROOM.h, solidD]} /></mesh>
          <mesh material={m.trim} position={[s * 3.98, 1.1, solidZ]}><boxGeometry args={[0.05, 0.05, solidD]} /></mesh>
          <mesh material={strips} position={[s * 3.98, 2.72, solidZ + 0.3]}><boxGeometry args={[0.03, 0.03, solidD - 0.6]} /></mesh>
          {[0.6, 2.2, 3.6].map(z => <mesh key={z} material={m.trim} position={[s * 3.98, 1.55, z]}><boxGeometry args={[0.04, 3.1, 0.05]} /></mesh>)}
        </group>
      ))}

      {/* back wall and the door, its frame glowing warm */}
      <mesh material={m.wall} position={[0, ROOM.h / 2, ROOM.z1 + 0.05]}><boxGeometry args={[W, ROOM.h, 0.1]} /></mesh>
      <mesh material={m.panel} position={[0, 1.15, ROOM.z1 - 0.03]}><boxGeometry args={[1.4, 2.3, 0.05]} /></mesh>
      <mesh material={door} position={[0, 2.33, ROOM.z1 - 0.05]}><boxGeometry args={[1.5, 0.04, 0.03]} /></mesh>
      {[-1, 1].map(s => <mesh key={s} material={door} position={[s * 0.73, 1.16, ROOM.z1 - 0.05]}><boxGeometry args={[0.04, 2.32, 0.03]} /></mesh>)}

      {/* two small pedestal consoles, low, so nothing blocks the glass */}
      {[PILOT, COPILOT].map((p, i) => (
        <group key={i} position={[p.x, 0, -2.75]}>
          <mesh material={m.panel} position={[0, 0.34, 0]}><boxGeometry args={[0.5, 0.68, 0.36]} /></mesh>
          <group position={[0, 0.72, 0]} rotation={[0.5, 0, 0]}>
            <mesh material={m.trim}><boxGeometry args={[0.56, 0.05, 0.42]} /></mesh>
            <mesh material={m.screens[i]} position={[0, 0.028, -0.02]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.46, 0.3]} /></mesh>
            {[-0.16, 0, 0.16].map((x, j) => (
              <mesh key={j} material={j === 0 ? m.amber : j === 1 ? m.green : m.dots} position={[x, 0.03, 0.16]}><boxGeometry args={[0.05, 0.02, 0.05]} /></mesh>
            ))}
          </group>
        </group>
      ))}

      {/* the two seats, warm leather */}
      {[PILOT, COPILOT].map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh material={m.seatFrame} position={[0, 0.17, 0]}><cylinderGeometry args={[0.1, 0.16, 0.34, 10]} /></mesh>
          <mesh material={m.leather} position={[0, 0.41, 0]}><boxGeometry args={[0.62, 0.14, 0.6]} /></mesh>
          <mesh material={m.leather} position={[0, 0.88, 0.31]} rotation={[0.15, 0, 0]}><boxGeometry args={[0.62, 0.78, 0.12]} /></mesh>
          <mesh material={m.leather} position={[0, 1.38, 0.38]} rotation={[0.15, 0, 0]}><boxGeometry args={[0.4, 0.22, 0.1]} /></mesh>
          {[-1, 1].map(s => <mesh key={s} material={m.seatFrame} position={[s * 0.34, 0.62, 0.02]}><boxGeometry args={[0.07, 0.07, 0.5]} /></mesh>)}
          {i === 0 && [-1, 1].map(s => (
            <mesh key={s} material={seatGlow} position={[s * 0.32, 0.9, 0.38]} rotation={[0.15, 0, 0]}><boxGeometry args={[0.025, 0.74, 0.025]} /></mesh>
          ))}
        </group>
      ))}

      {/* warm pendant lamps over the back */}
      {[-2, 2].map(x => (
        <group key={x} position={[x, 0, 2.4]}>
          <mesh material={m.trim} position={[0, 2.84, 0]}><cylinderGeometry args={[0.012, 0.012, 0.52, 4]} /></mesh>
          <mesh material={m.shade} position={[0, 2.5, 0]}><coneGeometry args={[0.28, 0.24, 16, 1, true]} /></mesh>
          <mesh material={m.bulb} position={[0, 2.4, 0]}><sphereGeometry args={[0.085, 12, 8]} /></mesh>
        </group>
      ))}

      {/* a bench on the right, lockers on the left */}
      <mesh material={m.seatFrame} position={[3.62, 0.2, 1.8]}><boxGeometry args={[0.7, 0.4, 2.4]} /></mesh>
      <mesh material={m.bench} position={[3.6, 0.44, 1.8]}><boxGeometry args={[0.62, 0.08, 2.3]} /></mesh>
      <mesh material={m.panel} position={[-3.72, 1.1, 1.9]}><boxGeometry args={[0.55, 2.2, 2.0]} /></mesh>
      {[1.25, 1.9, 2.55].map(z => <mesh key={z} material={m.trim} position={[-3.44, 1.1, z]}><boxGeometry args={[0.02, 2.1, 0.03]} /></mesh>)}
      {[1.55, 2.2].map(z => <mesh key={z} material={m.green} position={[-3.43, 1.5, z]}><boxGeometry args={[0.02, 0.05, 0.05]} /></mesh>)}

      {/* the glass nose: one frameless sweep (floor strip, front, curve, roof, sides) */}
      <mesh material={m.glassFloor} position={[0, 0, (ROOM.z0 + floorFront) / 2]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[W, floorFront - ROOM.z0]} /></mesh>
      <group ref={glassRef}>
        <mesh material={m.glass} position={[0, 0.925, ROOM.z0]}><planeGeometry args={[W, 1.85]} /></mesh>
        <mesh geometry={canopy} material={m.glass} position={[0, 1.85, -2.75]} rotation={[0, 0, Math.PI / 2]} />
        <mesh material={m.glass} position={[0, ROOM.h, (-2.75 + GLASS_BACK) / 2]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[W, GLASS_BACK + 2.75]} /></mesh>
        {[-1, 1].map(s => <mesh key={s} geometry={sideGlass} material={m.glass} position={[s * ROOM.x1, 0, 0]} rotation={[0, Math.PI / 2, 0]} />)}
      </group>
    </group>
  );
}

// --- choreography ------------------------------------------------------------------

interface Mover { key: string; path: [number, number][]; speed: number; dir: number }
const newMover = (): Mover => ({ key: '', path: [], speed: 1.2, dir: 0 });

/** Straight there, unless that cuts through the seats and console: then round by the aisle. */
function plan(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const bx0 = -1.5, bx1 = 1.5, bz0 = -3.9, bz1 = -1.45;
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  const hit = clip(-dx, x0 - bx0) && clip(dx, bx1 - x0) && clip(-dz, z0 - bz0) && clip(dz, bz1 - z0);
  if (!hit) return [[x1, z1]];
  const aisle = -0.95;
  const out: [number, number][] = [];
  if (z0 < aisle) out.push([x0, aisle]);
  if (z1 < aisle) out.push([x1, aisle]);
  out.push([x1, z1]);
  return out;
}

const angleLerp = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

function goTo(d: NpcDrive, m: Mover, key: string, x: number, z: number, speed = 1.2) {
  if (m.key !== key) { m.key = key; m.path = plan(d.x, d.z, x, z); m.speed = speed; }
}

function stepMover(d: NpcDrive, m: Mover, faceYaw: number, dt: number) {
  let sp = 0;
  while (m.path.length) {
    const [tx, tz] = m.path[0];
    const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
    const last = m.path.length === 1;
    if (dist < (last ? 0.02 : 0.2)) { if (last) { m.path = []; break; } m.path.shift(); continue; }
    sp = last ? Math.min(m.speed, 0.3 + dist * 2) : m.speed;
    const s = Math.min(dist, sp * dt);
    d.x += (dx / dist) * s; d.z += (dz / dist) * s; d.stride += s;
    m.dir = Math.atan2(dx, dz);
    break;
  }
  const walking = sp > 0.05;
  d.moving += ((walking ? Math.min(1, sp / 1.1) : 0) - d.moving) * (1 - Math.exp(-dt * 8));
  d.yaw = angleLerp(d.yaw, walking ? m.dir : faceYaw, 1 - Math.exp(-dt * (walking ? 7 : 4.5)));
}

const SPOT = {
  eIdle: [-2.9, -3.3], nIdleA: [1.5, -0.7], nIdleB: [2.8, -2.8],
  n0: [-1.85, -1.45], e1: [-2.7, -3.45], n2: [1.6, -0.5], e3: [-1.75, -1.25],
  nCol: [2.75, -3.25], eCol: [-2.75, -3.4], eReach: [-2.35, -3.45],
  eAfter: [1.75, -0.95], eSeat: [COPILOT.x, -1.45],
} as const;

type Arm = [number, number];
const BEHIND: Arm = [0.35, -0.12];
const DOWN: Arm = [0, 0.06];
const UP: Arm = [-2.6, 0.45];
const CROSS: Arm = [-1.35, -0.5];
const HIPS: Arm = [0.15, 0.6];
const POINT: Arm = [-1.65, 0.1];
const SPREAD: Arm = [-0.75, 1.15];

// --- the scene ---------------------------------------------------------------------

export function Opening() {
  const root = useRef<THREE.Group>(null);
  const star = useRef<THREE.Mesh>(null);
  const glassFront = useRef<THREE.Group>(null);
  const holeGroup = useRef<THREE.Group>(null);
  const shards = useRef<THREE.InstancedMesh>(null);
  const cool = useRef<THREE.PointLight>(null);
  const warmA = useRef<THREE.PointLight>(null);
  const warmB = useRef<THREE.PointLight>(null);
  const consoleL = useRef<THREE.PointLight>(null);
  const starL = useRef<THREE.PointLight>(null);
  const red = useRef<THREE.PointLight>(null);
  const sheet = useSheet();
  const starPos = useRef({ x: STAR.x, y: STAR.y, z: STAR.z });
  const movers = useRef({ newton: newMover(), einstein: newMover() });
  const pull = useRef<{ x: number; z: number; yaw: number } | null>(null);
  const tv = useRef({ eye: new THREE.Vector3(), nHead: new THREE.Vector3(), eHead: new THREE.Vector3(), star: new THREE.Vector3(), lookN: new THREE.Vector3(), lookE: new THREE.Vector3(), pN: new THREE.Vector3(), pE: new THREE.Vector3() });

  const starMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.6, 2.0), toneMapped: false }), []);
  const strips = useMemo(() => glow(0.3, 1.0, 1.6), []);
  const seatGlow = useMemo(() => glow(1.6, 0.8, 0.25), []);
  const door = useMemo(() => glow(1.4, 0.75, 0.3), []);
  const shardMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1.3, 1.8), transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const shardGeo = useMemo(() => new THREE.CircleGeometry(0.12, 3), []);
  const shardSeed = useMemo(() => Array.from({ length: SHARDS }, () => [Math.random(), Math.random(), Math.random(), Math.random()]), []);
  const lens = useMemo(() => makeLensUniforms(), []);
  const lensMats = useMemo(() => makeLensMats(lens), [lens]);
  const partData = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PARTS * 3), 3));
    const seed = new Float32Array(PARTS * 3);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    const m = new THREE.PointsMaterial({ color: new THREE.Color(2.4, 1.4, 0.6), size: 0.6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    return { g, m, seed };
  }, []);
  const hole = useMemo<Body>(() => ({
    id: 'opening-hole', kind: 'black_hole', x: 0, y: 0, z: 0, radius: 0.01, gm: 0, rs: 0.01, core: 0, clockRs: 0, temp: 6500, seed: 7,
    drag: 0, period: 1, spinAxis: v(0, 1, 0), beamTilt: 0, rings: false, hue: 0, normal: v(0.12, 1, 0.3),
  }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ camera, clock }, rawDt) => {
    const g = root.current;
    if (!g) return;
    const on = foot.mode === 'foot';
    g.visible = on;
    const c = foot.c;
    if (holeGroup.current) holeGroup.current.visible = on && c > COL.hole;
    if (!on) return;
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    place(g, OPEN);
    const ox = OPEN.x - origin.x, oy = OPEN.y - origin.y, oz = OPEN.z - origin.z;
    const V = tv.current;
    const toScene = (out: THREE.Vector3, x: number, y: number, z: number) => out.set(ox + x, oy + y, oz + z);
    camera.getWorldPosition(V.eye);

    // --- the sheet of space: a dip under the star, then a funnel -------------
    const u = sheet.u;
    const heavy = c >= 0 ? ease(c / COL.starOut) : 0; // the star swelling, heavier
    const fall = c >= 0 ? ease((c - COL.starOut) / 3.5) : 0; // collapse into the hole
    u.uA.value = (4 + 2.5 * foot.bend + 3 * heavy) * (1 - fall) + 3 * fall;
    u.uW.value = 12 - 2 * fall;
    u.uF.value = 30 * fall;
    u.uRip.value = c >= 0 ? (c < COL.starOut ? 0.15 * heavy : 0.7 * (1 - ease((c - 6) / 7)) + 0.1) : 0;
    u.uTime.value = t;
    const red01 = c >= 0 ? ease((c - COL.hole) / 3) : 0;
    u.uHot.value = red01;

    // --- the star resting in the dip, then sinking and gone --------------------
    const left = starLeft(c);
    const anger = c >= 0 && c < COL.starOut + 0.5 ? heavy : 0;
    const R = 5 * left * (1 + anger * 0.35);
    const sp0 = starPos.current;
    sp0.x = STAR.x; sp0.z = STAR.z;
    const rest = SHEET_Y + sheetDip(R * 0.5, u) + R * 0.75;
    sp0.y = c < COL.starOut ? rest : rest + (HOLE.y - rest) * ease((c - COL.starOut) / 2);
    toScene(V.star, sp0.x, sp0.y, sp0.z);
    if (star.current) {
      star.current.visible = left > 0.02;
      const flick = anger ? 1 + Math.sin(t * 31) * 0.06 * anger + Math.sin(t * 13) * 0.04 * anger : 1 + Math.sin(t * 1.7) * 0.015;
      star.current.position.set(sp0.x, sp0.y, sp0.z);
      star.current.scale.setScalar(Math.max(0.01, R * flick));
      starMat.color.setRGB(3.2 + anger * 4, 2.6 + anger * 1.6, 2.0 + anger * 0.4);
    }

    // --- matter spiralling down the funnel once the hole forms ------------------
    const pp = partData.g.getAttribute('position') as THREE.BufferAttribute;
    partData.m.opacity = c >= 0 ? ease((c - COL.hole) / 2) * 0.9 : 0;
    if (partData.m.opacity > 0) {
      for (let i = 0; i < PARTS; i++) {
        const s0 = partData.seed[i * 3], s1 = partData.seed[i * 3 + 1], s2 = partData.seed[i * 3 + 2];
        const life = (t * 0.22 + s0) % 1;
        const r = 7 + (1 - life) * (14 + s1 * 40);
        const ang = s2 * 6.283 + life * 10 + t * 0.4;
        pp.setXYZ(i, HOLE.x + Math.cos(ang) * r, SHEET_Y + sheetDip(r, u) + 0.4 + (s1 - 0.5) * 0.8, HOLE.z + Math.sin(ang) * r);
      }
      pp.needsUpdate = true;
    }

    // --- the hole, forming where the star was -----------------------------------
    hole.x = OPEN.x + HOLE.x; hole.y = OPEN.y + HOLE.y; hole.z = OPEN.z + HOLE.z;
    hole.rs = hole.radius = 0.01 + holeRs(c);

    // --- the glass gives way, and comes back as a field after the black --------
    const broken = c >= COL.glass && c < COL.blackFull;
    if (glassFront.current) glassFront.current.visible = !broken;
    const sh = shards.current;
    if (sh) {
      const sc = c - COL.glass;
      sh.visible = sc > 0 && sc < 2.7;
      if (sh.visible) {
        const ex = pull.current ? Math.max(-3.4, Math.min(3.4, pull.current.x)) : 2.5;
        for (let i = 0; i < SHARDS; i++) {
          const [r0, r1, r2, r3] = shardSeed[i];
          const x0 = ex + (r0 - 0.5) * 3.5, y0 = 0.4 + r1 * 1.4, z0 = ROOM.z0;
          const k = sc * (2 + r2 * 3) + sc * sc * 6;
          const dx = HOLE.x - x0, dy = HOLE.y - y0, dz = HOLE.z - z0, dl = Math.hypot(dx, dy, dz);
          dummy.position.set(x0 + (dx / dl) * k + (r3 - 0.5) * sc * 2, y0 + (dy / dl) * k + (r0 - 0.5) * sc, z0 + (dz / dl) * k);
          dummy.rotation.set(sc * (3 + r1 * 8), sc * (2 + r2 * 6), r3 * 6);
          dummy.scale.setScalar(0.6 + r2 * 1.2);
          dummy.updateMatrix();
          sh.setMatrixAt(i, dummy.matrix);
        }
        sh.instanceMatrix.needsUpdate = true;
        shardMat.opacity = 0.85 * (1 - sc / 2.7);
      }
    }

    // --- the lights: cool and warm, then flicker red, then emergency ------------
    const st = strain();
    const after = c >= COL.blackFull;
    const flick = st > 0.2 ? (Math.sin(t * 23) + Math.sin(t * 37 + 1) > 0.3 ? 1 : 0.2) : 1;
    const alarm = 0.5 + 0.5 * Math.sin(t * (after ? 2.2 : 6));
    if (cool.current) {
      cool.current.intensity = after ? 6 : 16 * flick * (1 - 0.55 * st);
      cool.current.color.setRGB(0.66 + st * 0.34, 0.78 * (1 - st * 0.6), 1 * (1 - st * 0.7));
    }
    if (warmA.current) warmA.current.intensity = after ? 5 : 7 * (st > 0.2 ? flick : 1);
    if (warmB.current) warmB.current.intensity = after ? 4 * (Math.sin(t * 17) + Math.sin(t * 5.3) > -0.6 ? 1 : 0.15) : 7 * (st > 0.2 ? 1.2 - flick * 0.4 : 1);
    if (red.current) red.current.intensity = st > 0.1 ? 14 * st * alarm : after ? 3 * alarm : 0;
    if (consoleL.current) consoleL.current.intensity = after ? 2.5 : 4 * flick;
    if (starL.current) {
      const hot = c < 0 ? 1 : left;
      starL.current.intensity = 22 * hot * (1 + anger) + (c > COL.hole ? 9 * red01 : 0);
      starL.current.color.setRGB(1, 0.86 * hot + 0.55 * (1 - hot), 0.72 * hot + 0.3 * (1 - hot));
    }
    strips.color.setRGB(
      after ? 0.25 + 0.4 * alarm : 0.3 + st * 2.2 * flick,
      (after ? 0.6 : 1.0) * (1 - st * 0.75) * (st > 0.2 ? flick : 1),
      (after ? 1.1 : 1.6) * (1 - st * 0.8) * (st > 0.2 ? flick : 1),
    );
    const seatOn = c >= COL.lit && !foot.sitAt;
    const sp = seatOn ? 1.2 + 1.6 * (0.5 + 0.5 * Math.sin(t * 3.2)) : 0.5;
    seatGlow.color.setRGB(1.6 * sp, 0.8 * sp, 0.25 * sp);

    choreograph(dt, t);
  });

  /** Where they walk, which way they face, what their hands do. */
  function choreograph(dt: number, t: number) {
    const N_ = npcs.newton, E = npcs.einstein, mv = movers.current;
    const V = tv.current;
    const ox = OPEN.x - origin.x, oy = OPEN.y - origin.y, oz = OPEN.z - origin.z;
    V.nHead.set(ox + N_.x, oy + 1.85, oz + N_.z);
    V.eHead.set(ox + E.x, oy + 1.85, oz + E.z);
    const eyeLocal = { x: foot.x, z: foot.z };
    // the nearest person on foot (me, or another player) for heads to turn to
    const nearestEye = (d: NpcDrive, out: THREE.Vector3) => {
      let bx = foot.x, bz = foot.z, bd = Math.hypot(foot.x - d.x, foot.z - d.z);
      const me = net.identity();
      for (const [id, r] of remote) {
        if (id === me || r.row.status !== 'home') continue;
        const x = r.x - OPEN.x, z = r.z - OPEN.z, dd = Math.hypot(x - d.x, z - d.z);
        if (dd < bd) { bd = dd; bx = x; bz = z; }
      }
      if (bx === foot.x && bz === foot.z) return out.copy(V.eye);
      return out.set(ox + bx, oy + EYE, oz + bz);
    };
    const face = (d: NpcDrive, x: number, z: number) => Math.atan2(x - d.x, z - d.z);
    const faceStar = (d: NpcDrive) => face(d, STAR.x, STAR.z);
    const playerNear = (d: NpcDrive, r: number) => Math.hypot(eyeLocal.x - d.x, eyeLocal.z - d.z) < r;
    const lookAt = (d: NpcDrive, out: THREE.Vector3, target: THREE.Vector3) => { out.copy(target); d.look = out; };
    const c = foot.c;
    const sN = saying('newton'), sE = saying('einstein');
    N_.talk = sN && sN.shown < sN.text.length ? 1 : sN ? 0.3 : 0;
    E.talk = sE && sE.shown < sE.text.length ? 1 : sE ? 0.3 : 0;
    N_.shake = 0; E.shake = 0; N_.flail = 0; E.flail = 0;
    let nFace = N_.yaw, eFace = E.yaw;

    if (c >= 0) {
      // ---- the collapse ----
      const st = strain();
      if (c < COL.pull) {
        goTo(N_, mv.newton, 'nCol', SPOT.nCol[0], SPOT.nCol[1], 1.6);
        nFace = faceStar(N_);
        N_.armR = c < 3.2 ? POINT : [-2.2, -0.3];
        N_.armL = c < 3.2 ? [-0.5, 0.4] : [-2.0, -0.3];
        N_.flail = c > COL.starOut ? 0.35 * st : 0;
        lookAt(N_, V.lookN, V.star);
      }
      if (c < COL.blackFull) {
        const reaching = c >= COL.pull && c < COL.gone;
        if (reaching) goTo(E, mv.einstein, 'eReach', SPOT.eReach[0], SPOT.eReach[1], 1.3);
        else goTo(E, mv.einstein, 'eCol', SPOT.eCol[0], SPOT.eCol[1], 1.4);
        eFace = reaching ? face(E, N_.x, N_.z) : faceStar(E);
        E.armL = c < COL.starOut ? [-2.0, -0.25] : reaching ? [-1.3, 0.3] : c < COL.gone ? [-1.9, -0.2] : DOWN;
        E.armR = c < COL.starOut ? [-2.0, -0.25] : reaching ? [-1.65, 0.15] : c < COL.gone ? [-1.9, -0.2] : DOWN;
        E.flail = c > COL.starOut && c < COL.gone ? 0.25 * st : 0;
        if (reaching && N_.visible) lookAt(E, V.lookE, V.nHead.set(ox + N_.x, oy + N_.y + 1.4, oz + N_.z));
        else lookAt(E, V.lookE, V.star);
      } else {
        // after the black: Einstein by the co-pilot seat, then in it
        if (mv.einstein.key !== 'after' && mv.einstein.key !== 'seat' && mv.einstein.key !== 'sat') {
          E.x = SPOT.eAfter[0]; E.z = SPOT.eAfter[1]; E.yaw = face(E, eyeLocal.x, eyeLocal.z);
          mv.einstein.key = 'after'; mv.einstein.path = [];
        }
        if (c < COL.sit) {
          eFace = face(E, eyeLocal.x, eyeLocal.z);
          E.armL = DOWN; E.armR = sE ? [-0.9, 0.35] : DOWN;
          E.seated = 0;
        } else {
          if (mv.einstein.key === 'after') goTo(E, mv.einstein, 'seat', SPOT.eSeat[0], SPOT.eSeat[1], 1.0);
          if (mv.einstein.key === 'seat' && !mv.einstein.path.length) { mv.einstein.key = 'sat'; }
          eFace = Math.PI;
          if (mv.einstein.key === 'sat') {
            E.seated = Math.min(1, E.seated + dt * 1.5);
            E.z += (COPILOT.z + 0.05 - E.z) * (1 - Math.exp(-dt * 4));
            E.x += (COPILOT.x - E.x) * (1 - Math.exp(-dt * 4));
          }
          E.armL = DOWN; E.armR = DOWN;
        }
        lookAt(E, V.lookE, nearestEye(E, V.pE));
      }
      // Newton pulled out through the glass, then bent round the hole
      stepNewtonPull(c);
    } else if (foot.tau >= 0) {
      // ---- the argument ----
      const i = beatNow();
      const s = i >= 0 && i < SCRIPT.length ? foot.tau - BEAT[i] : 0;
      const len = i >= 0 && i < SCRIPT.length ? BEAT[i + 1] - BEAT[i] : 1;
      const f = s / len;
      if (i === 0) {
        goTo(N_, mv.newton, 'n0', SPOT.n0[0], SPOT.n0[1], 1.5);
        nFace = face(N_, E.x, E.z);
        N_.armL = f < 0.45 ? UP : [-0.4, 0.25];
        N_.armR = f < 0.45 ? UP : [-1.6 + 1.1 * Math.max(0, Math.sin(s * 7)), 0.15];
        lookAt(N_, V.lookN, V.eHead);
        eFace = face(E, N_.x, N_.z); E.armL = BEHIND; E.armR = BEHIND;
        lookAt(E, V.lookE, V.nHead);
      } else if (i === 1) {
        if (s > 0.9) goTo(E, mv.einstein, 'e1', SPOT.e1[0], SPOT.e1[1], 0.9);
        eFace = s < 0.9 ? face(E, N_.x, N_.z) : faceStar(E);
        E.shake = s < 0.9 ? 1 : 0;
        E.armR = s < 0.9 ? [-0.6, 0.3] : POINT;
        E.armL = s < 0.9 ? [-0.5, 0.3] : [-0.8, 0.85];
        lookAt(E, V.lookE, s > 1 && s < 2.6 ? V.star : V.nHead);
        nFace = face(N_, E.x, E.z); N_.armL = HIPS; N_.armR = HIPS;
        lookAt(N_, V.lookN, s > 1.2 && s < 2.8 ? V.star : V.eHead);
      } else if (i === 2) {
        if (f > 0.3) goTo(N_, mv.newton, 'n2', SPOT.n2[0], SPOT.n2[1], 1.3);
        nFace = face(N_, E.x, E.z);
        N_.armR = f < 0.35 ? [-1.3, 0.3 + 0.5 * Math.sin(s * 14)] : f > 0.65 ? SPREAD : DOWN;
        N_.armL = f > 0.65 ? SPREAD : DOWN;
        lookAt(N_, V.lookN, V.eHead);
        eFace = face(E, N_.x, N_.z); E.armL = BEHIND; E.armR = BEHIND;
        E.shake = f > 0.4 && f < 0.6 ? 0.5 : 0;
        lookAt(E, V.lookE, V.nHead);
      } else if (i === 3) {
        goTo(E, mv.einstein, 'e3', SPOT.e3[0], SPOT.e3[1], 1.0);
        const pointing = f > 0.55;
        eFace = pointing ? faceStar(E) : face(E, N_.x, N_.z);
        E.armR = pointing ? POINT : [-2.6, 0.05];
        E.armL = pointing ? [-0.7, 0.7] : BEHIND;
        lookAt(E, V.lookE, pointing ? V.star : V.nHead);
        nFace = face(N_, E.x, E.z); N_.armL = CROSS; N_.armR = CROSS;
        lookAt(N_, V.lookN, pointing ? V.star : V.eHead);
      } else {
        // done: both look out at the star
        nFace = faceStar(N_); eFace = faceStar(E);
        N_.armL = CROSS; N_.armR = CROSS; E.armL = BEHIND; E.armR = BEHIND;
        lookAt(N_, V.lookN, V.star); lookAt(E, V.lookE, V.star);
      }
    } else {
      // ---- before anyone walks up: Einstein at the glass, Newton pacing ----
      goTo(E, mv.einstein, 'eIdle', SPOT.eIdle[0], SPOT.eIdle[1]);
      eFace = playerNear(E, 5.5) && Math.sin(t * 0.4) > 0.3 ? face(E, eyeLocal.x, eyeLocal.z) : faceStar(E);
      E.armL = BEHIND; E.armR = BEHIND;
      lookAt(E, V.lookE, Math.sin(t * 0.4) > 0.3 ? nearestEye(E, V.pE) : V.star);
      const leg = Math.floor(t / 5.5) % 2;
      const spot = leg ? SPOT.nIdleA : SPOT.nIdleB;
      goTo(N_, mv.newton, leg ? 'nA' : 'nB', spot[0], spot[1], 0.8);
      nFace = face(N_, E.x, E.z);
      N_.armR = [-1.9, -0.45]; // a hand at his chin
      N_.armL = [-0.9, -0.35];
      N_.talk = Math.sin(t * 0.7) > 0.6 ? 0.5 : 0;
      lookAt(N_, V.lookN, playerNear(N_, 4) ? nearestEye(N_, V.pN) : V.eHead);
    }

    if (!pull.current) stepMover(N_, mv.newton, nFace, dt);
    stepMover(E, mv.einstein, eFace, dt);
  }

  function stepNewtonPull(c: number) {
    const N_ = npcs.newton;
    if (c < COL.pull) { N_.visible = true; lens.uStrength.value = 0; return; }
    if (!pull.current) pull.current = { x: N_.x, z: N_.z, yaw: N_.yaw };
    const p0 = pull.current;
    const s = ease((c - COL.pull) / (COL.gone - COL.pull));
    N_.visible = s < 0.995;
    N_.flail = 1; N_.moving = 0; N_.talk = 0;
    N_.armL = UP; N_.armR = UP;
    const wx = Math.max(-3.4, Math.min(3.4, p0.x)), wy = 1.0, wz = ROOM.z0 - 0.15;
    const rx = HOLE.x + RING * 1.02, ry = HOLE.y, rz = HOLE.z;
    if (s < 0.25) {
      const u = easeIn(s / 0.25);
      N_.x = p0.x + (wx - p0.x) * u; N_.y = wy * u; N_.z = p0.z + (wz - p0.z) * u;
      N_.rx = 0.9 * u; N_.rz = 0; N_.yaw = p0.yaw;
      N_.sx = N_.sz = 1; N_.sy = 1;
      lens.uStrength.value = 0;
    } else {
      const u = (s - 0.25) / 0.75, k = easeIn(u);
      N_.x = wx + (rx - wx) * k; N_.y = wy + (ry - wy) * k; N_.z = wz + (rz - wz) * k;
      N_.rx = 0.9 + u * 6; N_.rz = u * 4; N_.yaw = p0.yaw + u * 3;
      const grow = 1 + 2.5 * u;
      N_.sy = (1 + 1.6 * u) * grow; N_.sx = N_.sz = (1 - 0.5 * u) * grow;
      lens.uStrength.value = ease((u - 0.12) / 0.7);
      lens.uSpin.value = u * u * 5;
    }
    lens.uFade.value = 1 - ease((s - 0.88) / 0.11);
    lens.uRing.value = Math.max(1, holeRs(c) * 2.6);
    lens.uHole.value.set(OPEN.x + HOLE.x - origin.x, OPEN.y + HOLE.y - origin.y, OPEN.z + HOLE.z - origin.z);
    lens.uCam.value.copy(tv.current.eye);
  }

  const pressE = () => (input.seatPrompt && foot.mode === 'foot' && !foot.sitAt
    ? { text: isTouch() ? 'Tap to sit' : 'Press E', shown: 99, alpha: 1 } : null);

  return (
    <>
      <group ref={root} visible={false}>
        <Cabin strips={strips} seatGlow={seatGlow} door={door} glassRef={glassFront} />

        <pointLight ref={cool} position={[0, 2.95, 0.8]} intensity={16} distance={11} decay={1.5} color="#a9c8ff" />
        <pointLight ref={warmA} position={[-2, 2.25, 2.4]} intensity={7} distance={6} decay={1.7} color="#ffb26b" />
        {LAPTOP && <pointLight ref={warmB} position={[2, 2.25, 2.4]} intensity={7} distance={6} decay={1.7} color="#ffb26b" />}
        {LAPTOP && <pointLight ref={consoleL} position={[0, 1.05, -2.7]} intensity={4} distance={3.5} decay={2} color="#62e6ff" />}
        <pointLight ref={starL} position={[0, -1.5, -9]} intensity={22} distance={24} decay={1.4} color="#ffe2bf" />
        <pointLight ref={red} position={[0, 2.85, 0.5]} intensity={0} distance={12} decay={1.5} color="#ff2a1a" />

        <Npc who="einstein" drive={npcs.einstein}>
          <SpeechBubble position={[0, 3.3, 0]} source={() => saying('einstein')} />
        </Npc>
        <MatContext.Provider value={lensMats}>
          <Npc who="newton" drive={npcs.newton}>
            <SpeechBubble position={[0, 3.3, 0]} source={() => (npcs.newton.visible && foot.c < COL.pull ? saying('newton') : null)} />
          </Npc>
        </MatContext.Provider>
        <SpeechBubble position={[PILOT.x, 1.75, PILOT.z]} source={pressE} small />

        {/* outside: the star resting in the rubber sheet of space */}
        <mesh ref={star} material={starMat}><sphereGeometry args={[1, 32, 24]} /></mesh>
        <group position={[STAR.x, SHEET_Y, STAR.z]}>
          <mesh geometry={sheet.skin} material={sheet.skinMat} frustumCulled={false} renderOrder={2} />
          <lineSegments geometry={sheet.lines} material={sheet.lineMat} frustumCulled={false} renderOrder={3} />
        </group>
        <points geometry={partData.g} material={partData.m} frustumCulled={false} renderOrder={4} />
        <instancedMesh ref={shards} args={[shardGeo, shardMat, SHARDS]} frustumCulled={false} visible={false} renderOrder={5} />
      </group>
      <group ref={holeGroup} visible={false}><BlackHole body={hole} /></group>
    </>
  );
}
