import { toggleView } from '../play/view';

// One mutable input singleton, read inside useFrame and never through React
// state. Mouse, keys and touch all write here, so the flight code does not
// care which moved it.

export const input = {
  stick: { x: 0, y: 0 }, // -1..1; x = yaw, y = pitch (up on screen = nose down? no: up = nose up)
  look: { x: 0, y: 0 }, // pixel deltas since last frame
  thrust: false,
  boost: false,
  brake: false,
  tether: false, // held
  keys: new Set<string>(),
};

export function consumeLook() {
  const l = { x: input.look.x, y: input.look.y };
  input.look.x = 0;
  input.look.y = 0;
  return l;
}

export const isTouch = () => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;

/**
 * True while the mouse is locked. An iPhone has no pointer lock at all:
 * `pointerLockElement` is undefined there, not null.
 */
export const isLocked = () => typeof document !== 'undefined' && !!document.pointerLockElement;

export function grabPointer() {
  if (isLocked()) return;
  const el = document.querySelector('canvas');
  if (!el) return;
  // unadjustedMovement turns off OS pointer acceleration; not every browser
  // has it, and Chrome refuses a second request in one gesture: fall back.
  try {
    const req = el.requestPointerLock({ unadjustedMovement: true }) as unknown as Promise<void> | undefined;
    req?.catch?.(() => { try { el.requestPointerLock(); } catch { /* no lock; drag still works */ } });
  } catch {
    try { el.requestPointerLock(); } catch { /* same */ }
  }
}

const KEYMAP: Record<string, keyof typeof input | null> = {
  Space: 'thrust', KeyW: 'thrust', ShiftLeft: 'boost', ShiftRight: 'boost', KeyS: 'brake', KeyE: 'tether',
};

function syncKeys() {
  const k = input.keys;
  input.thrust = k.has('Space') || k.has('KeyW') || touchButtons.thrust;
  input.boost = k.has('ShiftLeft') || k.has('ShiftRight') || touchButtons.boost;
  input.brake = k.has('KeyS') || touchButtons.brake;
  input.tether = k.has('KeyE') || touchButtons.tether;
  const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  const ky = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
  if (!touchStick.active) {
    if (kx || ky || !mouse.active) { input.stick.x = kx; input.stick.y = ky; }
    else { input.stick.x = curve(mouse.x); input.stick.y = curve(mouse.y); }
  }
}

export const touchButtons = { thrust: false, boost: false, brake: false, tether: false };
/** The mouse's place on screen, -1..1 from the centre (desktop steering, no clicking needed). */
export const mouse = { x: 0, y: 0, active: false };
const DEAD = 0.08;
const curve = (v: number) => { const a = Math.max(0, (Math.abs(v) - DEAD) / (1 - DEAD)); return Math.sign(v) * Math.min(1, a * a * 0.6 + a * 0.6); };
export const touchStick = { active: false };
export const setTouchButton = (b: keyof typeof touchButtons, on: boolean) => { touchButtons[b] = on; syncKeys(); };
export const setStick = (x: number, y: number, active: boolean) => {
  touchStick.active = active;
  input.stick.x = active ? x : 0;
  input.stick.y = active ? y : 0;
  if (!active) syncKeys();
};

let installed = false;
export function installDesktopInput() {
  if (installed) return;
  installed = true;
  addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code in KEYMAP || e.code.startsWith('Arrow') || e.code === 'KeyA' || e.code === 'KeyD') e.preventDefault();
    input.keys.add(e.code);
    syncKeys();
  });
  addEventListener('keyup', e => { input.keys.delete(e.code); syncKeys(); });
  addEventListener('keydown', e => { if (e.code === 'KeyV' && !e.repeat && (e.target as HTMLElement)?.tagName !== 'INPUT') toggleView(); });
  addEventListener('blur', () => { input.keys.clear(); syncKeys(); });
  // Steering by where the mouse is: off-centre turns that way, like a stick.
  document.addEventListener('mousemove', e => {
    if (isLocked()) { input.look.x += e.movementX; input.look.y += e.movementY; return; }
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -((e.clientY / innerHeight) * 2 - 1);
    mouse.active = true;
    syncKeys();
  });
  document.addEventListener('mouseleave', () => { mouse.active = false; syncKeys(); });
}
