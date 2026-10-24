// The HUD: small, with big clocks. React re-renders it at 10 Hz from the
// game singletons; the edge arrows and flashes are written straight to the
// DOM every animation frame. Never a countdown, never the rule.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { net, useNet, type Crew } from '../net';
import { game, ship, DOCK, requestRespawn, upOf } from '../play/game';
import { comms, fmtClock, reunionLine } from '../play/einstein';
import { fx } from '../cutscenes/cutscenes';
import { camRef } from '../render/CameraRig';
import { origin } from '../render/origin';
import { C, OXYGEN_S, POD_AIR } from '../game/constants';
import { beamOn } from '../relativity/hazards';
import { audio } from '../audio/audio';
import { BossCard } from './BossCard';
import { TwinSticks } from './TwinSticks';
import { StoryLayers } from './StoryEnd';
import { foot } from '../play/onfoot';
import { isTouch } from '../input/input';
import { drawDials } from './dials';
import { dialsNow } from '../render/ship';
import { view, toggleView } from '../play/view';
import { THRUST, BOOST } from '../game/constants';

function useTick(hz: number) {
  const [, set] = useState(0);
  useEffect(() => { const id = setInterval(() => set(x => x + 1), 1000 / hz); return () => clearInterval(id); }, [hz]);
}

function Ring({ value, size, stroke, color, children }: { value: number; size: number; stroke: number; color: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="ring">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {children}
    </svg>
  );
}

function CrewRow() {
  const crew = [...net.crew()].sort((a, b) => Number(a.isEinstein) - Number(b.isEinstein) || a.slot - b.slot);
  return (
    <div className="crew-row">
      {crew.map(c => {
        const p = game.pods.get(c.id);
        const air = c.status === 'home' ? c.air : c.status === 'lost' ? 0 : Math.max(0, p?.air ?? c.air);
        const cls = c.status === 'lost' ? 'lost' : c.status === 'home' ? 'home' : air < 30 ? 'low' : '';
        return (
          <div key={c.id} className={`crew ${cls} ${c.isEinstein ? 'einstein' : ''}`} title={c.name}>
            <Ring value={air / POD_AIR} size={c.isEinstein ? 46 : 38} stroke={3} color={c.status === 'home' ? '#8ef0b0' : air < 30 ? '#ff7a6a' : '#e8ecff'} />
            <span className="crew-initial">{c.status === 'home' ? '✓' : c.isEinstein ? 'E' : c.name[0]}</span>
            <span className="crew-name">{c.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function MyClock() {
  const slow = ship.rate < 0.9;
  return (
    <div className={`my-clock ${slow ? 'slow' : ''}`}>
      <Ring value={ship.oxygen / OXYGEN_S} size={132} stroke={5} color={ship.oxygen < 30 ? '#ff7a6a' : slow ? '#7cc4ff' : '#e8ecff'} />
      <div className="my-clock-text">
        <div className="clock-big">{fmtClock(ship.tau)}</div>
        <div className="clock-small">{ship.status === 'dark' ? 'NO SIGNAL' : `hull ${'●'.repeat(ship.hull)}${'○'.repeat(3 - ship.hull)}`}</div>
      </div>
    </div>
  );
}

function Team() {
  const me = net.identity();
  const players = net.players().filter(p => p.connected && p.identity !== me);
  return (
    <div className="team">
      {players.map(p => {
        const s = net.ship(p.identity);
        return (
          <div key={p.identity} className="mate">
            <span className="dot" style={{ background: p.color }} />
            <span className="mate-name">{p.name}</span>
            <span className="mate-clock">{s ? fmtClock(s.tau) : '--:--.-'}</span>
            {s?.status === 'dark' && <span className="mate-dark">dark</span>}
          </div>
        );
      })}
    </div>
  );
}

function SpeedBar() {
  const f = ship.speed / C;
  return (
    <div className="speed">
      <div className="speed-fill" style={{ width: `${Math.min(100, f * 100)}%` }} />
      <div className="speed-wall" />
    </div>
  );
}

function Comms() {
  const now = performance.now() / 1000;
  const age = now - comms.shownAt;
  const show = comms.line && age < 5.5;
  if (!show) return null;
  const typed = comms.line.slice(0, Math.floor(age * 45));
  return (
    <div className={`comms ${comms.who === 'NEWTON' ? 'newton' : ''}`}>
      <div>
        <div className="comms-who">{comms.who}</div>
        <div className="comms-line">{typed}</div>
      </div>
    </div>
  );
}

/** A crewmate wakes up: a short puzzled line and both clocks, for 6 s, on every screen. */
function Bubble() {
  const now = net.now();
  const recent = net.crew().filter(c => c.status === 'home' && !c.isEinstein && now - c.homeAt < 6500 && now - c.homeAt > 300);
  const c: Crew | undefined = recent[recent.length - 1];
  if (!c) return null;
  const pilot = net.players().find(p => p.identity === c.towedBy);
  return (
    <div className="bubble">
      <div className="bubble-line">“{reunionLine(c)}”</div>
      <div className="bubble-clocks">
        <span>{c.name}: <b>{fmtClock(c.tau)}</b></span>
        <span>{pilot?.name ?? 'Pilot'}: <b>{fmtClock(c.pilotTau)}</b></span>
      </div>
    </div>
  );
}

/** Edge arrows: direction only, never distance for crew. */
function Arrows() {
  const root = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const danger = useRef<HTMLDivElement>(null);
  const white = useRef<HTMLDivElement>(null);
  const black = useRef<HTMLDivElement>(null);
  const pull = useRef<HTMLDivElement>(null);
  const esc = useRef<HTMLDivElement>(null);
  const dialCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let lastBuzz = 0;
    const v3 = new THREE.Vector3();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = root.current, cam = camRef.current;
      if (!el || !cam) return;
      const targets: { id: string; x: number; y: number; z: number; kind: string; label: string }[] = [];
      if (fx.active !== 'intro' || fx.t > 25) {
        for (const p of game.pods.values()) {
          if (p.crew.status !== 'waiting' && p.crew.status !== 'towed') continue;
          targets.push({ id: `c${p.crew.id}`, ...p.pos, kind: p.crew.isEinstein ? 'einstein' : 'crew', label: p.crew.isEinstein ? 'E' : p.crew.name[0] });
        }
        targets.push({ id: 'ms', ...DOCK, kind: 'home', label: '⌂' });
      }
      const w = el.clientWidth, h = el.clientHeight;
      const seen = new Set<string>();
      for (const t of targets) {
        seen.add(t.id);
        let a = el.querySelector<HTMLDivElement>(`[data-id="${t.id}"]`);
        if (!a) { a = document.createElement('div'); a.dataset.id = t.id; a.className = `arrow ${t.kind}`; a.innerHTML = `<span>${t.label}</span>`; el.appendChild(a); }
        v3.set(t.x - origin.x, t.y - origin.y, t.z - origin.z).project(cam);
        const behind = v3.z > 1;
        let x = v3.x, y = v3.y;
        if (behind) { x = -x; y = -y; }
        const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
        if (!onScreen) { const m = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.85); x /= m; y /= m; }
        a.style.transform = `translate(${(x * 0.5 + 0.5) * w}px, ${(-y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
        a.classList.toggle('edge', !onScreen);
      }
      el.querySelectorAll<HTMLDivElement>('.arrow').forEach(a => { if (!seen.has(a.dataset.id!)) a.remove(); });

      // Red edge near a horizon, orange near a star, a white wash in the beam.
      const f = ship.field;
      let beam = 0;
      for (const b of game.bodiesHere) if (b.kind === 'pulsar') beam = Math.max(beam, beamOn(b, ship.pos, game.worldS));
      if (danger.current) {
        danger.current.style.opacity = String(Math.min(1, (f?.danger ?? 0) * 1.2 + (f?.heat ? 0.35 : 0)));
        danger.current.style.boxShadow = f?.heat && !(f.danger > 0.1) ? 'inset 0 0 120px 30px rgba(255,140,40,0.55)' : 'inset 0 0 140px 40px rgba(255,30,30,0.6)';
      }
      if (flash.current) flash.current.style.opacity = String(Math.max(beam * 0.7, ship.hitFlash * 0.35));
      if (white.current) white.current.style.opacity = String(Math.max(fx.whiteout, ship.whiteout));
      if (black.current) black.current.style.opacity = String(fx.blackout);

      // Pull guide: which way you are being dragged, and which way breaks free.
      const pullEl = pull.current, escEl = esc.current;
      if (pullEl && escEl) {
        const a = f ? Math.hypot(f.ax, f.ay, f.az) : 0;
        const show = !fx.active && a > 1.5 && ship.status === 'flying';
        pullEl.style.opacity = escEl.style.opacity = show ? '1' : '0';
        if (show && f) {
          const gx = f.ax / a, gy = f.ay / a, gz = f.az / a;
          const cx = w / 2, cy = h / 2;
          const toScreen = (dx: number, dy: number, dz: number) => {
            v3.set(ship.pos.x + dx * 40 - origin.x, ship.pos.y + dy * 40 - origin.y, ship.pos.z + dz * 40 - origin.z).project(cam);
            const s = v3.z > 1 ? -1 : 1;
            const px = v3.x * s, py = v3.y * s;
            const l = Math.hypot(px, py) || 1;
            return Math.atan2(-py / l, px / l);
          };
          const strong = Math.min(1, a / (THRUST * BOOST));
          const ang = toScreen(gx, gy, gz);
          const rad = Math.min(w, h) * 0.22;
          pullEl.style.transform = `translate(${cx + Math.cos(ang) * rad}px, ${cy + Math.sin(ang) * rad}px) translate(-50%, -50%) rotate(${ang}rad) scale(${0.8 + strong})`;
          pullEl.classList.toggle('over', strong > 0.75);
          // Escape: out of the well and sideways, never straight back up.
          const vx = ship.vel.x, vy = ship.vel.y, vz = ship.vel.z;
          const vr = vx * gx + vy * gy + vz * gz;
          let tx = vx - gx * vr, ty = vy - gy * vr, tz = vz - gz * vr;
          let tl = Math.hypot(tx, ty, tz);
          if (tl < 0.5) { const up = upOf(); tx = up.y * gz - up.z * gy; ty = up.z * gx - up.x * gz; tz = up.x * gy - up.y * gx; tl = Math.hypot(tx, ty, tz) || 1; }
          const ex = -gx + (tx / tl) * 1.4, ey = -gy + (ty / tl) * 1.4, ez = -gz + (tz / tl) * 1.4;
          const eang = toScreen(ex, ey, ez);
          escEl.style.transform = `translate(${cx + Math.cos(eang) * rad}px, ${cy + Math.sin(eang) * rad}px) translate(-50%, -50%)`;
          (escEl.firstChild as HTMLElement).style.transform = `rotate(${eang}rad)`;
          // Phones that can, buzz harder the harder it pulls near a hole.
          const now = performance.now();
          if ((f.danger > 0.3 || strong > 0.75) && now - lastBuzz > 600 && navigator.vibrate) { lastBuzz = now; navigator.vibrate(Math.round(20 + f.danger * 60)); }
        }
      }
      // the two clocks
      const dc = dialCanvas.current;
      if (dc && view.mode === 'chase') {
        const ctx = dc.getContext('2d');
        if (ctx) drawDials(ctx, dc.width, dc.height, dialsNow());
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div ref={danger} className="danger" />
      <div ref={flash} className="flash" />
      <div ref={root} className="arrows" />
      <div ref={pull} className="pull"><span>›››</span></div>
      <div ref={esc} className="escape"><span>➜</span><em>steer here + boost</em></div>
      <canvas ref={dialCanvas} className={`dials ${view.mode === 'cockpit' || fx.active ? 'hidden' : ''}`} width={520} height={210} />
      <div ref={white} className="whiteout" />
      <div ref={black} className="blackout" />
    </>
  );
}

function TetherRing() {
  if (game.tetherHold <= 0) return null;
  return <div className="tether-ring"><Ring value={game.tetherHold} size={64} stroke={4} color="#7ff0ff" /></div>;
}

function Status() {
  const me = net.identity();
  const mine = net.tethers().filter(t => t.owner === me);
  const pod = mine.find(t => t.targetKind === 'crew');
  const p = pod ? game.pods.get(pod.targetCrew) : undefined;
  if (ship.status === 'dark') {
    const others = net.players().filter(x => x.connected && x.identity !== me).length;
    const waited = performance.now() / 1000 - ship.darkSince;
    return (
      <div className="status dark">
        <div>Ship dark. Drifting.</div>
        {others > 0 && <div className="dim">A teammate can tow you home.</div>}
        {others > 0 && waited > 10 && <button onClick={requestRespawn}>Respawn at the mothership</button>}
      </div>
    );
  }
  if (p) {
    const twoShipWaiting = p.crew.twoShip && p.tethered < 2;
    return (
      <div className="status">
        Towing {p.crew.name} · air {Math.max(0, p.air).toFixed(0)}s{twoShipWaiting ? ' · too heavy alone' : ''}
      </div>
    );
  }
  if (mine.some(t => t.targetKind === 'ship')) return <div className="status">Towing a teammate home</div>;
  return null;
}

function Hint() {
  const run = net.run();
  if (!run || net.now() - run.startedAt > 20000) return null;
  return (
    <div className="hint">
      {isTouch()
        ? 'Left thumb steers · drag right to look · THRUST to fly · hold TETHER near a pod'
        : 'Mouse or arrows steer · W / Space thrust · Shift boost · S brake · hold E near a pod to tether, tap E to let go'}
    </div>
  );
}

function EndScreen() {
  const room = net.room();
  const run = net.run();
  const [left, setLeft] = useState(false);
  if (!room || !run || (room.phase !== 'won' && room.phase !== 'lost')) return null;
  if (net.now() - run.endedAt < 11000) return null;
  const crew = [...net.crew()].sort((a, b) => Number(a.isEinstein) - Number(b.isEinstein) || a.slot - b.slot);
  const home = crew.filter(c => c.status === 'home').length;
  return (
    <div className="end">
      <h1>{room.phase === 'won' ? 'They made it home.' : crew.find(c => c.isEinstein)?.status === 'home' ? 'Not everyone made it.' : 'The ship left without him.'}</h1>
      <p className="dim">{home} of {crew.length} came home.</p>
      <ul className="end-crew">
        {crew.map(c => (
          <li key={c.id} className={c.status}>
            <b>{c.name}</b>
            <span>{c.status === 'home' ? `home · their clock ${fmtClock(c.tau)} · pilot's ${fmtClock(c.pilotTau)}` : 'lost · frozen where they were'}</span>
          </li>
        ))}
      </ul>
      {net.isHost()
        ? <button className="big" onClick={() => net.backToLobby()}>Play again</button>
        : <p className="dim">Waiting for the host to play again…</p>}
      {!left && <button onClick={() => { setLeft(true); net.leaveRoom(); setTimeout(() => location.replace('/'), 200); }}>Leave</button>}
    </div>
  );
}

export function Hud() {
  useNet();
  useTick(10);
  const room = net.room();
  const inIntro = fx.active === 'intro';
  const ending = fx.active === 'ending';
  const [muted, setMuted] = useState(audio.isMuted());
  return (
    <div className="hud">
      <Arrows />
      {!inIntro && !ending && room?.phase === 'playing' && (
        <>
          <CrewRow />
          <MyClock />
          <Team />
          <SpeedBar />
          <TetherRing />
          <Status />
          <Bubble />
          <Hint />
        </>
      )}
      {inIntro && net.isHost() && localStorage.getItem('hackyspace.seenIntro') === '1' && (
        <button className="skip" onClick={() => { fx.skipped = true; }}>Skip</button>
      )}
      <Comms />
      {isTouch() && foot.mode === 'foot' && <TwinSticks />}
      <button className="mute" onClick={() => setMuted(audio.toggleMute())}>{muted ? '🔇' : '🔊'}</button>
      <EndScreen />
      <StoryLayers />
    </div>
  );
}
