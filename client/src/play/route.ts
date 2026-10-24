// Checkpoints: a trail of big rings from where you are to what you should do
// next. Fly through the next ring, it lights up, the next one appears. The
// last ring sits at the crewmate (rescue them) or at home (deliver them).
//
// The route itself teaches the safe way in, never in words:
//   black hole  a spiral that curls in tangentially to a hover point beside
//               the pod (straight in is how you fall);
//   pulsar      down from above the spin pole, where the sweeping beams never
//               reach, then a short drop to the pod;
//   wormhole    into the mouth; on the far side, on to the pod; and home
//               through the far mouth again.
// Objective: home while you tow a pod, else the waiting pod with the least
// air (most urgent), else home.

import { net } from '../net';
import { game, ship, DOCK, type PodView } from './game';
import { add, cross, dist, len, mul, norm, sub, v, type Vec } from '../universe/bodies';
import { audio } from '../audio/audio';

export interface Gate { p: Vec; n: Vec; r: number; final?: boolean }

export const route = {
  key: '',
  gates: [] as Gate[],
  next: 0,
  target: { kind: 'home' as 'home' | 'pod', crewId: -1, name: 'HOME' },
  passedAt: 0,
  passed: null as Gate | null,
};

const SPACING = 320;
const GATE_R = 16;

function objective(): { kind: 'home' | 'pod'; pod?: PodView } {
  const me = net.identity();
  const towing = !!game.tow || net.tethers().some(t => t.owner === me && t.targetKind === 'crew');
  if (towing) return { kind: 'home' };
  let best: PodView | undefined;
  for (const p of game.pods.values()) {
    if (p.crew.status !== 'waiting') continue;
    if (!best || p.air < best.air) best = p;
  }
  return best ? { kind: 'pod', pod: best } : { kind: 'home' };
}

/** Straight-line gates from a to b, every SPACING units (b itself excluded). */
function line(a: Vec, b: Vec, out: Vec[]) {
  const d = dist(a, b);
  const n = Math.min(6, Math.floor(d / SPACING));
  for (let i = 1; i <= n; i++) out.push(add(a, mul(sub(b, a), i / (n + 1))));
}

function anyPerp(d: Vec): Vec {
  const ref = Math.abs(d.y) < 0.9 ? v(0, 1, 0) : v(1, 0, 0);
  return norm(cross(d, ref));
}

/** The approach points for a pod, in flying order, ending at the pod. */
function approach(pod: PodView, from: Vec): Vec[] {
  const b = pod.poi.bodies[0];
  const P = pod.pos;
  if (pod.poi.kind === 'black_hole' && b) {
    const d = norm(sub(P, b)); // hole -> pod
    let t = norm(cross(b.normal, d)); // around the hole, in the disc plane
    if (len(t) < 0.5) t = anyPerp(d);
    // come in from the side you are on
    if (dot3(t, sub(from, b)) < 0) t = mul(t, -1);
    const rs = b.rs;
    const pts: Vec[] = [];
    for (const [R, a] of [[10, 1.25], [6.5, 0.85], [3.8, 0.45], [2.3, 0.15]] as const) {
      pts.push(add(b, add(mul(d, R * rs * Math.cos(a)), mul(t, R * rs * Math.sin(a)))));
    }
    pts.push(P);
    return pts;
  }
  if (pod.poi.kind === 'pulsar' && b) {
    // above whichever spin pole faces you: the beams sweep the equator band
    let s = norm(b.spinAxis);
    if (dot3(s, sub(from, b)) < 0) s = mul(s, -1);
    return [add(b, mul(s, 260)), add(b, mul(s, 110)), add(P, mul(s, 22)), P];
  }
  if (pod.poi.kind === 'wormhole') {
    const entry = pod.poi.bodies.find(x => x.kind === 'wormhole' && x.mouth === 'entry');
    const exit = pod.poi.bodies.find(x => x.kind === 'wormhole' && x.mouth === 'exit');
    if (entry && exit && dist(from, exit) > 700) {
      // not through yet: to the entry mouth (flying into it takes you across)
      const into = norm(sub(entry, from));
      return [sub(entry, mul(into, 120)), entry];
    }
    return [P];
  }
  return [P];
}

function homeApproach(from: Vec): Vec[] {
  // towing a pod from the far side of a wormhole: back through the far mouth
  if (game.tow) {
    const pod = game.pods.get(game.tow.crewId);
    if (pod?.poi.kind === 'wormhole') {
      const exit = pod.poi.bodies.find(x => x.kind === 'wormhole' && x.mouth === 'exit');
      if (exit && dist(from, exit) < 900) {
        const into = norm(sub(exit, from));
        return [sub(exit, mul(into, 90)), exit, v(DOCK.x, DOCK.y, DOCK.z)];
      }
    }
  }
  return [v(DOCK.x, DOCK.y, DOCK.z)];
}

const dot3 = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;

function build(from: Vec, pts: Vec[], finalR: number): Gate[] {
  const all: Vec[] = [];
  let a = from;
  for (const p of pts) { line(a, p, all); all.push(p); a = p; }
  return all.map((p, i) => {
    const prev = i === 0 ? from : all[i - 1];
    const n = norm(sub(p, prev));
    const final = i === all.length - 1;
    return { p, n, r: final ? finalR : GATE_R, final };
  });
}

/** Called every frame from the game loop. */
export function stepRoute() {
  const room = net.room();
  if (!room || room.phase !== 'playing' || ship.status === 'dark') { route.gates = []; route.key = ''; return; }
  const o = objective();
  const pod = o.pod;
  const wormSide = pod?.poi.kind === 'wormhole' ? (dist(ship.pos, pod.poi.bodies.find(x => x.mouth === 'exit') ?? ship.pos) > 700 ? 'near' : 'far') : '';
  const homeSide = o.kind === 'home' && game.tow ? `${game.tow.crewId}:${(() => { const p = game.pods.get(game.tow!.crewId); const ex = p?.poi.bodies.find(x => x.mouth === 'exit'); return ex && dist(ship.pos, ex) < 900 ? 'far' : 'near'; })()}` : '';
  const key = o.kind === 'pod' ? `pod:${pod!.crew.id}:${wormSide}` : `home:${homeSide}`;

  const stray = route.gates[route.next] && dist(ship.pos, route.gates[route.next].p) > SPACING * 2.6;
  if (key !== route.key || stray || route.next >= route.gates.length) {
    if (key !== route.key || stray) {
      route.key = key;
      route.target = o.kind === 'pod' ? { kind: 'pod', crewId: pod!.crew.id, name: pod!.crew.name.toUpperCase() } : { kind: 'home', crewId: -1, name: 'HOME' };
      const pts = o.kind === 'pod' ? approach(pod!, ship.pos) : homeApproach(ship.pos);
      route.gates = build(ship.pos, pts, o.kind === 'pod' ? 9 : 20);
      route.next = 0;
    }
  }
  // the pod moves (pulsar orbit, runaway): keep the last gate on it
  if (o.kind === 'pod' && route.gates.length) route.gates[route.gates.length - 1].p = pod!.pos;

  const g = route.gates[route.next];
  if (!g || g.final) return;
  // passed: inside the ring, or crossed its plane close to it
  const rel = sub(ship.pos, g.p);
  const along = dot3(rel, g.n);
  const radial = len(sub(rel, mul(g.n, along)));
  if (dist(ship.pos, g.p) < g.r * 1.3 || (along > 0 && along < 30 && radial < g.r * 1.6)) {
    route.passed = g;
    route.passedAt = performance.now();
    route.next++;
    audio.blip(880 + route.next * 40);
  }
}

export function nextGate(): Gate | undefined { return route.gates[route.next]; }
