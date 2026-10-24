// Newton and Einstein in Hacky's original NPC style (world1/Newton.tsx):
// toon-shaded primitives with ink outlines, two dot eyes, breathing, a head
// that turns to whoever it is looking at. One rig, two costumes. The body is
// driven from outside by an NpcDrive (play/onfoot.ts): where to stand, which
// way to face, what the arms are doing, whether it is walking or sitting.
//
// Also here: the player kid (Hacky's Character.tsx Kid) for other players on
// foot, and the typed comic bubble that floats over a head.

import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { GEO, Part } from './toon';
import type { NpcDrive, Said } from '../play/onfoot';

// Hacky's palette (world1/palette.ts)
const SKIN = '#ffd6b0';
const EYE = '#111111';
const SHOE = '#2a2a3a';
const NEWTON = { coat: '#5b6b8f', shirt: '#fff8e7', breeches: '#2a2a3a', stocking: '#f3f3f3', hair: '#8a6a4a', ribbon: '#111111' };
const EINSTEIN = { jumper: '#9a9fab', collar: '#f4f1e8', trousers: '#4a4f5e', hair: '#f3f3f3', brow: '#e6e6e6' };

export const NPC_SCALE = 0.78;

// Skeleton (unscaled), after Hacky's Newton.
const THIGH = 0.5, SHIN = 0.44, FOOT_H = 0.17;
const HIP_STAND = THIGH + SHIN + FOOT_H;
const HIP_CHAIR = 0.62;
const STRIDE = 0.5;
const CADENCE = 2.6; // radians of walk phase per unit walked (unscaled)

const tmp = new THREE.Vector3();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function Npc({ who, drive, scale = 1, children }: { who: 'newton' | 'einstein'; drive: NpcDrive; scale?: number; children?: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null), legR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null), kneeR = useRef<THREE.Group>(null);
  const footL = useRef<THREE.Group>(null), footR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  const skirtL = useRef<THREE.Group>(null), skirtR = useRef<THREE.Group>(null);
  const cur = useRef({ lx: 0, lz: 0.06, rx: 0, rz: 0.06, hy: 0, hp: 0, seat: drive.seated });
  const seed = useMemo(() => (who === 'newton' ? 0.7 : 2.3), [who]);
  const S = NPC_SCALE * scale;

  useFrame(({ clock }, rawDt) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime + seed;
    const d = drive;
    g.visible = d.visible;
    if (!d.visible) return;
    g.position.set(d.x, d.y, d.z);
    g.rotation.set(d.rx, d.yaw, d.rz, 'YXZ');
    g.scale.set(S * d.sx, S * d.sy, S * d.sz);
    const c = cur.current;
    c.seat += (d.seated - c.seat) * (1 - Math.exp(-dt * 5));
    const sit = c.seat;

    // --- legs: a walk cycle from the distance walked ------------------------
    const moving = d.moving * (1 - sit);
    const phase = (d.stride / S) * CADENCE;
    const swing = Math.sin(phase) * STRIDE * moving;
    const bendL = Math.max(0, -Math.sin(phase + 0.9)) * 0.85 * moving;
    const bendR = Math.max(0, Math.sin(phase + 0.9)) * 0.85 * moving;
    const thighL = lerp(swing, -1.45, sit), thighR = lerp(-swing, -1.45, sit);
    const shinL = lerp(bendL, 1.45, sit), shinR = lerp(bendR, 1.45, sit);
    if (legL.current) legL.current.rotation.x = thighL;
    if (legR.current) legR.current.rotation.x = thighR;
    if (kneeL.current) kneeL.current.rotation.x = shinL;
    if (kneeR.current) kneeR.current.rotation.x = shinR;
    if (footL.current) footL.current.rotation.x = -(thighL + shinL) * 0.75;
    if (footR.current) footR.current.rotation.x = -(thighR + shinR) * 0.75;
    const bob = Math.abs(Math.sin(phase)) * 0.05 * moving;
    if (hips.current) hips.current.position.y = lerp(HIP_STAND, HIP_CHAIR, sit) + bob;
    if (skirtL.current) skirtL.current.rotation.x = lerp(-swing * 0.4, -1.2, sit);
    if (skirtR.current) skirtR.current.rotation.x = lerp(swing * 0.4, -1.2, sit);

    // --- torso: breathing, a lean when walking, a nod when talking ----------
    if (torso.current) {
      torso.current.rotation.x = 0.07 * moving + Math.sin(t * 6.1) * 0.025 * d.talk - 0.06 * sit;
      torso.current.rotation.y = Math.sin(t * 2.7) * 0.05 * d.talk;
      torso.current.scale.set(1, 1 + Math.sin(t * 1.35) * 0.018 * (1 - moving), 1);
    }

    // --- arms: chase the pose, plus walk swing, talk and flail --------------
    const k = 1 - Math.exp(-dt * 8);
    c.lx += (d.armL[0] - c.lx) * k; c.lz += (d.armL[1] - c.lz) * k;
    c.rx += (d.armR[0] - c.rx) * k; c.rz += (d.armR[1] - c.rz) * k;
    const walkArm = -swing * 0.8;
    const talkL = Math.sin(t * 5.3) * 0.16 * d.talk, talkR = Math.sin(t * 4.1 + 1) * 0.2 * d.talk;
    const fl = d.flail;
    if (armL.current) {
      armL.current.rotation.x = c.lx + walkArm + talkL + (Math.sin(t * 11) * 0.9 - 1.3) * fl - 0.5 * sit;
      armL.current.rotation.z = c.lz + (0.7 + Math.sin(t * 9) * 0.5) * fl;
    }
    if (armR.current) {
      armR.current.rotation.x = c.rx - walkArm + talkR + (Math.sin(t * 12 + 2) * 0.9 - 1.3) * fl - 0.5 * sit;
      armR.current.rotation.z = -(c.rz + (0.7 + Math.sin(t * 10 + 1) * 0.5) * fl);
    }

    // --- head: turn toward what it is looking at ------------------------------
    let wy = 0, wp = 0;
    if (d.look && torso.current) {
      torso.current.worldToLocal(tmp.copy(d.look));
      tmp.y -= 1.38;
      wy = Math.max(-1.15, Math.min(1.15, Math.atan2(tmp.x, tmp.z)));
      wp = Math.max(-0.5, Math.min(0.55, -Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z))));
    }
    const hk = 1 - Math.exp(-dt * 5);
    c.hy += (wy - c.hy) * hk; c.hp += (wp - c.hp) * hk;
    if (head.current) {
      head.current.rotation.y = c.hy + Math.sin(t * 0.9) * 0.04 + Math.sin(t * 9) * 0.35 * d.shake + Math.sin(t * 13) * 0.25 * fl;
      head.current.rotation.x = c.hp + Math.sin(t * 0.7) * 0.03 + Math.sin(t * 7.3) * 0.06 * d.talk;
    }
  });

  const isNewton = who === 'newton';
  const top = isNewton ? NEWTON.coat : EINSTEIN.jumper;
  const legTop = isNewton ? NEWTON.breeches : EINSTEIN.trousers;
  const legLow = isNewton ? NEWTON.stocking : EINSTEIN.trousers;

  const leg = (side: 1 | -1, ref: RefObject<THREE.Group | null>, knee: RefObject<THREE.Group | null>, foot: RefObject<THREE.Group | null>) => (
    <group ref={ref} position={[0.19 * side, 0, 0]}>
      <Part color={legTop} position={[0, -THIGH / 2, 0]} scale={[0.27, THIGH, 0.29]} />
      <group ref={knee} position={[0, -THIGH, 0]}>
        <Part color={legLow} position={[0, -SHIN / 2, 0]} scale={[0.22, SHIN, 0.24]} />
        <group ref={foot} position={[0, -SHIN, 0]}>
          <Part color={SHOE} position={[0, -FOOT_H / 2, 0.1]} scale={[0.28, FOOT_H, 0.46]} outline={0.07} />
        </group>
      </group>
    </group>
  );
  const arm = (side: 1 | -1, ref: RefObject<THREE.Group | null>) => (
    <group ref={ref} position={[0.52 * side, 0.86, 0.04]}>
      <Part color={top} position={[0, -0.3, 0]} scale={[0.23, 0.6, 0.23]} />
      {!isNewton && <Part color={EINSTEIN.collar} position={[0, -0.58, 0]} scale={[0.2, 0.06, 0.2]} outline={0.08} />}
      <Part geometry={GEO.sphere} color={SKIN} position={[0, -0.66, 0]} scale={0.14} outline={0.08} />
    </group>
  );

  return (
    <group ref={root}>
      <group ref={hips} position={[0, HIP_STAND, 0]}>
        {leg(1, legL, kneeL, footL)}
        {leg(-1, legR, kneeR, footR)}
        {isNewton && (
          <>
            <group ref={skirtL} position={[0.3, 0.02, 0]}><Part color={NEWTON.coat} position={[0, -0.36, 0]} scale={[0.3, 0.74, 0.5]} /></group>
            <group ref={skirtR} position={[-0.3, 0.02, 0]}><Part color={NEWTON.coat} position={[0, -0.36, 0]} scale={[0.3, 0.74, 0.5]} /></group>
          </>
        )}
        <group ref={torso}>
          {isNewton ? (
            <>
              <Part color={NEWTON.coat} position={[0, 0.52, 0]} scale={[0.8, 0.92, 0.48]} />
              <Part color={NEWTON.shirt} position={[0, 0.62, 0.25]} scale={[0.26, 0.52, 0.06]} outline={0.08} />
              <Part color={NEWTON.shirt} position={[0, 0.91, 0.27]} scale={[0.22, 0.17, 0.1]} outline={0.1} />
            </>
          ) : (
            <>
              {/* a baggy grey jumper over a shirt collar */}
              <Part color={EINSTEIN.jumper} position={[0, 0.5, 0]} scale={[0.84, 0.9, 0.52]} />
              <Part color={EINSTEIN.jumper} position={[0, 0.08, 0]} scale={[0.86, 0.14, 0.54]} outline={0.04} />
              <Part color={EINSTEIN.collar} position={[0, 0.93, 0.08]} scale={[0.36, 0.1, 0.34]} outline={0.08} />
            </>
          )}
          {arm(1, armL)}
          {arm(-1, armR)}
          <group ref={head} position={[0, 0.94, 0]}>
            <Part geometry={GEO.sphere} color={SKIN} position={[0, 0.4, 0]} scale={0.42} />
            <Part geometry={GEO.sphereLow} color={EYE} position={[0.15, 0.46, 0.38]} scale={[0.06, 0.08, 0.03]} outline={0} />
            <Part geometry={GEO.sphereLow} color={EYE} position={[-0.15, 0.46, 0.38]} scale={[0.06, 0.08, 0.03]} outline={0} />
            {isNewton ? <NewtonHair /> : <EinsteinHair />}
          </group>
        </group>
      </group>
      {children}
    </group>
  );
}

/** Long hair tied back with a black ribbon (Hacky's Newton). */
function NewtonHair() {
  return (
    <>
      <Part geometry={GEO.sphere} color={NEWTON.hair} position={[0, 0.52, -0.07]} scale={[0.47, 0.38, 0.47]} outline={0.06} />
      <Part geometry={GEO.cylinder} color={NEWTON.hair} position={[0, 0.05, -0.44]} rotation={[0.28, 0, 0]} scale={[0.13, 0.7, 0.13]} outline={0.1} />
      <Part color={NEWTON.ribbon} position={[0, 0.34, -0.42]} scale={[0.22, 0.09, 0.14]} outline={0.1} />
    </>
  );
}

/** Wild white hair standing out round a bald-ish crown, bushy brows, a big white moustache. */
function EinsteinHair() {
  const tufts: [number, number, number, number][] = [
    [0.36, 0.5, -0.05, 0.2], [-0.36, 0.5, -0.05, 0.2], [0.42, 0.32, -0.1, 0.18], [-0.42, 0.32, -0.1, 0.18],
    [0.3, 0.68, -0.15, 0.17], [-0.3, 0.68, -0.15, 0.17], [0, 0.78, -0.2, 0.2], [0.16, 0.8, 0.0, 0.14], [-0.16, 0.8, 0.02, 0.14],
    [0, 0.5, -0.4, 0.24], [0.24, 0.42, -0.34, 0.2], [-0.24, 0.42, -0.34, 0.2], [0.46, 0.55, -0.22, 0.12], [-0.46, 0.55, -0.22, 0.12],
  ];
  return (
    <>
      {tufts.map(([x, y, z, s], i) => (
        <Part key={i} geometry={GEO.sphere} color={EINSTEIN.hair} position={[x, y, z]} scale={s} outline={0.08} />
      ))}
      <Part geometry={GEO.sphere} color={EINSTEIN.brow} position={[0.15, 0.56, 0.37]} rotation={[0, 0, -0.25]} scale={[0.1, 0.035, 0.04]} outline={0.1} />
      <Part geometry={GEO.sphere} color={EINSTEIN.brow} position={[-0.15, 0.56, 0.37]} rotation={[0, 0, 0.25]} scale={[0.1, 0.035, 0.04]} outline={0.1} />
      {/* the moustache */}
      <Part geometry={GEO.sphere} color={EINSTEIN.hair} position={[0, 0.27, 0.38]} scale={[0.2, 0.075, 0.08]} outline={0.09} />
    </>
  );
}

// --- another player, on foot ----------------------------------------------------

export interface KidLook { suit: string; shirt: string; tie: string; hair: string; skin: string; shoe: string }

const HAIRS = ['#1d2a5c', '#2a2a3a', '#ff8c3a', '#b06cff', '#ffc72c', '#3aa0ff', '#7a4a2a', '#f3f3f3'];
export function kidLook(identity: string, color: string): KidLook {
  let h = 2166136261;
  for (let i = 0; i < identity.length; i++) { h ^= identity.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return { suit: color, shirt: '#f4f1e8', tie: '#22243a', hair: HAIRS[(h >>> 8) % HAIRS.length], skin: SKIN, shoe: SHOE };
}

/** Hacky's kid rig: big head, short body, chunky hands and feet. Feet at 0, facing +z. */
export function Kid({ look, speed }: { look: KidLook; speed: RefObject<number> }) {
  const leftLeg = useRef<THREE.Group>(null), rightLeg = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null), rightArm = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const phase = useRef(Math.random() * 6.283);
  const amp = useRef(0);
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const sp = Math.min(1, speed.current ?? 0);
    phase.current += dt * 10 * Math.min(1, 0.35 + sp);
    amp.current += (0.72 * sp - amp.current) * (1 - Math.exp(-dt * 10));
    const p = phase.current;
    const swing = (Math.sin(p) * 0.85 + Math.sin(p * 3) * 0.12) * amp.current;
    const arm = Math.sin(p - 0.25) * amp.current * 0.9;
    if (leftLeg.current) leftLeg.current.rotation.x = swing;
    if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    if (leftArm.current) leftArm.current.rotation.x = -arm;
    if (rightArm.current) rightArm.current.rotation.x = arm;
    if (body.current) body.current.position.y = Math.pow(Math.abs(Math.sin(p)), 1.5) * 0.07 * amp.current + Math.sin(clock.elapsedTime * 2) * 0.008;
  });
  return (
    <group>
      <group ref={leftLeg} position={[0.16, 0.56, 0]}>
        <Part color={look.suit} position={[0, -0.28, 0]} scale={[0.22, 0.5, 0.24]} />
        <Part color={look.shoe} position={[0, -0.5, 0.06]} scale={[0.28, 0.17, 0.4]} outline={0.07} />
      </group>
      <group ref={rightLeg} position={[-0.16, 0.56, 0]}>
        <Part color={look.suit} position={[0, -0.28, 0]} scale={[0.22, 0.5, 0.24]} />
        <Part color={look.shoe} position={[0, -0.5, 0.06]} scale={[0.28, 0.17, 0.4]} outline={0.07} />
      </group>
      <group ref={body}>
        <Part color={look.suit} position={[0, 0.9, 0]} scale={[0.66, 0.64, 0.42]} />
        <Part color={look.shirt} position={[0, 0.95, 0.21]} scale={[0.16, 0.5, 0.02]} outline={0} />
        <Part color={look.tie} position={[0, 0.92, 0.22]} scale={[0.07, 0.4, 0.02]} outline={0.1} />
        <group ref={leftArm} position={[0.43, 1.14, 0]}>
          <Part color={look.suit} position={[0, -0.26, 0]} scale={[0.2, 0.5, 0.2]} />
          <Part geometry={GEO.sphere} color={look.skin} position={[0, -0.56, 0]} scale={0.14} outline={0.08} />
        </group>
        <group ref={rightArm} position={[-0.43, 1.14, 0]}>
          <Part color={look.suit} position={[0, -0.26, 0]} scale={[0.2, 0.5, 0.2]} />
          <Part geometry={GEO.sphere} color={look.skin} position={[0, -0.56, 0]} scale={0.14} outline={0.08} />
        </group>
        <Part color={look.shirt} position={[0, 1.26, 0.02]} scale={[0.34, 0.12, 0.3]} outline={0.07} />
        <group position={[0, 1.3, 0]}>
          <Part geometry={GEO.sphere} color={look.skin} position={[0, 0.38, 0]} scale={0.4} />
          <Part geometry={GEO.sphereLow} color={EYE} position={[0.14, 0.42, 0.36]} scale={[0.06, 0.09, 0.03]} outline={0} />
          <Part geometry={GEO.sphereLow} color={EYE} position={[-0.14, 0.42, 0.36]} scale={[0.06, 0.09, 0.03]} outline={0} />
          <Part geometry={GEO.sphere} color={look.hair} position={[0, 0.5, -0.03]} scale={[0.405, 0.3, 0.405]} />
          <Part geometry={GEO.sphere} color={look.hair} position={[0, 0.38, -0.14]} scale={[0.36, 0.3, 0.3]} />
        </group>
      </group>
    </group>
  );
}

// --- the comic bubble ------------------------------------------------------------

const PAPER = '#fff8e7';
const BUBBLE: React.CSSProperties = {
  position: 'relative',
  transform: 'translate(30%, -70%)',
  width: 'max-content',
  maxWidth: 'min(300px, 66vw)',
  padding: '12px 18px',
  background: PAPER,
  color: '#111',
  border: '3px solid #111',
  borderRadius: 26,
  boxShadow: '0 5px 0 #111',
  font: "800 18px/1.3 'Space Grotesk', system-ui, sans-serif",
  whiteSpace: 'pre-wrap',
  textAlign: 'left',
  transition: 'opacity 120ms linear',
  userSelect: 'none',
};
const TAIL_INK: React.CSSProperties = { position: 'absolute', left: 22, bottom: -22, width: 0, height: 0, border: '11px solid transparent', borderTopColor: '#111', borderLeftColor: '#111' };
const TAIL_PAPER: React.CSSProperties = { position: 'absolute', left: 25, bottom: -13, width: 0, height: 0, border: '8px solid transparent', borderTopColor: PAPER, borderLeftColor: PAPER };

/**
 * A typed comic bubble in the world. `source` is read every frame: the full
 * line (laid out invisibly so the bubble never jumps) and how much is typed.
 */
export function SpeechBubble({ position, source, small = false }: { position: [number, number, number]; source: () => Said | null; small?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<HTMLSpanElement>(null);
  const rest = useRef<HTMLSpanElement>(null);
  const last = useRef({ text: '', n: -1 });
  useFrame(() => {
    const el = box.current;
    if (!el || !shown.current || !rest.current) return;
    const s = source();
    if (!s) { if (el.style.visibility !== 'hidden') { el.style.visibility = 'hidden'; el.style.opacity = '0'; } last.current.n = -1; return; }
    el.style.visibility = 'visible';
    el.style.opacity = String(Math.max(0, Math.min(1, s.alpha)));
    if (s.text !== last.current.text || s.shown !== last.current.n) {
      const chars = Array.from(s.text);
      shown.current.textContent = chars.slice(0, s.shown).join('');
      rest.current.textContent = chars.slice(s.shown).join('');
      last.current = { text: s.text, n: s.shown };
    }
  });
  const style = small ? { ...BUBBLE, padding: '7px 12px', font: "800 15px/1.2 'Space Grotesk', system-ui, sans-serif", borderRadius: 14 } : BUBBLE;
  return (
    <Html position={position} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={box} style={{ ...style, visibility: 'hidden', opacity: 0 }}>
        <span ref={shown} />
        <span ref={rest} style={{ opacity: 0 }} />
        <div style={TAIL_INK} />
        <div style={TAIL_PAPER} />
      </div>
    </Html>
  );
}
