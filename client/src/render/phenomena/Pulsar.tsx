// A pulsar rescue site: a tiny blinding blue-white neutron star, a soft wind
// nebula torus in its spin equator, two lighthouse beams along
// +/- pulsarAxis(body, story.seenS), and a hairline "impact preview" ring on
// each sweep cone at the pod's distance showing where each beam passes next.
//
// The beams are shaded from the exact hazard volume (BEAM_HALF_ANGLE,
// BEAM_LENGTH, same axis, same clock) so what you see is what damages you:
// the faint bright sheath sits just inside the danger edge and falls to zero
// on it. Output is linear HDR; bloom in the post pass does the glare.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Body, Vec } from '../../universe/bodies';
import { place } from '../origin';
import { LAPTOP } from '../quality';
import { BEAM_HALF_ANGLE, BEAM_LENGTH, pulsarAxis } from '../../relativity/hazards';
import { game } from '../../play/game';
import { story } from '../../play/story';
import {
  BEAM_VERT, beamFrag, FLOW_PERIOD, RING_VERT, RING_FRAG, NEB_VERT, nebFrag,
  CORE_VERT, CORE_FRAG, GLOW_VERT, GLOW_FRAG,
} from './pulsarShaders';

const TAN = Math.tan(BEAM_HALF_ANGLE);
const POD_R = 38; // pod orbit distance: poiFor('pulsar') puts it 38 out and podPosAt keeps it there
const TAU = Math.PI * 2;

const Q = LAPTOP
  ? { coneSeg: 64, beamOct: 3, nebSteps: 14, nebOct: 3, ringSeg: 256, ringSides: 6, coreSeg: [32, 24] as const }
  : { coneSeg: 32, beamOct: 2, nebSteps: 8, nebOct: 2, ringSeg: 128, ringSides: 4, coreSeg: [20, 14] as const };

const BEAM_BRIGHT = 0.36;
const FLOW_SPEED = 0.85; // noise cells per second along the beam (about 77 units/s outward)
const SWIRL = 0.06; // rad/s, nebula rotation

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Angle of offset (dx,dy,dz) from the nearer of the two beams, in units of BEAM_HALF_ANGLE. */
function beamU(mx: number, my: number, mz: number, dx: number, dy: number, dz: number, r: number): number {
  const c = Math.min(1, Math.abs(mx * dx + my * dy + mz * dz) / r);
  return Math.acos(c) / BEAM_HALF_ANGLE;
}

/** Flash strength from beam axis m at offset d (camera minus star), range-limited like the hazard. */
function flashFrom(mx: number, my: number, mz: number, dx: number, dy: number, dz: number): number {
  const r = Math.hypot(dx, dy, dz);
  if (r < 1 || r > BEAM_LENGTH) return 0;
  const u = beamU(mx, my, mz, dx, dy, dz, r);
  const f = u < 1 ? 1 - 0.45 * u * u : 0.55 * Math.exp(-(((u - 1) / 0.15) ** 2));
  return f * (1 - smooth(BEAM_LENGTH * 0.965, BEAM_LENGTH, r));
}

/** Lighthouse blink: how squarely a beam points along this line of sight, at any distance. */
function blinkFrom(mx: number, my: number, mz: number, dx: number, dy: number, dz: number): number {
  const r = Math.hypot(dx, dy, dz);
  if (r < 1e-6) return 0;
  const u = beamU(mx, my, mz, dx, dy, dz, r);
  return Math.exp(-1.4 * u * u);
}

/**
 * 0..1 flash when a beam sweeps across the camera: 1 dead centre, ~0.55 on
 * the danger edge, gone by ~1.3x the edge angle, and 0 beyond BEAM_LENGTH
 * (where the beam can no longer hurt you). camPos is a world position.
 */
export function pulsarFlash(body: Body, camPos: Vec): number {
  const m = pulsarAxis(body, story.seenS);
  return flashFrom(m.x, m.y, m.z, camPos.x - body.x, camPos.y - body.y, camPos.z - body.z);
}

/** 0..1 lighthouse blink seen from camPos at any distance (the star flares as a beam crosses your line of sight). */
export function pulsarBlink(body: Body, camPos: Vec): number {
  const m = pulsarAxis(body, story.seenS);
  return blinkFrom(m.x, m.y, m.z, camPos.x - body.x, camPos.y - body.y, camPos.z - body.z);
}

/** Two hairline tubes (one per sweep cone). Positions are placed by RING_VERT; a seam column is duplicated so phi never wraps inside a triangle. */
function ringGeometry(seg: number, sides: number): THREE.BufferGeometry {
  const cols = seg + 1;
  const count = 2 * cols * sides;
  const ring = new Float32Array(count * 3);
  const pos = new Float32Array(count * 3);
  const idx: number[] = [];
  let v = 0;
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? 1 : -1;
    const base = k * cols * sides;
    for (let i = 0; i < cols; i++) {
      const phi = (i / seg) * TAU;
      for (let j = 0; j < sides; j++) {
        const psi = (j / sides) * TAU;
        ring[v * 3] = phi; ring[v * 3 + 1] = psi; ring[v * 3 + 2] = side;
        // Rough placement (tilt ~0.8) for anything that reads positions; the shader decides.
        pos[v * 3] = Math.cos(phi) * POD_R * 0.72;
        pos[v * 3 + 1] = side * POD_R * 0.7;
        pos[v * 3 + 2] = Math.sin(phi) * POD_R * 0.72;
        v++;
        if (i < seg) {
          const j1 = (j + 1) % sides;
          const a = base + i * sides + j, b = base + (i + 1) * sides + j;
          const c = base + (i + 1) * sides + j1, d = base + i * sides + j1;
          idx.push(a, b, d, b, c, d);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRing', new THREE.BufferAttribute(ring, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), POD_R + 4);
  return g;
}

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false } as const;

function build(body: Body) {
  const seed = (body.seed % 97) * 0.1; // small, so noise hashes keep precision on mobile GPUs

  // Spin frame: X = e1, Y = spin axis, Z = e1 x s (right-handed).
  const s = new THREE.Vector3(body.spinAxis.x, body.spinAxis.y, body.spinAxis.z).normalize();
  const ref = Math.abs(s.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(s, ref).normalize();
  const e3 = new THREE.Vector3().crossVectors(e1, s).normalize();
  const spinQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(e1, s, e3));

  // Which way the beams travel around the spin axis in this frame, read off
  // the hazard function itself so the preview always leads the real beam.
  const phiAt = (t: number) => {
    const m = pulsarAxis(body, t);
    return Math.atan2(m.x * e3.x + m.y * e3.y + m.z * e3.z, m.x * e1.x + m.y * e1.y + m.z * e1.z);
  };
  let dphi = phiAt(body.period * 0.01) - phiAt(0);
  dphi = Math.atan2(Math.sin(dphi), Math.cos(dphi));
  const dir = dphi >= 0 ? 1 : -1;

  const coreGeo = new THREE.SphereGeometry(1, Q.coreSeg[0], Q.coreSeg[1]);
  const coreMat = new THREE.ShaderMaterial({
    vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, toneMapped: false,
    uniforms: { uAxis: { value: new THREE.Vector3(0, 1, 0) }, uI: { value: 2.8 }, uFlash: { value: 0 } },
  });

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const glowMat = new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, ...additive,
    uniforms: { uSize: { value: body.radius * 6 }, uI: { value: 1 }, uFlash: { value: 0 } },
  });

  const rt = body.radius * 3.2;
  const rb = rt * 1.8;
  const nebGeo = new THREE.SphereGeometry(rb, 24, 16);
  const nebMat = new THREE.ShaderMaterial({
    vertexShader: NEB_VERT, fragmentShader: nebFrag(Q.nebSteps, Q.nebOct), side: THREE.BackSide, ...additive,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uRot: { value: new THREE.Vector2(1, 0) }, uSeed: { value: seed },
      uRt: { value: rt }, uRb: { value: rb }, uI: { value: 0.5 },
    },
  });

  const ringGeo = ringGeometry(Q.ringSeg, Q.ringSides);
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: RING_VERT, fragmentShader: RING_FRAG, ...additive,
    uniforms: {
      uRadius: { value: POD_R }, uCosT: { value: Math.cos(body.beamTilt) }, uSinT: { value: Math.sin(body.beamTilt) },
      uPix: { value: 0.001 }, uPhaseA: { value: 0 }, uPhaseB: { value: Math.PI }, uDir: { value: dir }, uI: { value: 0.5 },
    },
  });

  // Closed cone (convex, so back faces cover each pixel exactly once),
  // circumscribing the true cone so facets never clip it. Apex at the
  // origin, base at +BEAM_LENGTH along +y.
  const coneGeo = new THREE.ConeGeometry((BEAM_LENGTH * TAN * 1.01) / Math.cos(Math.PI / Q.coneSeg), BEAM_LENGTH, Q.coneSeg, 1, false);
  coneGeo.rotateX(Math.PI);
  coneGeo.translate(0, BEAM_LENGTH / 2, 0);
  const beamFs = beamFrag(Q.beamOct);
  const beamMats = [0, 1].map(i => new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: beamFs, side: THREE.BackSide, ...additive,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uScroll: { value: 0 }, uSeed: { value: seed + i * 7.3 },
      uBright: { value: BEAM_BRIGHT }, uL: { value: BEAM_LENGTH }, uTan: { value: TAN }, uPix: { value: 0.001 },
    },
  }));

  return {
    s, e1, e3, spinQ,
    coreGeo, coreMat, quadGeo, glowMat, nebGeo, nebMat, ringGeo, ringMat, coneGeo, beamMats,
    // per-frame scratch, never reallocated
    tmp: { cam: new THREE.Vector3(), bx: new THREE.Vector3(), by: new THREE.Vector3(), bz: new THREE.Vector3(), m4: new THREE.Matrix4() },
    dispose() {
      coreGeo.dispose(); quadGeo.dispose(); nebGeo.dispose(); ringGeo.dispose(); coneGeo.dispose();
      coreMat.dispose(); glowMat.dispose(); nebMat.dispose(); ringMat.dispose();
      beamMats.forEach(m => m.dispose());
    },
  };
}

export function Pulsar({ body }: { body: Body }) {
  const group = useRef<THREE.Group>(null);
  const beamA = useRef<THREE.Mesh>(null);
  const beamB = useRef<THREE.Mesh>(null);
  const res = useMemo(() => build(body), [body]);
  useEffect(() => () => res.dispose(), [res]);

  useFrame((state) => {
    const g = group.current, A = beamA.current, B = beamB.current;
    if (!g || !A || !B) return;
    place(g, body);
    const T = res.tmp;
    const { s, e1, e3 } = res;

    // Camera relative to the star (render space and world space agree on offsets).
    state.camera.getWorldPosition(T.cam);
    const cx = T.cam.x - g.position.x, cy = T.cam.y - g.position.y, cz = T.cam.z - g.position.z;
    const camDist = Math.hypot(cx, cy, cz);

    const cam = state.camera as THREE.PerspectiveCamera;
    const fov = cam.isPerspectiveCamera ? cam.fov : 60;
    const pix = (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / Math.max(1, state.size.height * state.viewport.dpr);
    const t = state.clock.elapsedTime;

    // The hazard's own axis, same clock as the damage check.
    const m = pulsarAxis(body, story.seenS);
    const mx = m.x, my = m.y, mz = m.z;

    // Beam frame co-rotating with the star: Y = beam, X = s x m, Z = X x Y.
    let xx = s.y * mz - s.z * my, xy = s.z * mx - s.x * mz, xz = s.x * my - s.y * mx;
    const xl = Math.hypot(xx, xy, xz);
    if (xl < 1e-6) { xx = e1.x; xy = e1.y; xz = e1.z; } else { xx /= xl; xy /= xl; xz /= xl; }
    const zx = xy * mz - xz * my, zy = xz * mx - xx * mz, zz = xx * my - xy * mx;
    const lx = cx * xx + cy * xy + cz * xz, ly = cx * mx + cy * my + cz * mz, lz = cx * zx + cy * zy + cz * zz;
    const scroll = (t * FLOW_SPEED) % FLOW_PERIOD;

    T.bx.set(xx, xy, xz); T.by.set(mx, my, mz); T.bz.set(zx, zy, zz);
    A.quaternion.setFromRotationMatrix(T.m4.makeBasis(T.bx, T.by, T.bz));
    T.bx.negate(); T.by.negate(); // the -axis beam: X' = -X, Y' = -m, Z' = Z
    B.quaternion.setFromRotationMatrix(T.m4.makeBasis(T.bx, T.by, T.bz));

    const ua = res.beamMats[0].uniforms, ub = res.beamMats[1].uniforms;
    (ua.uCam.value as THREE.Vector3).set(lx, ly, lz);
    (ub.uCam.value as THREE.Vector3).set(-lx, -ly, lz);
    ua.uScroll.value = scroll; ub.uScroll.value = scroll;
    ua.uPix.value = pix; ub.uPix.value = pix;

    // Impact preview: where each beam sits on its sweep ring right now.
    const me1 = mx * e1.x + my * e1.y + mz * e1.z, me3 = mx * e3.x + my * e3.y + mz * e3.z;
    const cosT = Math.min(1, Math.max(-1, mx * s.x + my * s.y + mz * s.z));
    const phiA = Math.atan2(me3, me1);
    const ur = res.ringMat.uniforms;
    ur.uPhaseA.value = phiA;
    ur.uPhaseB.value = phiA + Math.PI;
    ur.uCosT.value = cosT;
    ur.uSinT.value = Math.sqrt(1 - cosT * cosT);
    ur.uPix.value = pix;

    // Nebula: camera in the spin frame, slow swirl.
    const un = res.nebMat.uniforms;
    (un.uCam.value as THREE.Vector3).set(cx * e1.x + cy * e1.y + cz * e1.z, cx * s.x + cy * s.y + cz * s.z, cx * e3.x + cy * e3.y + cz * e3.z);
    const sw = (t * SWIRL) % TAU;
    (un.uRot.value as THREE.Vector2).set(Math.cos(sw), Math.sin(sw));

    // Star and its glow flare as a beam crosses the line of sight.
    const blink = blinkFrom(mx, my, mz, cx, cy, cz);
    const uc = res.coreMat.uniforms;
    (uc.uAxis.value as THREE.Vector3).set(mx, my, mz);
    uc.uFlash.value = blink;
    const ug = res.glowMat.uniforms;
    ug.uSize.value = Math.max(body.radius * 6, camDist * 0.011);
    ug.uFlash.value = blink;
  });

  return (
    <group ref={group}>
      <mesh geometry={res.coreGeo} material={res.coreMat} scale={body.radius} />
      <mesh geometry={res.quadGeo} material={res.glowMat} frustumCulled={false} renderOrder={4} />
      <mesh geometry={res.nebGeo} material={res.nebMat} quaternion={res.spinQ} renderOrder={2} />
      <mesh geometry={res.ringGeo} material={res.ringMat} quaternion={res.spinQ} renderOrder={3} />
      <mesh ref={beamA} geometry={res.coneGeo} material={res.beamMats[0]} renderOrder={3} />
      <mesh ref={beamB} geometry={res.coneGeo} material={res.beamMats[1]} renderOrder={3} />
    </group>
  );
}
