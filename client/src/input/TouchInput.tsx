// Phone input, after Hacky's TouchInput (world1/TouchInput.tsx), the most
// battle-tested part of that repo. Left 45%: a floating stick where the thumb
// lands. Right: drag to look. Buttons on the right also look when dragged.
// Hardening kept: window-level pointerup/cancel (a thumb lifted elsewhere
// keeps its role forever otherwise), try around setPointerCapture (threw
// InvalidStateError live), swallow gestures, non-passive touchmove, menus.
//
// With a mouse, a click asks for pointer lock and a drag looks as a floor.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { input, isLocked, setStick, setTouchButton, touchButtons } from './input';

const STICK_RADIUS_PX = 60;
const MOVE_ZONE = 0.45;

interface Pointer { id: number; role: 'move' | 'look'; x0: number; y0: number; x: number; y: number }

/** A phone button that also looks when dragged (the right thumb rests on them). */
function useLookButton(name: keyof typeof touchButtons) {
  return useMemo(() => {
    let id = -1, x = 0, y = 0;
    const end = (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerId !== id) return;
      id = -1;
      setTouchButton(name, false);
    };
    return {
      onPointerDown(e: React.PointerEvent<HTMLElement>) {
        e.stopPropagation();
        if (id !== -1) return;
        id = e.pointerId; x = e.clientX; y = e.clientY;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* captured to its button anyway */ }
        setTouchButton(name, true);
      },
      onPointerMove(e: React.PointerEvent<HTMLElement>) {
        if (e.pointerId !== id) return;
        input.look.x += e.clientX - x;
        input.look.y += e.clientY - y;
        x = e.clientX; y = e.clientY;
      },
      onPointerUp: end,
      onPointerCancel: end,
    };
  }, [name]);
}

export function TouchInput({ showButtons }: { showButtons: boolean }) {
  const pointers = useRef(new Map<number, Pointer>());
  const root = useRef<HTMLDivElement>(null);
  const [ring, setRing] = useState<{ x: number; y: number; nx: number; ny: number } | null>(null);

  const setMove = useCallback((p: Pointer | null) => {
    if (!p) { setStick(0, 0, false); setRing(null); return; }
    let dx = p.x - p.x0, dy = p.y - p.y0;
    const d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS_PX) { dx = (dx / d) * STICK_RADIUS_PX; dy = (dy / d) * STICK_RADIUS_PX; }
    setStick(dx / STICK_RADIUS_PX, -dy / STICK_RADIUS_PX, true);
    setRing({ x: p.x0, y: p.y0, nx: dx, ny: dy });
  }, []);

  const onDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = root.current;
    if (!el) return;
    // A mouse steers by its position (input.ts); only touches use this overlay.
    if (e.pointerType === 'mouse') return;
    const mouse = false;
    const role: Pointer['role'] = !mouse && e.clientX < el.clientWidth * MOVE_ZONE ? 'move' : 'look';
    for (const p of pointers.current.values()) if (p.role === role) return; // one pointer per role
    try { el.setPointerCapture(e.pointerId); } catch { /* moves still reach the overlay */ }
    const p = { id: e.pointerId, role, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, p);
    if (role === 'move') setMove(p);
  }, [setMove]);

  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (p.role === 'move') setMove(p);
    else if (!isLocked()) { input.look.x += dx; input.look.y += dy; }
  }, [setMove]);

  const onUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    pointers.current.delete(e.pointerId);
    const el = root.current;
    try { if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch { /* fine */ }
    if (p.role === 'move') setMove(null);
  }, [setMove]);

  useEffect(() => {
    const swallow = (ev: Event) => ev.preventDefault();
    const lifted = (e: PointerEvent) => {
      const p = pointers.current.get(e.pointerId);
      if (!p) return;
      pointers.current.delete(e.pointerId);
      if (p.role === 'move') setMove(null);
    };
    addEventListener('pointerup', lifted);
    addEventListener('pointercancel', lifted);
    document.addEventListener('gesturestart', swallow);
    document.addEventListener('gesturechange', swallow);
    document.addEventListener('touchmove', swallow, { passive: false });
    document.addEventListener('contextmenu', swallow);
    return () => {
      removeEventListener('pointerup', lifted);
      removeEventListener('pointercancel', lifted);
      document.removeEventListener('gesturestart', swallow);
      document.removeEventListener('gesturechange', swallow);
      document.removeEventListener('touchmove', swallow);
      document.removeEventListener('contextmenu', swallow);
      setStick(0, 0, false);
    };
  }, [setMove]);

  const thrust = useLookButton('thrust');
  const boost = useLookButton('boost');
  const brake = useLookButton('brake');
  const tether = useLookButton('tether');

  return (
    <div ref={root} className="touch-overlay" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {ring && (
        <div className="touch-ring" style={{ left: ring.x, top: ring.y }}>
          <div className="touch-nub" style={{ transform: `translate(${ring.nx}px, ${ring.ny}px)` }} />
        </div>
      )}
      {showButtons && (
        <div className="touch-buttons">
          <button className="tb tb-tether" {...tether}>TETHER</button>
          <button className="tb tb-brake" {...brake}>BRAKE</button>
          <button className="tb tb-boost" {...boost}>BOOST</button>
          <button className="tb tb-thrust" {...thrust}>THRUST</button>
        </div>
      )}
    </div>
  );
}
