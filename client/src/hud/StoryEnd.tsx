// The story's screen layers (PLAN.md v4):
//  - Newton's photo in the corner: he gets older as his time passes. Near
//    the black hole my time runs slow, so he ages fast.
//  - a blue glow at the screen edges near the hole (light from outside
//    arrives brighter and bluer);
//  - falling in: you die, the real reason why, try again;
//  - reaching Newton: how long it was for him, and the lesson.

import { useEffect, useRef, useState } from 'react';
import { net } from '../net';
import { ship } from '../play/game';
import { foot } from '../play/onfoot';
import * as THREE from 'three';
import { NEWTON_AGE0, NEWTON_AT, NEWTON_LIMIT, flightSaying, myClockRate, newtonAge, story } from '../play/story';
import { retry, restartTrip } from '../play/storyStep';
import { camRef } from '../render/CameraRig';
import { origin } from '../render/origin';
import './storyend.css';

function useFrameTick() {
  const [, redraw] = useState(0);
  useEffect(() => {
    let id = 0;
    const tick = () => { id = requestAnimationFrame(tick); redraw(x => (x + 1) % 1e6); };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);
}

/** Blue glow at the screen edges while my clock runs slow (DOM, every frame). */
function BlueShift() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id = 0;
    const tick = () => {
      id = requestAnimationFrame(tick);
      const e = el.current;
      if (!e) return;
      const slow = foot.mode === 'fly' && !story.diedAt && !story.foundAt ? Math.max(0, Math.min(1, (1 / Math.max(0.05, myClockRate(ship.gravRate)) - 1.3) / 4)) : 0;
      e.style.opacity = slow.toFixed(3);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);
  return <div ref={el} className="blueshift" />;
}

// --- Newton's photo -------------------------------------------------------------

const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, t))));
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** A cartoon Newton whose wig greys, beard grows and face wrinkles with age. */
export function NewtonFace({ age, size = 96 }: { age: number; size?: number }) {
  const old = (age - NEWTON_AGE0) / 50; // 0 now .. 1 at ~94
  const hair = rgb(old < 0.5 ? mix([92, 62, 38], [150, 140, 130], old * 2) : mix([150, 140, 130], [245, 245, 240], (old - 0.5) * 2));
  const beard = Math.max(0, Math.min(1, (age - 52) / 40));
  const wrinkle = Math.max(0, Math.min(1, (age - 58) / 30));
  const skin = rgb(mix([246, 205, 170], [232, 196, 172], old));
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      {/* the big curly wig, behind */}
      {[[22, 40], [18, 56], [22, 72], [78, 40], [82, 56], [78, 72], [30, 26], [50, 20], [70, 26]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={13} fill={hair} stroke="#111" strokeWidth={2} />
      ))}
      {/* face */}
      <ellipse cx={50} cy={52} rx={22} ry={26} fill={skin} stroke="#111" strokeWidth={2.5} />
      {/* beard, longer with age */}
      {beard > 0 && (
        <path d={`M30 60 Q50 ${70 + beard * 30} 70 60 Q66 ${76 + beard * 22} 50 ${80 + beard * 18} Q34 ${76 + beard * 22} 30 60 Z`} fill={hair} stroke="#111" strokeWidth={2} />
      )}
      {/* eyes and brows */}
      <circle cx={42} cy={48} r={2.6} fill="#111" />
      <circle cx={58} cy={48} r={2.6} fill="#111" />
      <path d="M37 42 L46 41 M54 41 L63 42" stroke={old < 0.3 ? '#3b2a1c' : hair} strokeWidth={2.5} strokeLinecap="round" />
      {/* wrinkles */}
      <g opacity={wrinkle} stroke="#7a5a48" strokeWidth={1.4} fill="none" strokeLinecap="round">
        <path d="M40 34 Q50 31 60 34" /><path d="M42 37 Q50 35 58 37" />
        <path d="M34 50 L31 48 M66 50 L69 48" />
      </g>
      {/* nose and mouth */}
      <path d="M50 50 Q48 57 51 58" stroke="#111" strokeWidth={2} fill="none" strokeLinecap="round" />
      {beard < 0.6 && <path d="M43 64 Q50 68 57 64" stroke="#111" strokeWidth={2.2} fill="none" strokeLinecap="round" />}
    </svg>
  );
}

function NewtonPhoto() {
  useFrameTick();
  const last = useRef({ age: NEWTON_AGE0, t: performance.now(), speed: 0 });
  if (foot.mode !== 'fly' || story.foundAt) return null;
  const age = newtonAge();
  const now = performance.now();
  const l = last.current;
  const dt = (now - l.t) / 1000;
  if (dt > 0.25) { l.speed += ((age - l.age) / dt - l.speed) * 0.5; l.age = age; l.t = now; }
  const fast = Math.max(0, Math.min(1, l.speed / 1.2)); // years per second
  const left = Math.max(0, Math.min(1, (NEWTON_LIMIT - age) / (NEWTON_LIMIT - NEWTON_AGE0)));
  return (
    <div className={`space-card newton-photo ${fast > 0.25 ? 'aging' : ''}`}>
      <NewtonFace age={age} size={44} />
      <div className="newton-info">
        <div className="newton-age">Newton {Math.floor(age)}</div>
        <div className="newton-bar"><i style={{ width: `${left * 100}%`, background: left > 0.4 ? '#6fd08c' : left > 0.18 ? '#ffc04d' : '#ff5a4d' }} /></div>
      </div>
    </div>
  );
}

// --- Einstein's lines in flight: a card at the bottom ----------------------------------

function Caption() {
  useFrameTick();
  if (foot.mode !== 'fly') return null;
  const said = flightSaying();
  if (!said) return null;
  const chars = Array.from(said.text);
  return (
    <div className="space-card caption" style={{ opacity: said.alpha }} key={said.text}>
      <div className="space-who">EINSTEIN</div>
      <div className="space-line"><span>{chars.slice(0, said.shown).join('')}</span><span style={{ opacity: 0 }}>{chars.slice(said.shown).join('')}</span></div>
    </div>
  );
}

// --- the pointer to Newton ------------------------------------------------------------

/** A small arrow that points at Newton: on screen it sits over him, off screen it rides the edge. */
function NewtonPointer() {
  const el = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const v = new THREE.Vector3();
    let id = 0;
    const tick = () => {
      id = requestAnimationFrame(tick);
      const e = el.current, cam = camRef.current;
      if (!e) return;
      const on = foot.mode === 'fly' && !story.diedAt && !story.foundAt && !story.lostAt && !!cam;
      e.style.display = on ? '' : 'none';
      if (!on || !cam) return;
      v.set(NEWTON_AT.x - origin.x, NEWTON_AT.y - origin.y, NEWTON_AT.z - origin.z).project(cam);
      let x = v.x, y = v.y;
      const behind = v.z > 1;
      if (behind) { x = -x; y = -y; }
      const m = Math.max(Math.abs(x), Math.abs(y));
      const inside = !behind && m < 0.85;
      if (!inside) { x = (x / (m || 1)) * 0.85; y = (y / (m || 1)) * 0.8; }
      const W = innerWidth, H = innerHeight;
      const px = (x * 0.5 + 0.5) * W, py = (-y * 0.5 + 0.5) * H;
      // inside: point down at him; outside: point out toward him
      const ang = inside ? 180 : Math.atan2(x * W, y * H) * 180 / Math.PI;
      e.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
      (e.firstChild as HTMLElement).style.transform = `rotate(${ang}deg)`;
      const dist = Math.hypot(NEWTON_AT.x - (cam.position.x + origin.x), NEWTON_AT.y - (cam.position.y + origin.y), NEWTON_AT.z - (cam.position.z + origin.z));
      if (label.current) label.current.textContent = story.waiting ? 'waiting for friends' : dist > 1000 ? `${(dist / 1000).toFixed(1)}k` : `${Math.round(dist)}`;
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div ref={el} className="newton-pointer">
      <div className="newton-arrow" />
      <span ref={label} />
    </div>
  );
}

// --- Newton got too old -------------------------------------------------------------

function TooOld() {
  useFrameTick();
  if (!story.lostAt) return null;
  return (
    <div className="fallin">
      <div className="fallin-black">
        <div className="space-card found-newton"><NewtonFace age={NEWTON_LIMIT + 8} size={130} /><b>NEWTON · {NEWTON_LIMIT}</b></div>
        <div className="fallin-end">
          <h1>Too late.</h1>
          <p>Newton grew old waiting for us.</p>
          <p>Near the black hole our time ran slow. For him, out there, the years kept flying by.</p>
          <button className="big" onClick={() => restartTrip()}>Try again</button>
        </div>
      </div>
    </div>
  );
}

// --- dying in the hole ----------------------------------------------------------

function Death() {
  useFrameTick();
  if (!story.diedAt) return null;
  const s = (performance.now() - story.diedAt) / 1000;
  const k = Math.min(1, s / 2.2);
  const r = 4 + Math.pow(k, 1.7) * 150;
  const ring = `radial-gradient(circle at 50% 50%, #000 ${r}vmax, rgba(190,225,255,${0.95 * (1 - k * 0.6)}) ${r + 2.5}vmax, rgba(120,170,255,${0.35 * (1 - k)}) ${r + 9}vmax, transparent ${r + 16}vmax)`;
  return (
    <div className="fallin">
      <div className="fallin-ring" style={{ background: ring }} />
      {s > 2.2 && (
        <div className="fallin-black">
          <div className="fallin-end">
            <h1>You fell into the black hole.</h1>
            <p>Nothing comes back out of a black hole. Not even light.</p>
            <p>In real life, its pull would stretch you like spaghetti. Nobody survives.</p>
            <p className="dim">Newton is still waiting. And his time kept going…</p>
            <button className="big" onClick={() => retry()}>Try again</button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- finding Newton: the end --------------------------------------------------------

interface Beat { at: number; who: 'newton' | 'einstein'; text: string }

function Found() {
  useFrameTick();
  const [left, setLeft] = useState(false);
  if (!story.foundAt) return null;
  const s = (performance.now() - story.foundAt) / 1000;
  const years = Math.max(0, Math.round(story.foundAge - NEWTON_AGE0));
  const mins = Math.max(1, Math.round((story.foundAt - (foot.launchAt || story.foundAt)) / 60000));
  const long = years >= 5;
  const beats: Beat[] = [
    { at: 1, who: 'newton', text: long ? `Albert?! What took you so long? I have waited here ${years} years!` : 'Albert! You came so fast! I was barely here a moment.' },
    {
      at: 6.5, who: 'einstein', text: long
        ? `For us it was only ${mins} minute${mins === 1 ? '' : 's'}, Isaac. We flew close to the black hole. Near it, our time ran slow.`
        : 'We stayed far from the black hole, so our clocks stayed together.',
    },
    { at: 13, who: 'einstein', text: 'Heavy things bend space. That bend is gravity. And in the bend, time runs slower.' },
    { at: 19, who: 'newton', text: long ? 'So gravity is not a rope… it bends time itself!' : 'Hmm. Next time, fly closer to the hole and see what happens to me!' },
  ];
  const current = [...beats].reverse().find(b => s >= b.at);
  const n = current ? Math.floor((s - current.at) * 30) : 0;
  const chars = current ? Array.from(current.text) : [];
  return (
    <div className="found">
      <div className="space-card found-newton"><NewtonFace age={story.foundAge} size={150} /><b>NEWTON · {Math.floor(story.foundAge)}</b></div>
      {current && s < 25 && (
        <div className="space-card caption" key={current.text}>
          <div className="space-who">{current.who === 'newton' ? 'NEWTON' : 'EINSTEIN'}</div>
          <div className="space-line"><span>{chars.slice(0, n).join('')}</span><span style={{ opacity: 0 }}>{chars.slice(n).join('')}</span></div>
        </div>
      )}
      {s > 25 && (
        <div className="fallin-end">
          <h1>You found Newton.</h1>
          <p>You: {mins} minute{mins === 1 ? '' : 's'}. Newton: {years} year{years === 1 ? '' : 's'} older.</p>
          <p className="dim">Gravity bends space, and bent space slows time.</p>
          {net.isHost()
            ? <button className="big" onClick={() => net.backToLobby()}>Play again</button>
            : <p className="dim">Waiting for the host to play again…</p>}
          {!left && <button onClick={() => { setLeft(true); net.leaveRoom(); setTimeout(() => location.replace('/'), 200); }}>Leave</button>}
        </div>
      )}
    </div>
  );
}

export function StoryLayers() {
  return (
    <>
      <BlueShift />
      <Caption />
      <NewtonPhoto />
      <NewtonPointer />
      <TooOld />
      <Death />
      <Found />
    </>
  );
}
