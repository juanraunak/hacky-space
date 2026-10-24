// One frame of the story in flight (PLAN.md v4): the clocks (mine and
// Newton's), the comet, Einstein's lines when you look at things, falling into
// the hole (death), and reaching Newton (the end).

import { net } from '../net';
import { game, ship, forward } from './game';
import { foot } from './onfoot';
import {
  COMET, HOLE, HOLE_RS, NEWTON_AT, NEWTON_LIMIT, PLANET, cometPos, friendsFlying, myClockRate, newtonAge,
  sayOnce, scenery, stepLines, story,
} from './story';
import { displayShip } from './game';
import type { Body, Vec } from '../universe/bodies';

const dist = (p: Vec) => Math.hypot(p.x - ship.pos.x, p.y - ship.pos.y, p.z - ship.pos.z);
/** Is p within d and roughly where the ship points (so you are looking at it)? */
function lookingAt(p: Vec, d: number, cone = 0.9) {
  const r = dist(p);
  if (r > d) return false;
  const f = forward();
  return ((p.x - ship.pos.x) * f.x + (p.y - ship.pos.y) * f.y + (p.z - ship.pos.z) * f.z) / (r || 1) > cone;
}

let sights: Body[] = [];
let sightsSeed = -1;

/** How much faster the outside runs than me, as I see it. */
export function outsideSpeed(): number {
  return Math.min(12, 1 / Math.max(0.08, myClockRate(ship.gravRate)));
}

export function stepStory(dt: number) {
  const run = net.run();
  if (run && sightsSeed !== run.seed) { sightsSeed = run.seed; sights = scenery(run.seed); }
  const at = (id: string) => sights.find(s => s.id === id)!;
  Object.assign(COMET, cometPos(game.worldS));
  if (story.foundAt || story.lostAt) { stepLines(); return; }

  // the clocks: Newton's runs normally, mine slows near the hole
  if (!story.diedAt) {
    story.myS += dt * myClockRate(ship.gravRate);
    story.newtonS += dt;
    story.seenS += dt * outsideSpeed();
  } else {
    story.newtonS += dt; // time goes on without us
    story.seenS += dt;
    if (newtonAge() >= NEWTON_LIMIT) story.lostAt = performance.now();
    stepLines();
    return;
  }
  if (newtonAge() >= NEWTON_LIMIT) { story.lostAt = performance.now(); return; }

  const since = foot.launchAt ? (performance.now() - foot.launchAt) / 1000 : 99;
  const r = Math.hypot(HOLE.x - ship.pos.x, HOLE.y - ship.pos.y, HOLE.z - ship.pos.z) / HOLE_RS;

  // take-off
  if (since > 2) sayOnce('go', 'Newton got flung past the black hole, onto a planet behind it. We must reach him before he gets too old!', { now: true, hold: 4 });
  if (since > 8) sayOnce('keys', 'Follow the arrow. Hold W to fly, Shift to boost, mouse to steer.', { hold: 3 });
  if (since > 14) sayOnce('photo', `That is Newton's age, up in the corner. If he reaches ${NEWTON_LIMIT}, we were too late.`, { hold: 3.5 });

  // the sights, when you look at them
  if (sights.length) {
    if (lookingAt(HOLE, 1700, 0.95) && since > 20) sayOnce('hole', 'The black hole. It sits between us and Newton. Too close and its pull eats us. Too far around and Newton gets old.', { hold: 4.5 });
    if (lookingAt(at('s:giant'), 900, 0.85)) sayOnce('giant', 'A giant gas planet. Heavy things sag space, and this one sags it a little.', { hold: 3.5 });
    if (lookingAt(at('s:pulsar'), 1400, 0.9)) sayOnce('pulsar', 'A pulsar! A dead star the size of a city, spinning fast and flashing like a lighthouse. The best clock in space.', { hold: 4.5 });
    if (lookingAt(at('s:worm'), 900, 0.92)) sayOnce('worm', 'A wormhole! A tunnel through space. It skips past the black hole. A shortcut, but it drops us close to it.', { hold: 4 });
    if (lookingAt(at('s:twinA'), 1800, 0.9)) sayOnce('twins', 'Two stars, rolling around in each other\'s dips. Forever.', { hold: 3 });
    if (lookingAt(at('s:newton'), 900, 0.9) || dist(PLANET) < 450) sayOnce('planet', 'There! Newton\'s planet. Fly down next to him.', { now: true, hold: 3 });
  }
  if (lookingAt(COMET, 700, 0.88)) sayOnce('comet', 'A comet! A big dirty snowball, melting into a tail.', { hold: 3 });

  // the hole: the closer, the slower my time, the older Newton gets
  if (r < 6) sayOnce('near', 'Careful! This close to the black hole, our time runs slower, and Newton ages faster. Look at him!', { now: true, hold: 3.5 });
  if (r < 3.5) sayOnce('nearer', 'Every second for us is a year for him! Gravity is slowing our time. Get away from it!', { now: true, hold: 3.5 });
  if (r < 2.4) sayOnce('pull', 'Too close! Boost away, hold Shift!', { now: true, hold: 2 });
  if (r < 4 && friendsFlying()) sayOnce('friends', 'Your friends out there are getting older faster than us, too.', { hold: 3 });

  // reaching Newton: the end, once everyone flying is here
  story.waiting = false;
  if (dist(NEWTON_AT) < ARRIVE) {
    if (everyoneHere()) {
      story.foundAt = performance.now();
      story.foundAge = newtonAge();
      story.foundMyS = story.myS;
    } else {
      story.waiting = true;
      sayOnce('wait', 'We made it! Now wait for your friends. Newton is not leaving without all of us.', { now: true, hold: 4 });
    }
  }
  stepLines();
}

const ARRIVE = 70;

/** Is every other connected pilot near Newton? */
function everyoneHere(): boolean {
  const me = net.identity();
  const live = new Set(net.players().filter(p => p.connected).map(p => p.identity));
  for (const s of net.ships()) {
    if (s.identity === me || !live.has(s.identity)) continue; // still in the cabin counts as not here
    const d = displayShip(s.identity) ?? s;
    if (Math.hypot(d.x - NEWTON_AT.x, d.y - NEWTON_AT.y, d.z - NEWTON_AT.z) > ARRIVE + 20) return false;
  }
  return true;
}

/** Into the hole: dead. */
export function die() {
  if (!story.diedAt) story.diedAt = performance.now();
}

/** Try again from far in front of the hole. Newton's clock kept going. */
export function retry() {
  story.diedAt = 0;
  story.line = null; story.queue.length = 0;
  for (const k of ['near', 'nearer', 'pull']) story.said.delete(k);
  ship.pos = { x: HOLE.x, y: HOLE.y + 120, z: HOLE.z + 1400 };
  ship.u = { x: 0, y: 0, z: 0 }; ship.vel = { x: 0, y: 0, z: 0 };
  ship.q.identity();
}

/** Newton got too old: start the space part over, his clock and mine from zero. */
export function restartTrip() {
  story.lostAt = 0; story.diedAt = 0; story.waiting = false;
  story.myS = 0; story.newtonS = 0; story.seenS = 0;
  story.line = null; story.queue.length = 0;
  for (const k of ['near', 'nearer', 'pull', 'wait']) story.said.delete(k);
  ship.pos = { x: HOLE.x, y: HOLE.y + 60, z: HOLE.z + 2150 };
  ship.u = { x: 0, y: 0, z: 0 }; ship.vel = { x: 0, y: 0, z: 0 };
  ship.q.identity();
}
