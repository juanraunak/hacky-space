// A game pad, like a PS4 controller, as one shared object everything reads:
//   left stick  (lx, ly): move. Up = forward, down = back, sideways = turn/strafe.
//   right stick (rx, ry): aim / look around. Up = look up.
// Phones fill it from two on-screen sticks (hud/TwinSticks.tsx); a real
// gamepad fills it through the Gamepad API; desktop keys fill lx/ly
// (W/S forward/back, A/D turn). Values are -1..1, read every frame.

export const pad = {
  lx: 0, ly: 0, rx: 0, ry: 0,
  active: false, // on-screen sticks or a gamepad are in use
  a: false, // gamepad A / cross: grab (E)
  b: false, // gamepad B / circle: boost
};

const DEAD = 0.12;
const dz = (v: number) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD) / (1 - DEAD)));

/** Poll a connected gamepad (call once per frame). */
export function pollGamepad() {
  const gp = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
  if (!gp) return;
  const [lx, ly, rx, ry] = gp.axes;
  const used = [lx, ly, rx, ry].some(v => Math.abs(v ?? 0) > DEAD) || gp.buttons.some(b => b.pressed);
  if (!used && !pad.active) return;
  pad.active = true;
  pad.lx = dz(lx ?? 0); pad.ly = -dz(ly ?? 0);
  pad.rx = dz(rx ?? 0); pad.ry = -dz(ry ?? 0);
  pad.a = !!gp.buttons[0]?.pressed;
  pad.b = !!gp.buttons[1]?.pressed || !!gp.buttons[7]?.pressed;
}
