// Hard-surface craft from primitives: rescue ships, crew pods, the mothership.
// Metallic PBR, lit windows, nav lights, a player-colour stripe. Ships and
// pods always stay true colour; only the Doppler/clock tint on OTHER ships is
// relativistic.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Cockpit } from './ship';
import { ShipBody, ageFromTau } from './shipBody';
import { VoxelChar, crewModel } from './VoxelChar';
import { view } from '../play/view';
import { fx } from '../cutscenes/cutscenes';
import * as THREE from 'three';
import { net, type Crew } from '../net';
import { place, origin } from './origin';
import { ship, game, remote, forward, displayShip, DOCK } from '../play/game';
import { MOTHERSHIP, DOCK_OFFSET, C, PHYSICS_FX } from '../game/constants';
import { doppler } from '../relativity/physics';
import { fmtClock } from '../play/einstein';
import { Q } from './quality';
import { Kid, kidLook } from './Npc';
import { foot, OPEN } from '../play/onfoot';

const hull = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.85, roughness: 0.32 });
const dark = new THREE.MeshStandardMaterial({ color: '#2a2e36', metalness: 0.7, roughness: 0.5 });
const glass = new THREE.MeshStandardMaterial({ color: '#0d1a2a', metalness: 0.2, roughness: 0.05, emissive: '#3a6fa8', emissiveIntensity: 0.6 });

function emissive(color: string, intensity: number) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false });
}

// --- a rescue ship ------------------------------------------------------------

export function ShipMesh({ color, engine, tint }: { color: string; engine: React.RefObject<number>; tint?: React.RefObject<THREE.Color> }) {
  const stripe = useMemo(() => new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.4, emissive: color, emissiveIntensity: 0.25 }), [color]);
  const flame = useMemo(() => emissive('#7fc4ff', 6), []);
  const tintMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  const flameRef = useRef<THREE.Group>(null);
  const red = useMemo(() => emissive('#ff2a2a', 5), []);
  const green = useMemo(() => emissive('#2aff6a', 5), []);
  useFrame(({ clock }) => {
    const e = engine.current ?? 0;
    if (flameRef.current) flameRef.current.scale.set(1, 1, 0.2 + e * (0.9 + Math.sin(clock.elapsedTime * 40) * 0.08));
    const blink = Math.sin(clock.elapsedTime * 3) > 0.6 ? 1 : 0.15;
    red.color.setRGB(5 * blink, 0.4 * blink, 0.4 * blink);
    green.color.setRGB(0.4 * blink, 5 * blink, 1 * blink);
    if (tint?.current) { tintMat.color.copy(tint.current); tintMat.opacity = 1; }
  });
  return (
    <group>
      <mesh material={hull} rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[0.55, 2.6, 6, 16]} /></mesh>
      <mesh material={glass} position={[0, 0.35, -0.9]} scale={[0.45, 0.32, 0.8]}><sphereGeometry args={[1, 16, 12]} /></mesh>
      <mesh material={stripe} position={[0, 0.02, 0.1]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.57, 0.57, 0.5, 16]} /></mesh>
      <mesh material={hull} position={[0, -0.1, 0.5]}><boxGeometry args={[3.6, 0.1, 1.1]} /></mesh>
      <mesh material={dark} position={[1.85, -0.1, 0.7]}><boxGeometry args={[0.15, 0.5, 0.9]} /></mesh>
      <mesh material={dark} position={[-1.85, -0.1, 0.7]}><boxGeometry args={[0.15, 0.5, 0.9]} /></mesh>
      <mesh material={red} position={[-1.85, 0.2, 0.7]}><sphereGeometry args={[0.07, 6, 6]} /></mesh>
      <mesh material={green} position={[1.85, 0.2, 0.7]}><sphereGeometry args={[0.07, 6, 6]} /></mesh>
      <mesh material={dark} position={[0, 0, 1.75]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.42, 0.32, 0.5, 14]} /></mesh>
      <group ref={flameRef} position={[0, 0, 2.05]}>
        <mesh material={flame} position={[0, 0, 0.6]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.3, 1.4, 12, 1, true]} /></mesh>
      </group>
      {tint && <mesh material={tintMat} rotation={[Math.PI / 2, 0, 0]} scale={1.06}><capsuleGeometry args={[0.55, 2.6, 4, 12]} /></mesh>}
    </group>
  );
}

const stretchQ = new THREE.Quaternion();
const invQ = new THREE.Quaternion();
const zAxis = new THREE.Vector3(0, 0, 1);
const radial = new THREE.Vector3();

export function LocalShip() {
  const ref = useRef<THREE.Group>(null);
  const stretch = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const cockpit = useRef<THREE.Group>(null);
  const engine = useRef(0);
  const me = net.players().find(p => p.identity === net.identity());
  useFrame((_, dt) => {
    const g = ref.current, st = stretch.current, inn = inner.current;
    if (!g || !st || !inn) return;
    place(g, ship.pos);
    // Tidal stretch: near a black hole the ship is pulled long toward it.
    const f = ship.field;
    let s = 0;
    const hole = f?.deepest?.kind === 'black_hole' ? f.deepest : null;
    if (hole) {
      const r = f!.deepestR;
      s = 0.9 * Math.pow(Math.max(0, 1 - (r - hole.rs) / (hole.rs * 1.5)), 2);
      radial.set(hole.x - ship.pos.x, hole.y - ship.pos.y, hole.z - ship.pos.z).normalize();
      stretchQ.setFromUnitVectors(zAxis, radial);
    } else stretchQ.identity();
    st.quaternion.copy(stretchQ);
    st.scale.set(1 / Math.sqrt(1 + s), 1 / Math.sqrt(1 + s), 1 + s);
    inn.quaternion.copy(invQ.copy(stretchQ).invert().multiply(ship.q));
    const want = ship.status === 'dark' ? 0 : ship.thrusting ? (ship.boosting ? 1.6 : 1) : 0.08;
    engine.current += (want - engine.current) * (1 - Math.exp(-dt * 10));
    g.visible = ship.status !== 'home';
    const inside = (view.mode === 'cockpit' && !fx.active) || fx.forceCockpit;
    if (body.current) body.current.visible = !inside;
    if (cockpit.current) cockpit.current.visible = inside;
  });
  return (
    <group ref={ref}>
      <group ref={stretch}>
        <group ref={inner}>
          <group ref={body}><ShipBody color={me?.color ?? '#ffffff'} engine={engine} age={() => ageFromTau(ship.tau) * 0.15 /* your ship stays nearly new: the twin shows the time */} /></group>
          <group ref={cockpit} visible={false}><Cockpit /></group>
        </group>
      </group>
    </group>
  );
}

// --- other pilots -------------------------------------------------------------

function RemoteShip({ identity }: { identity: string }) {
  const player = net.players().find(p => p.identity === identity);
  const ref = useRef<THREE.Group>(null);
  const craft = useRef<THREE.Group>(null);
  const kid = useRef<THREE.Group>(null);
  const kidTag = useRef<HTMLDivElement>(null);
  const kidSpeed = useRef(0);
  const look = useMemo(() => kidLook(identity, player?.color ?? '#aaa'), [identity, player?.color]);
  const engine = useRef(0);
  const tint = useRef(new THREE.Color(0, 0, 0));
  const tag = useRef<HTMLDivElement>(null);
  const last = useRef({ tau: 0, t: 0, rate: 1 });
  useFrame((_, dt) => {
    const row = net.ship(identity);
    const g = ref.current;
    if (!row || !g) return;
    // Extrapolate from the latest row, then smooth toward it.
    // (no extrapolation on foot: a stopped walker's last velocity would drift them)
    const age = row.status === 'home' ? 0 : Math.min(1, Math.max(0, (net.now() - row.updatedAt) / 1000));
    const tx = row.x + row.vx * age, ty = row.y + row.vy * age, tz = row.z + row.vz * age;
    let d = remote.get(identity);
    const tq = new THREE.Quaternion(row.qx, row.qy, row.qz, row.qw).normalize();
    if (!d) {
      d = { x: tx, y: ty, z: tz, fx: 0, fy: 0, fz: -1, q: tq.clone(), row };
      remote.set(identity, d);
    }
    const k = 1 - Math.exp(-dt * 9);
    if (Math.hypot(tx - d.x, ty - d.y, tz - d.z) > 400) { d.x = tx; d.y = ty; d.z = tz; }
    d.x += (tx - d.x) * k; d.y += (ty - d.y) * k; d.z += (tz - d.z) * k;
    d.q.slerp(tq, 1 - Math.exp(-dt * 12));
    d.row = row;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(d.q);
    d.fx = f.x; d.fy = f.y; d.fz = f.z;
    place(g, d);
    // Status 'home' means on foot in the ship (play/onfoot.ts): a kid in their
    // colour, upright, seen only by players still on foot themselves.
    // (and anyone standing in the cabin while I am on foot there: a kid, never a ship)
    const inCabin = foot.mode === 'foot' && Math.hypot(row.x - OPEN.x, row.y - OPEN.y, row.z - OPEN.z) < 14;
    const walking = row.status === 'home' || inCabin;
    g.visible = !walking || foot.mode === 'foot';
    if (craft.current) { craft.current.visible = !walking; craft.current.quaternion.copy(d.q); }
    if (kid.current) {
      kid.current.visible = walking;
      if (walking) {
        const yaw = Math.atan2(-f.x, -f.z);
        kid.current.rotation.set(0, yaw + Math.PI, 0);
        kidSpeed.current += (Math.min(1, Math.hypot(row.vx, row.vz) / 2.5) - kidSpeed.current) * k;
      }
    }
    if (tag.current) tag.current.style.display = walking ? 'none' : '';
    if (kidTag.current) { kidTag.current.style.display = walking ? '' : 'none'; kidTag.current.textContent = player?.name ?? ''; }
    const speed = Math.hypot(row.vx, row.vy, row.vz);
    engine.current += ((row.status === 'dark' ? 0 : speed > 1 ? 0.7 : 0.1) - engine.current) * k;

    // Their clock rate, from how their tau moves.
    const now = performance.now() / 1000;
    if (row.tau !== last.current.tau) {
      const dtau = row.tau - last.current.tau, dtt = now - last.current.t;
      if (last.current.t > 0 && dtt > 0.05 && dtt < 3) last.current.rate += (Math.min(1.2, Math.max(0, dtau / dtt)) - last.current.rate) * 0.3;
      last.current.tau = row.tau; last.current.t = now;
    }
    // Tint: red and dim when their clock is slower than mine or they pull
    // away, blue and bright when closing fast (relativistic Doppler).
    const rx = d.x - ship.pos.x, ry = d.y - ship.pos.y, rz = d.z - ship.pos.z;
    const rl = Math.hypot(rx, ry, rz) || 1;
    const closing = -((row.vx - ship.vel.x) * rx + (row.vy - ship.vel.y) * ry + (row.vz - ship.vel.z) * rz) / rl;
    const D = doppler(closing) * Math.min(1.5, last.current.rate / Math.max(0.05, ship.rate));
    const s = Math.max(-1, Math.min(1, Math.log2(D))) * PHYSICS_FX;
    if (s >= 0) tint.current.setRGB(0.05 * s, 0.25 * s, 1.2 * s); else tint.current.setRGB(-1.0 * s, -0.08 * s, -0.04 * s);
    if (tag.current) tag.current.textContent = `${player?.name ?? 'Pilot'}  ${fmtClock(row.tau)}${row.status === 'dark' ? '  · DARK' : ''}`;
  });
  return (
    <group ref={ref}>
      <ShipBody color={player?.color ?? '#aaa'} engine={engine} age={() => seenAge(net.ship(identity)?.tau)} />
      <Html position={[0, 2.2, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={tag} className="tag" style={{ borderColor: player?.color }} />
      </Html>
    </group>
  );
}

/**
 * How old a friend's ship looks to me: its own age, plus how much more time
 * it has lived than my ship, exaggerated (PLAN.md v4). If I sat deep in the
 * hole while they waited up top, they lived longer: their ship rusts, mine
 * stays new. (On their screen the same rule keeps my ship new.)
 */
function seenAge(tau: number | undefined) {
  const extra = Math.max(0, (tau ?? 0) - ship.tau - 4);
  return Math.min(1, ageFromTau(tau) + extra * 0.035);
}

export function RemoteShips() {
  const me = net.identity();
  const ids = net.ships().filter(s => s.identity !== me).map(s => s.identity);
  return <>{ids.map(id => <RemoteShip key={id} identity={id} />)}</>;
}

// --- crew pods ----------------------------------------------------------------

const podFrame = new THREE.MeshStandardMaterial({ color: '#c99a4e', metalness: 0.75, roughness: 0.3 });
const podLost = new THREE.MeshStandardMaterial({ color: '#4a4e55', metalness: 0.5, roughness: 0.7 });
const podGlass = new THREE.MeshPhysicalMaterial({ color: '#9fd4ff', metalness: 0, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });

/** A life-support pod: a glass capsule with the crewmate visible inside. */
function Pod({ crew, override }: { crew: Crew; override?: (id: number) => THREE.Vector3 | null }) {
  const ref = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const beacon = useMemo(() => emissive('#ff5544', 8), []);
  const inner = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.5), toneMapped: false, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), []);
  const big = crew.isEinstein || crew.twoShip;
  const spin = useRef(0);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    const p = game.pods.get(crew.id);
    if (g && !p) g.visible = false; // not in the story: only Newton is out there
    if (!g || !p) return;
    const o = override?.(crew.id);
    if (o) g.position.copy(o); else place(g, p.pos);
    g.visible = p.crew.status !== 'home';
    // Deep in the hole his clock barely ticks: he turns as slowly as his time runs.
    spin.current += dt * Math.max(0.01, p.rate * p.rate);
    g.rotation.y = spin.current * 0.25;
    g.rotation.z = Math.sin(spin.current * 0.4) * 0.15;
    const lost = p.crew.status === 'lost';
    // Gravitational redshift: a pod deep in a well glows dim and red.
    const r = p.rate;
    inner.color.setRGB(1.2, 0.5 + 0.6 * r, 0.25 + 0.7 * r * r);
    inner.opacity = lost ? 0 : 0.12 + 0.18 * r;
    const blink = (Math.sin(clock.elapsedTime * Math.PI * 2 * Math.max(0.15, r)) > 0.7 ? 1 : 0) * (lost ? 0 : 1);
    beacon.color.setRGB(8 * blink, 1 * blink, 0.8 * blink);
    if (label.current) {
      const d = Math.hypot(p.pos.x - ship.pos.x, p.pos.y - ship.pos.y, p.pos.z - ship.pos.z);
      label.current.style.opacity = d < 400 && !o ? '1' : '0';
      label.current.textContent = lost ? `${crew.name} · lost` : crew.name;
    }
  });
  const s = big ? 1.6 : 1;
  return (
    <group ref={ref}>
      <group scale={s}>
        <mesh material={podGlass}><capsuleGeometry args={[0.95, 1.3, 8, 18]} /></mesh>
        <mesh material={crew.status === 'lost' ? podLost : podFrame} position={[0, -1.45, 0]}><cylinderGeometry args={[0.85, 0.6, 0.35, 18]} /></mesh>
        <mesh material={crew.status === 'lost' ? podLost : podFrame} position={[0, 1.45, 0]}><cylinderGeometry args={[0.6, 0.85, 0.35, 18]} /></mesh>
        {[0, 1, 2, 3].map(i => (
          <mesh key={i} material={podFrame} position={[Math.cos(i * Math.PI / 2) * 0.93, 0, Math.sin(i * Math.PI / 2) * 0.93]}><boxGeometry args={[0.06, 2.6, 0.06]} /></mesh>
        ))}
        <mesh material={beacon} position={[0, 1.7, 0]}><sphereGeometry args={[0.1, 8, 8]} /></mesh>
        <mesh material={inner}><sphereGeometry args={[0.8, 16, 12]} /></mesh>
        <group position={[0, -1.25, 0]}>
          <VoxelChar src={crew.isEinstein ? '/characters/einstein.json' : crewModel(crew.slot)} height={2.1} />
        </group>
      </group>
      <Html position={[0, 2.6 * s, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={label} className="tag pod-tag" />
      </Html>
    </group>
  );
}

export function Pods({ override }: { override?: (id: number) => THREE.Vector3 | null }) {
  const crew = net.crew();
  return <>{crew.map(c => <Pod key={c.id} crew={c} override={override} />)}</>;
}

// --- tethers ------------------------------------------------------------------

export function Tethers() {
  const ref = useRef<THREE.LineSegments>(null);
  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 6), 3));
    return { geometry: g, material: new THREE.LineBasicMaterial({ color: new THREE.Color(0.6, 2.4, 3), toneMapped: false, transparent: true, opacity: 0.9 }) };
  }, []);
  useFrame(() => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    let n = 0;
    for (const t of net.tethers()) {
      if (n >= 12) break;
      const a = displayShip(t.owner);
      if (!a) continue;
      let b: { x: number; y: number; z: number } | undefined;
      if (t.targetKind === 'crew') b = game.pods.get(t.targetCrew)?.pos;
      else b = displayShip(t.targetShip);
      if (!b) continue;
      pos.setXYZ(n * 2, a.x - origin.x, a.y - origin.y, a.z - origin.z);
      pos.setXYZ(n * 2 + 1, b.x - origin.x, b.y - origin.y, b.z - origin.z);
      n++;
    }
    geometry.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
  });
  return <lineSegments ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}

// --- the mothership -----------------------------------------------------------

export const mothershipFx = { stretch: 1, visible: true, damaged: false };

/** Home: no mothership any more, just a glowing ring to fly into. */
export function Mothership() {
  const ref = useRef<THREE.Group>(null);
  const ring = useMemo(() => emissive('#5fd7ff', 3), []);
  const halo = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.4), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    place(g, DOCK);
    g.visible = mothershipFx.visible !== false || true;
    const p = 0.8 + Math.sin(clock.elapsedTime * 1.6) * 0.2;
    ring.color.setRGB(0.6 * p * 3, 2.2 * p * 1.4, 3 * p * 1.2);
    g.rotation.y = clock.elapsedTime * 0.1;
  });
  return (
    <group ref={ref}>
      <mesh material={ring}><torusGeometry args={[14, 0.35, 10, 96]} /></mesh>
      <mesh material={halo}><torusGeometry args={[14, 1.6, 8, 64]} /></mesh>
    </group>
  );
}

// --- speed dust ---------------------------------------------------------------

/** Tiny particles in a box that wraps around the camera, stretched along velocity. */
export function SpeedDust() {
  const N = Q.stars > 10000 ? 700 : 300;
  const BOX = 140;
  const { geometry, material, seeds } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    const s = new Float32Array(N * 3);
    for (let i = 0; i < s.length; i++) s[i] = Math.random() * BOX;
    return { geometry: g, seeds: s, material: new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 0.55, 0.6), transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false }) };
  }, [N]);
  useFrame(() => {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const sp = ship.speed;
    const st = Math.min(6, sp * 0.12);
    const vx = sp > 0 ? ship.vel.x / sp : 0, vy = sp > 0 ? ship.vel.y / sp : 0, vz = sp > 0 ? ship.vel.z / sp : 0;
    const wrap = (s: number, c: number) => ((((s - c) % BOX) + BOX) % BOX) - BOX / 2;
    for (let i = 0; i < N; i++) {
      const x = ship.pos.x + wrap(seeds[i * 3], ship.pos.x), y = ship.pos.y + wrap(seeds[i * 3 + 1], ship.pos.y), z = ship.pos.z + wrap(seeds[i * 3 + 2], ship.pos.z);
      pos.setXYZ(i * 2, x - origin.x, y - origin.y, z - origin.z);
      pos.setXYZ(i * 2 + 1, x - vx * st - origin.x, y - vy * st - origin.y, z - vz * st - origin.z);
    }
    pos.needsUpdate = true;
    material.opacity = Math.min(0.6, 0.1 + sp / C);
  });
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} />;
}

export { forward, DOCK };
