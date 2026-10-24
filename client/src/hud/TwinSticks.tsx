// Two fixed on-screen sticks for phones, like a PS4 pad: left moves, right
// aims/looks. Each stick sits in its corner; touch anywhere on that half and
// the stick follows your thumb (it re-centres where you touch). Plus two
// round buttons above the right stick: GRAB (E) and BOOST.
// Hardened like Hacky's TouchInput: window-level pointerup, try around
// setPointerCapture, one pointer per side.

import { useEffect, useRef, useState } from 'react';
import { pad } from '../input/pad';
import { setTouchButton } from '../input/input';
import './twinsticks.css';

const R = 56; // stick travel, px

interface Thumb { id: number; x0: number; y0: number; x: number; y: number }

export function TwinSticks() {
  const left = useRef<Thumb | null>(null);
  const right = useRef<Thumb | null>(null);
  const [, redraw] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    const kick = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(() => redraw(x => x + 1)); };
    const set = (side: 'l' | 'r', t: Thumb | null) => {
      let dx = 0, dy = 0;
      if (t) {
        dx = t.x - t.x0; dy = t.y - t.y0;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      }
      if (side === 'l') { pad.lx = dx / R; pad.ly = -dy / R; } else { pad.rx = dx / R; pad.ry = -dy / R; }
      pad.active = true;
      kick();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if ((e.target as HTMLElement)?.closest('button, .ts-btn')) return;
      const isLeft = e.clientX < innerWidth / 2;
      const slot = isLeft ? left : right;
      if (slot.current) return;
      slot.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      set(isLeft ? 'l' : 'r', slot.current);
    };
    const move = (e: PointerEvent) => {
      for (const [slot, side] of [[left, 'l'], [right, 'r']] as const) {
        const t = slot.current;
        if (t && t.id === e.pointerId) { t.x = e.clientX; t.y = e.clientY; set(side, t); }
      }
    };
    const up = (e: PointerEvent) => {
      for (const [slot, side] of [[left, 'l'], [right, 'r']] as const) {
        if (slot.current?.id === e.pointerId) { slot.current = null; set(side, null); }
      }
    };
    const swallow = (ev: Event) => ev.preventDefault();
    addEventListener('pointerdown', down);
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    document.addEventListener('touchmove', swallow, { passive: false });
    document.addEventListener('gesturestart', swallow);
    return () => {
      removeEventListener('pointerdown', down);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      document.removeEventListener('touchmove', swallow);
      document.removeEventListener('gesturestart', swallow);
      pad.lx = pad.ly = pad.rx = pad.ry = 0;
    };
  }, []);

  const stick = (t: Thumb | null, side: 'l' | 'r') => {
    const base = t ? { left: t.x0, top: t.y0 } : undefined;
    const vx = side === 'l' ? pad.lx : pad.rx, vy = side === 'l' ? -pad.ly : -pad.ry;
    return (
      <div className={`ts-stick ts-${side} ${t ? 'on' : ''}`} style={base}>
        <div className="ts-nub" style={{ transform: `translate(${vx * R}px, ${vy * R}px)` }} />
      </div>
    );
  };

  const hold = (name: 'tether' | 'boost') => ({
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine */ } setTouchButton(name, true); },
    onPointerUp: () => setTouchButton(name, false),
    onPointerCancel: () => setTouchButton(name, false),
  });

  return (
    <div className="ts-layer">
      {stick(left.current, 'l')}
      {stick(right.current, 'r')}
      <button className="ts-btn ts-grab" {...hold('tether')}>GRAB</button>
      <button className="ts-btn ts-boost" {...hold('boost')}>BOOST</button>
    </div>
  );
}
