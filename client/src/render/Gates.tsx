// The checkpoint rings in space (see play/route.ts). The next ring is bright
// and turns slowly, the two after it are dim, a passed ring bursts outward
// and fades. A tall soft pillar of light marks the next ring from far away.
// At the last ring a big plain instruction: HOLD E TO RESCUE MIA / DELIVER.
// If the next ring is off screen, a soft dot on the screen edge shows which
// way to turn.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { route } from '../play/route';
import { ship, game } from '../play/game';
import { origin } from './origin';
import { isTouch } from '../input/input';
import './gates.css';

const SHOW = 6;

export function Gates() {
  const rings = useRef<(THREE.Group | null)[]>([]);
  const burst = useRef<THREE.Mesh>(null);
  // Colourful on purpose: the rings are the one thing that must pop out of the
  // black-and-white sky. Next ring electric cyan, later rings dimmer, the
  // crewmate's ring gold, home green.
  const mats = useMemo(() => Array.from({ length: SHOW }, (_, i) => new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.25, 1.6, 2.6).multiplyScalar(i === 0 ? 1.6 : 0.7), transparent: true, opacity: i === 0 ? 1 : 0.6,
    toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending,
  })), []);
  const finalPod = useMemo(() => new THREE.Color(3.2, 2.2, 0.4), []);
  const finalHome = useMemo(() => new THREE.Color(0.6, 3.2, 1.0), []);
  const cyan = useMemo(() => [new THREE.Color(0.4, 2.6, 4.2), new THREE.Color(0.18, 1.1, 1.8), new THREE.Color(0.18, 1.1, 1.8)], []);
  const pillarMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.6, 0.6), transparent: true, opacity: 0.18, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), []);
  const burstMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2), transparent: true, opacity: 0, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }), []);
  const torus = useMemo(() => new THREE.TorusGeometry(1, 0.08, 12, 72), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const z = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const nv = useMemo(() => new THREE.Vector3(), []);

  // DOM: the instruction and the off-screen dot
  const prompt = useRef<HTMLDivElement | null>(null);
  const edge = useRef<HTMLDivElement | null>(null);
  const howto = useRef<HTMLDivElement | null>(null);
  const shownAt = useRef(0);
  useEffect(() => {
    const p = document.createElement('div'); p.className = 'gate-prompt'; document.body.appendChild(p); prompt.current = p;
    const e = document.createElement('div'); e.className = 'gate-edge'; document.body.appendChild(e); edge.current = e;
    // How to play, on screen until you pass your first ring (and at least 12 s).
    const h = document.createElement('div'); h.className = 'gate-howto';
    h.innerHTML = isTouch()
      ? '<b>RESCUE YOUR CREWMATE</b><span>Left thumb: steer</span><span>THRUST: fly · BRAKE: stop</span><span>Fly through the <i class="c">cyan rings</i> to the <i class="g">gold ring</i></span><span>Hold TETHER at the pod · then follow the <i class="h">green rings</i> home</span>'
      : '<b>RESCUE YOUR CREWMATE</b><span>Mouse: steer (point where you want to go)</span><span>W: fly · S: stop · Shift: boost</span><span>Fly through the <i class="c">cyan rings</i> to the <i class="g">gold ring</i></span><span>Hold E at the pod · then follow the <i class="h">green rings</i> home</span>';
    document.body.appendChild(h); howto.current = h;
    return () => { p.remove(); e.remove(); h.remove(); };
  }, []);
  const proj = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, clock, size }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < SHOW; i++) {
      const g = route.gates[route.next + i];
      const o = rings.current[i];
      if (!o) continue;
      o.visible = !!g;
      if (!g) continue;
      o.position.set(g.p.x - origin.x, g.p.y - origin.y, g.p.z - origin.z);
      nv.set(g.n.x, g.n.y, g.n.z);
      q.setFromUnitVectors(z, nv);
      o.quaternion.copy(q);
      mats[i].color.copy(g.final ? (route.target.kind === 'pod' ? finalPod : finalHome) : cyan[Math.min(i, 2)]);
      mats[i].opacity = i === 0 ? 1 : Math.max(0.25, 0.7 - i * 0.1);
      const pulse = i === 0 ? 1 + Math.sin(t * 4) * 0.05 : 1;
      o.scale.setScalar(g.r * pulse);
      o.children[0].rotation.z = t * (i === 0 ? 0.6 : 0.2);
      o.children[1].visible = i === 0; // a thin light line through the next ring
    }
    // a passed ring bursts and fades
    const b = burst.current;
    if (b) {
      const age = (performance.now() - route.passedAt) / 1000;
      const g = route.passed;
      b.visible = !!g && age < 0.6;
      if (g && b.visible) {
        b.position.set(g.p.x - origin.x, g.p.y - origin.y, g.p.z - origin.z);
        nv.set(g.n.x, g.n.y, g.n.z); q.setFromUnitVectors(z, nv); b.quaternion.copy(q);
        b.scale.setScalar(g.r * (1 + age * 2.5));
        burstMat.opacity = 1 - age / 0.6;
      }
    }

    // how to play: until the first ring is passed, and for at least 12 s
    const hw = howto.current;
    if (hw) {
      if (route.gates.length && !shownAt.current) shownAt.current = performance.now();
      const early = shownAt.current && performance.now() - shownAt.current < 12000;
      const show = route.gates.length > 0 && (route.next === 0 || early) && route.target.kind === 'pod';
      hw.style.opacity = show ? '1' : '0';
    }

    // the instruction at the last ring
    const next = route.gates[route.next];
    const p = prompt.current, e = edge.current;
    if (p) {
      const near = next?.final && Math.hypot(next.p.x - ship.pos.x, next.p.y - ship.pos.y, next.p.z - ship.pos.z) < 60;
      const key = isTouch() ? 'TETHER' : 'E';
      let text = '';
      if (near && route.target.kind === 'pod') text = game.tetherHold > 0 ? `RESCUING ${route.target.name}…` : `HOLD ${key} TO RESCUE ${route.target.name}`;
      else if (near && route.target.kind === 'home') text = 'FLY INTO THE RING TO BRING THEM HOME';
      else if (next) text = route.next === 0 && route.gates.length > 1 ? `FLY THROUGH THE RINGS TO ${route.target.name}` : '';
      if (p.textContent !== text) p.textContent = text;
      p.style.opacity = text ? '1' : '0';
      p.style.setProperty('--hold', String(game.tetherHold));
    }
    if (e) {
      if (!next) { e.style.opacity = '0'; return; }
      proj.set(next.p.x - origin.x, next.p.y - origin.y, next.p.z - origin.z).project(camera);
      const behind = proj.z > 1;
      let x = proj.x, y = proj.y;
      if (behind) { x = -x; y = -y; }
      const on = !behind && Math.abs(x) < 0.95 && Math.abs(y) < 0.95;
      if (on) { e.style.opacity = '0'; return; }
      const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
      x /= m; y /= m;
      e.style.opacity = '1';
      e.style.transform = `translate(${(x * 0.47 + 0.5) * size.width}px, ${(-y * 0.47 + 0.5) * size.height}px) translate(-50%, -50%)`;
    }
  });

  return (
    <>
      {Array.from({ length: SHOW }, (_, i) => (
        <group key={i} ref={el => { rings.current[i] = el; }} visible={false}>
          <mesh geometry={torus} material={mats[i]} renderOrder={5} />
          <mesh material={pillarMat} renderOrder={4}><cylinderGeometry args={[0.03, 0.03, 14, 8, 1, true]} /></mesh>
        </group>
      ))}
      <mesh ref={burst} geometry={torus} material={burstMat} visible={false} renderOrder={5} />
    </>
  );
}
