// The opening, inside a small ship: Newton and Einstein argue at the big
// window. Outside, a star sits in a 3D lattice of light — the shape of space.
// The lattice bends toward the star (space is bent). The star collapses into
// a black hole: the lattice falls into a funnel, matter spirals in, the ship
// shakes, and Newton is torn out through the window into it. Black screen.
// Everything runs from the cutscene clock fx.t (server time), so every player
// sees the same moment.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fx } from '../cutscenes/cutscenes';
import { comms } from '../play/einstein';
import { place } from './origin';
import { Figure } from './Figures';
import { BlackHole } from './phenomena/BlackHole';
import { v, type Body } from '../universe/bodies';

/** The cabin's floor centre in the world (ahead of where ships spawn). */
export const OPEN = { x: 55, y: 8, z: 230 };
/** The star, out of the window, relative to OPEN. */
export const STAR = { x: 0, y: 6, z: -95 };

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** How hard space bends around the star at time t. */
export const bendAt = (t: number) => (t < 6 ? 0.15 : t < 10 ? 0.15 + ease((t - 6) / 4) * 0.55 : t < 16 ? 0.7 : 0.7 + ease((t - 16) / 5) * 2.3);
/** The star collapsing: 1 = star, 0 = gone. */
const starLeft = (t: number) => 1 - ease((t - 15.5) / 2.5);
/** The hole's size (rs) as it forms. */
const holeRs = (t: number) => ease((t - 16.5) / 3) * 7;

const N = 9, NY = 5, SP = 13; // lattice nodes and spacing

function useLattice() {
  return useMemo(() => {
    const nodes: [number, number, number][] = [];
    const idx = (i: number, j: number, k: number) => (j * N + k) * N + i;
    for (let j = 0; j < NY; j++) for (let k = 0; k < N; k++) for (let i = 0; i < N; i++)
      nodes.push([(i - (N - 1) / 2) * SP, (j - (NY - 1) / 2) * SP, (k - (N - 1) / 2) * SP]);
    const segs: [number, number][] = [];
    for (let j = 0; j < NY; j++) for (let k = 0; k < N; k++) for (let i = 0; i < N; i++) {
      if (i < N - 1) segs.push([idx(i, j, k), idx(i + 1, j, k)]);
      if (k < N - 1) segs.push([idx(i, j, k), idx(i, j, k + 1)]);
      if (j < NY - 1) segs.push([idx(i, j, k), idx(i, j + 1, k)]);
    }
    // each segment drawn as a few pieces so it can curve
    const PIECES = 4;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs.length * PIECES * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segs.length * PIECES * 2 * 3), 3));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    return { nodes, segs, PIECES, g, m };
  }, []);
}

const PARTS = 700;

export function Opening() {
  const root = useRef<THREE.Group>(null);
  const outside = useRef<THREE.Group>(null);
  const star = useRef<THREE.Mesh>(null);
  const glass = useRef<THREE.Mesh>(null);
  const newton = useRef<THREE.Group>(null);
  const einstein = useRef<THREE.Group>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const parts = useRef<THREE.Points>(null);
  const holeGroup = useRef<THREE.Group>(null);
  const talkE = useRef(0), talkN = useRef(0), flailN = useRef(0), flailE = useRef(0);
  const look = useRef<THREE.Vector3 | null>(new THREE.Vector3());
  const lat = useLattice();
  const starMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.6, 2.0), toneMapped: false }), []);
  const hull = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2f38', metalness: 0.5, roughness: 0.55 }), []);
  const floor = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a1d23', metalness: 0.4, roughness: 0.4 }), []);
  const trim = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.9, 1.3), toneMapped: false }), []);
  const glassMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.05, depthWrite: false }), []);
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

  useFrame(({ camera, clock }) => {
    const on = fx.active === 'intro' && fx.t < 25;
    const g = root.current;
    if (!g) return;
    g.visible = on;
    if (holeGroup.current) holeGroup.current.visible = on && fx.t > 16.5;
    if (!on) return;
    const t = fx.t;
    place(g, OPEN);
    camera.getWorldPosition(look.current!);

    // who is talking
    const age = performance.now() / 1000 - comms.shownAt;
    const talking = comms.line && age < 4.5;
    talkE.current += ((talking && comms.who === 'EINSTEIN' ? 1 : 0) - talkE.current) * 0.1;
    talkN.current += ((talking && comms.who === 'NEWTON' ? 1 : 0) - talkN.current) * 0.1;

    // the star, then its collapse
    const left = starLeft(t);
    if (star.current) {
      star.current.visible = left > 0.02;
      star.current.scale.setScalar(4 * left * (1 + Math.sin(t * 9) * 0.03 * (t > 13 ? 1 : 0)));
      starMat.color.setRGB(3.2 + (t > 13 && t < 16 ? 3 : 0), 2.6 + (t > 13 && t < 16 ? 1.5 : 0), 2.0);
    }

    // the lattice: every node pulled toward the star, harder as it gets denser
    const B = bendAt(t);
    const pos = lat.g.getAttribute('position') as THREE.BufferAttribute;
    const col = lat.g.getAttribute('color') as THREE.BufferAttribute;
    const fade = ease((t - 0.5) / 2);
    let n = 0;
    const bent = (x: number, y: number, z: number, out: number[]) => {
      const r = Math.hypot(x, y, z) || 1e-3;
      const pull = Math.min(r * 0.92, (B * 380) / (r + 6));
      const k = (r - pull) / r;
      out[0] = x * k; out[1] = y * k; out[2] = z * k;
      return r - pull;
    };
    const a = [0, 0, 0];
    for (const [s0, s1] of lat.segs) {
      const p0 = lat.nodes[s0], p1 = lat.nodes[s1];
      for (let q = 0; q < lat.PIECES; q++) {
        for (const e of [q, q + 1]) {
          const f = e / lat.PIECES;
          const r = bent(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f, a);
          pos.setXYZ(n, a[0], a[1], a[2]);
          const glow = fade * (0.35 + 1.4 * Math.exp(-r / 18));
          col.setXYZ(n, 0.35 * glow, 0.75 * glow, 1.2 * glow);
          n++;
        }
      }
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    if (outside.current) outside.current.position.set(STAR.x, STAR.y, STAR.z);

    // matter spiralling in once the hole forms
    const pp = partData.g.getAttribute('position') as THREE.BufferAttribute;
    partData.m.opacity = ease((t - 16.5) / 2) * 0.9;
    for (let i = 0; i < PARTS; i++) {
      const s0 = partData.seed[i * 3], s1 = partData.seed[i * 3 + 1], s2 = partData.seed[i * 3 + 2];
      const life = (t * 0.25 + s0) % 1;
      const r = 8 + (1 - life) * (20 + s1 * 50);
      const ang = s2 * 6.283 + life * 9 + t * 0.4;
      pp.setXYZ(i, Math.cos(ang) * r, (s1 - 0.5) * 3 * (1 - life), Math.sin(ang) * r);
    }
    pp.needsUpdate = true;

    // the black hole forming where the star was
    hole.x = OPEN.x + STAR.x; hole.y = OPEN.y + STAR.y; hole.z = OPEN.z + STAR.z;
    hole.rs = hole.radius = 0.01 + holeRs(t);

    // the window gives way; Newton is pulled out into the hole
    if (glass.current) glass.current.visible = t < 21.4;
    if (newton.current) {
      const s = ease((t - 20.8) / 3.2);
      flailN.current = t > 19.5 ? 1 : 0;
      const from = new THREE.Vector3(1.3, 0, -3.2);
      const win = new THREE.Vector3(0.4, 1.0, -6.5);
      const far = new THREE.Vector3(STAR.x, STAR.y, STAR.z);
      const p = s < 0.25 ? from.clone().lerp(win, s / 0.25) : win.clone().lerp(far, (s - 0.25) / 0.75);
      newton.current.position.copy(p);
      newton.current.rotation.set(s * 3, s * 4, s * 1.5);
      newton.current.scale.set(1 - s * 0.8, 1 + s * 1.6, 1 - s * 0.8);
      newton.current.visible = s < 0.98;
    }
    if (einstein.current) flailE.current = t > 21 && t < 24 ? 0.4 : 0;
    // the cabin lights flicker as the ship strains
    const strain = t > 16 ? ease((t - 16) / 4) : 0;
    trim.color.setRGB(0.25 + strain * Math.max(0, Math.sin(clock.elapsedTime * 23)) * 2, 0.9 * (1 - strain * 0.6), 1.3 * (1 - strain * 0.7));
  });

  return (
    <>
      <group ref={root} visible={false}>
        {/* the cabin */}
        <mesh material={floor} position={[0, -0.05, 0]}><boxGeometry args={[9, 0.1, 13]} /></mesh>
        <mesh material={hull} position={[0, 3.4, 0]}><boxGeometry args={[9, 0.1, 13]} /></mesh>
        <mesh material={hull} position={[-4.5, 1.7, 0]}><boxGeometry args={[0.1, 3.4, 13]} /></mesh>
        <mesh material={hull} position={[4.5, 1.7, 0]}><boxGeometry args={[0.1, 3.4, 13]} /></mesh>
        <mesh material={hull} position={[0, 1.7, 6.5]}><boxGeometry args={[9, 3.4, 0.1]} /></mesh>
        {/* the big window: a frame around open space */}
        <mesh material={hull} position={[0, 0.25, -6.5]}><boxGeometry args={[9, 0.5, 0.2]} /></mesh>
        <mesh material={hull} position={[0, 3.2, -6.5]}><boxGeometry args={[9, 0.4, 0.2]} /></mesh>
        <mesh material={hull} position={[-4.1, 1.7, -6.5]}><boxGeometry args={[0.8, 3.4, 0.2]} /></mesh>
        <mesh material={hull} position={[4.1, 1.7, -6.5]}><boxGeometry args={[0.8, 3.4, 0.2]} /></mesh>
        <mesh material={trim} position={[0, 0.52, -6.38]}><boxGeometry args={[7.4, 0.04, 0.04]} /></mesh>
        <mesh material={trim} position={[0, 2.98, -6.38]}><boxGeometry args={[7.4, 0.04, 0.04]} /></mesh>
        <mesh ref={glass} material={glassMat} position={[0, 1.7, -6.45]}><planeGeometry args={[7.4, 2.5]} /></mesh>
        <pointLight position={[0, 3, 1]} intensity={18} distance={14} decay={1.6} color="#b8d4ff" />
        {/* the two of them at the glass */}
        <group ref={einstein} position={[-1.3, 0, -3.2]} rotation={[0, Math.PI, 0]}>
          <Figure who="einstein" talk={talkE} flail={flailE} lookAt={look} />
        </group>
        <group ref={newton} position={[1.3, 0, -3.2]} rotation={[0, Math.PI, 0]}>
          <Figure who="newton" talk={talkN} flail={flailN} lookAt={look} />
        </group>
        {/* outside: the star in its lattice of space */}
        <group ref={outside}>
          <mesh ref={star} material={starMat}><sphereGeometry args={[1, 32, 24]} /></mesh>
          <lineSegments ref={lines} geometry={lat.g} material={lat.m} frustumCulled={false} renderOrder={3} />
          <points ref={parts} geometry={partData.g} material={partData.m} frustumCulled={false} renderOrder={4} />
        </group>
      </group>
      <group ref={holeGroup} visible={false}><BlackHole body={hole} /></group>
    </>
  );
}
