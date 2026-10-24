// One frame of the story in flight (PLAN.md v4): the clocks (mine and
// Newton's), the comet, Einstein's lines when you look at things, falling into
// the hole (death), and reaching Newton (the end).

import { net } from '../net';
import { game, ship, forward } from './game';
import { foot } from './onfoot';
import {
  COMET, HOLE, HOLE_RS, NEWTON_AT, PLANET, cometPos, friendsFlying, myClockRate, newtonAge,
  sayOnce, scenery, stepLines, story,
} from './story';
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
  if (story.foundAt) { stepLines(); return; }

  // the clocks: Newton's runs normally, mine slows near the hole
  if (!story.diedAt) {
    story.myS += dt * myClockRate(ship.gravRate);
    story.newtonS += dt;
    story.seenS += dt * outsideSpeed();
  } else {
    story.newtonS += dt; // time goes on without us
    story.seenS += dt;
    stepLines();
    return;
  }

  const since = foot.launchAt ? (performance.now() - foot.launchAt) / 1000 : 99;
  const r = Math.hypot(HOLE.x - ship.pos.x, HOLE.y - ship.pos.y, HOLE.z - ship.pos.z) / HOLE_RS;

  // take-off
  if (since > 2) sayOnce('go', 'Newton got flung past the black hole, onto that blue planet behind it. Let\'s go get him!', { now: true, hold: 3.5 });
  if (since > 7) sayOnce('keys', 'Hold W to fly, Shift to boost. Move the mouse to steer.', { hold: 3 });
  if (since > 13) sayOnce('photo', 'That\'s Newton, up in the corner. Keep an eye on him.', { hold: 3 });

  // the sights, when you look at them
  if (sights.length) {
    if (lookingAt(HOLE, 1600, 0.97) && since > 18) sayOnce('hole', 'That black hole is in the way. Don\'t fly close! If it grabs us, nothing comes back out. Not even light.', { hold: 4 });
    if (lookingAt(at('s:giant'), 600)) sayOnce('giant', 'A giant gas planet. Heavy things sag space, and this one sags it a little.', { hold: 3.5 });
    if (lookingAt(at('s:pulsar'), 800, 0.85)) sayOnce('pulsar', 'A pulsar! A dead star the size of a city, spinning fast and flashing like a lighthouse. The best clock in space.', { hold: 4.5 });
    if (lookingAt(at('s:worm'), 450, 0.85)) sayOnce('worm', 'A wormhole! A tunnel through space. I bet it comes out near Newton. A shortcut!', { hold: 3.5 });
    if (lookingAt(at('s:twinA'), 800, 0.85)) sayOnce('twins', 'Two stars, rolling around in each other\'s dips. Forever.', { hold: 3 });
    if (lookingAt(at('s:newton'), 900, 0.9) || dist(PLANET) < 450) sayOnce('planet', 'There! Newton\'s planet. Fly down next to him.', { now: true, hold: 3 });
  }
  if (lookingAt(COMET, 400, 0.85)) sayOnce('comet', 'A comet! A big dirty snowball, melting into a tail.', { hold: 3 });

  // the hole: the closer, the slower my time, the older Newton gets
  if (r < 7) sayOnce('near', 'Careful! This close to the black hole, our time runs slower. Look at Newton!', { now: true, hold: 3.5 });
  if (r < 4) sayOnce('nearer', 'Every second for us is a year for him! Gravity is slowing our time. Get away from it!', { now: true, hold: 3.5 });
  if (r < 2.6) sayOnce('pull', 'Too close! Boost away, hold Shift!', { now: true, hold: 2 });
  if (r < 4 && friendsFlying()) sayOnce('friends', 'Your friends out there are getting older faster than us, too.', { hold: 3 });

  // reaching Newton: the end
  if (dist(NEWTON_AT) < 22) {
    story.foundAt = performance.now();
    story.foundAge = newtonAge();
    story.foundMyS = story.myS;
  }
  stepLines();
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
  ship.pos = { x: HOLE.x, y: HOLE.y + 90, z: HOLE.z + 1500 };
  ship.u = { x: 0, y: 0, z: 0 }; ship.vel = { x: 0, y: 0, z: 0 };
  ship.q.identity();
}
