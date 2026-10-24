// Einstein on the radio. He reacts to what players do and never tells them
// what to do or what the answer is. One line at a time, 5 s each, at least
// 20 s apart unless a big moment. Never repeats a line in a run. The rule is
// named exactly once, by him, at the very end (see FINAL_LINE).

import { C } from '../game/constants';
import { net, type Crew } from '../net';
import { game, ship } from './game';

const LINES: Record<string, string[]> = {
  near_bh: [
    'Your signal is reaching me... slower. How strange.',
    'Down there your voice sounds like a record played too slow.',
    'I sent you three messages. You answered the first one just now.',
  ],
  fast: [
    'You are moving so fast your messages arrive bunched up. Fascinating.',
    'Push all you like. Something out there will not let you go faster.',
    'Your engine roars and yet the numbers barely move. Curious, no?',
  ],
  home: [
    'She says two minutes. You say ten. And you are both right?',
    'Look at their clock. Now look at yours. Nobody is lying.',
    'Back safe. Though they insist they only just left.',
  ],
  nearly: [
    'Careful! Down there, I think, even light gives up.',
    'Not that close. Some doors only open one way.',
    'Pull up! Whatever falls in there stays there.',
  ],
  low_air: [
    'Her air is running out faster than mine. Strange, no? We were thrown from the same ship.',
    'Out in the open, their air goes quickly. Mine hardly moves.',
    'Some of us have all the time in the world. Some do not. Decide well.',
  ],
  dark: [
    'Nothing there. And yet something is pulling. Look at the stars, not the dark.',
    'An empty place that bends the light around it. Who is hiding?',
    'The stars there look... stretched. As if around something.',
  ],
  wormhole: [
    'You were gone a moment. Here, much longer passed.',
    'Different side, different clock. I wonder which one is right.',
  ],
  arrive_black_hole: [
    'Look how the light curls around it. Even starlight cannot fly straight near that.',
    'There it is. The stars behind it are bent into rings. Space itself is sagging there.',
  ],
  arrive_star: [
    'A big, heavy star. Everything nearby falls toward it, a little. Even you.',
  ],
  pulsar: [
    'A lighthouse that spins faster than a heartbeat. Mind the light.',
    'Count with it. One, and the beam. Two, and the beam.',
  ],
};

const BIG = new Set(['home', 'nearly']);

export const FINAL_LINE = 'Time is not the same for everyone. It depends on where you are, and how fast you move. You just proved it.';

export const comms = {
  who: 'EINSTEIN',
  line: '',
  shownAt: 0,
  lastAt: -1e9,
  used: new Set<string>(),
  queue: [] as string[],
};

export function say(key: string, force = false) {
  const einstein = net.crew().find(c => c.isEinstein);
  if (einstein?.status === 'lost') return; // his radio is silent
  const now = performance.now() / 1000;
  if (!force && !BIG.has(key) && now - comms.lastAt < 20) return;
  if (now - comms.shownAt < 5) return;
  const options = (LINES[key] ?? []).filter(l => !comms.used.has(l));
  if (options.length === 0) return;
  const line = options[Math.floor(Math.random() * options.length)];
  comms.used.add(line);
  comms.who = 'EINSTEIN';
  comms.line = line;
  comms.shownAt = now;
  comms.lastAt = now;
}

/** Show a specific line (cutscenes). */
// Real voices, no text: the browser's speech synthesis, a different voice
// for each of them.
export function speak(line: string, who: string) { // unused: Juan did not like the voices
  try {
    const s = window.speechSynthesis;
    if (!s) return;
    s.cancel();
    const u = new SpeechSynthesisUtterance(line);
    const voices = s.getVoices().filter(v => v.lang.startsWith('en'));
    const pick = (re: RegExp) => voices.find(v => re.test(v.name));
    if (who === 'NEWTON') {
      u.voice = pick(/Daniel|Arthur|Oliver|UK|British/i) ?? voices[0] ?? null;
      u.pitch = 0.85; u.rate = 0.95;
    } else {
      u.voice = pick(/Fred|Ralph|Albert|Alex|Aaron|David/i) ?? voices[1] ?? voices[0] ?? null;
      u.pitch = 0.75; u.rate = 0.9;
    }
    s.speak(u);
  } catch { /* no speech here */ }
}

export function sayExact(line: string, who = 'EINSTEIN') {
  comms.who = who;
  comms.line = line;
  comms.shownAt = performance.now() / 1000;
}

export function resetComms() {
  comms.used.clear();
  comms.line = '';
  comms.lastAt = -1e9;
}

let checkT = 0;
export function einsteinTick(dt: number) {
  checkT += dt;
  if (checkT < 0.5) return;
  checkT = 0;
  const f = ship.field;
  if (!f) return;
  if (f.danger > 0.75) say('nearly');
  else if (f.deepest?.kind === 'black_hole' && f.deepestR < f.deepest.rs * 2.5) say('near_bh');
  else if (ship.speed > C * 0.85) say('fast');
  else if (f.inDark) say('dark');
  else if (ship.whiteout > 0.5) say('wormhole', true);
  else if (game.bodiesHere.some(b => b.kind === 'pulsar' && Math.hypot(b.x - ship.pos.x, b.y - ship.pos.y, b.z - ship.pos.z) < 500)) say('pulsar');
  else if ([...game.pods.values()].some(p => p.crew.status === 'waiting' && p.air > 0 && p.air < 30 && !p.crew.isEinstein)) say('low_air');
}

export function sayArrival(kind: string) {
  const key = kind === 'black_hole' ? 'arrive_black_hole' : kind === 'dark_matter' ? 'dark' : kind === 'star' ? 'arrive_star' : kind;
  comms.shownAt = 0; // a big moment: interrupt
  say(key, true);
}

export function einsteinOnHome(c: Crew) {
  if (c.isEinstein) return; // his own homecoming is the ending
  if (c.pilotTau - c.tau > 20) say('home');
}

// --- crewmates, waking up --------------------------------------------------

const REUNION = [
  "Wait. I've been gone {crew}. Why do you all look so tired?",
  'You say it took {you}? I counted {crew}.',
  "My watch says {crew}. Yours says {you}. One of them is broken.",
  'That was quick. Was it quick? It felt quick.',
  "{crew}, I'd swear. Did you all stop for lunch?",
  "Huh. I'm hungry like it's been {crew}. You look like it's been {you}.",
];

export const fmtClock = (s: number) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.max(0, s) - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};

const fmtWords = (s: number) => (s < 90 ? `${Math.round(s)} seconds` : `${(s / 60).toFixed(1)} minutes`);

export function reunionLine(c: Crew): string {
  const t = REUNION[c.slot % REUNION.length];
  return t.replace('{crew}', fmtWords(c.tau)).replace('{you}', fmtWords(c.pilotTau));
}
