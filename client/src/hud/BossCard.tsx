// The boss-style arrival card. When game.arrival starts (the first time you
// come near a phenomenon, while cutscenes.ts flies the 5.5 s orbit shot), the
// letterbox bars slide in, a big title tracks in under a thin line, an italic
// subtitle follows, a low swell plays, and it is all gone by 5 s.
//
// React renders only when a card starts or ends. Every animated value is
// written straight to the DOM from one requestAnimationFrame loop.

import { useEffect, useRef, useState } from 'react';
import { game } from '../play/game';
import { audio } from '../audio/audio';
import './bosscard.css';

type Card = { title: string; sub: string; eyebrow: string; accent: string; glow: string };

const CARDS: Record<string, Card> = {
  pulsar: { title: 'Pulsar', sub: 'the dead star that keeps time', eyebrow: 'neutron star', accent: '#a8dcff', glow: 'rgba(120, 190, 255, 0.5)' },
  wormhole: { title: 'Wormhole', sub: 'a door between two places', eyebrow: 'Einstein–Rosen bridge', accent: '#d4b8ff', glow: 'rgba(180, 140, 255, 0.5)' },
  black_hole: { title: 'Black Hole', sub: 'where time almost stops', eyebrow: 'Schwarzschild', accent: '#ffc27a', glow: 'rgba(255, 170, 90, 0.5)' },
};

const END = 5.0; // seconds: everything gone
const seen = new Set<string>();
const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const ease = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const outCubic = (x: number) => { x = clamp01(x); return 1 - (1 - x) ** 3; };
/** 0 → 1 over [a, b], then 1 → 0 over [c, d]. */
const env = (t: number, a: number, b: number, c: number, d: number) => ease((t - a) / (b - a)) * (1 - ease((t - c) / (d - c)));

export function BossCard() {
  const [card, setCard] = useState<{ at: number; c: Card } | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const eyebrow = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLParagraphElement>(null);
  const shownAt = useRef(-1);

  // Watch for a new arrival (cheap: one field read per frame).
  useEffect(() => {
    let raf = 0;
    const watch = () => {
      raf = requestAnimationFrame(watch);
      const a = game.arrival;
      if (!a || a.at === shownAt.current) return;
      shownAt.current = a.at;
      const c = CARDS[a.body.kind];
      const t = (performance.now() - a.at) / 1000;
      if (!c || t > END - 0.5) return;
      // One card per phenomenon per run (a wormhole's two mouths are one).
      const key = `${game.worldKey}|${a.body.poi ?? a.body.id}|${a.body.kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      setCard({ at: a.at, c });
      if (t < 0.5) {
        audio.swell();
        window.setTimeout(() => audio.thud(0.22), 650);
      }
    };
    raf = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Animate the card while it is up.
  useEffect(() => {
    if (!card) return;
    let raf = 0;
    const step = () => {
      const t = (performance.now() - card.at) / 1000;
      // A newer arrival, or the arrival was cleared (new run): drop the card.
      const a = game.arrival;
      if (t >= END || (a && a.at !== card.at) || (!a && t < 4)) { setCard(null); return; }
      raf = requestAnimationFrame(step);

      const bars = outCubic(t / 0.6) * (1 - ease((t - 4.2) / 0.8));
      if (top.current) top.current.style.transform = `translateY(${(-100 * (1 - bars)).toFixed(2)}%)`;
      if (bottom.current) bottom.current.style.transform = `translateY(${(100 * (1 - bars)).toFixed(2)}%)`;
      if (shade.current) shade.current.style.opacity = env(t, 0.3, 1.4, 3.9, 4.8).toFixed(3);

      if (eyebrow.current) eyebrow.current.style.opacity = (0.85 * env(t, 0.45, 1.2, 3.8, 4.6)).toFixed(3);

      const tl = title.current;
      if (tl) {
        const k = env(t, 0.5, 1.7, 3.9, 4.8);
        // tracking-in: wide and soft, settling slowly all the way through
        const ls = 0.2 + 0.26 * (1 - outCubic((t - 0.4) / 3.6));
        const blur = 8 * (1 - outCubic((t - 0.5) / 1.3)) + 6 * ease((t - 4.0) / 0.8);
        tl.style.opacity = k.toFixed(3);
        tl.style.letterSpacing = `${ls.toFixed(4)}em`;
        tl.style.paddingLeft = `${ls.toFixed(4)}em`;
        tl.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
      }

      const ln = line.current;
      if (ln) {
        ln.style.transform = `scaleX(${outCubic((t - 0.9) / 1.2).toFixed(4)})`;
        ln.style.opacity = env(t, 0.9, 1.4, 3.9, 4.7).toFixed(3);
      }

      const sb = sub.current;
      if (sb) {
        const k = env(t, 1.5, 2.5, 3.9, 4.7);
        sb.style.opacity = k.toFixed(3);
        sb.style.transform = `translateY(${(6 * (1 - outCubic((t - 1.5) / 1.2))).toFixed(2)}px)`;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [card]);

  if (!card) return null;
  const { c } = card;
  return (
    <div className="boss" aria-live="polite"
      style={{ ['--boss-accent' as string]: c.accent, ['--boss-glow' as string]: c.glow }}>
      <div ref={top} className="boss-bar top" />
      <div ref={bottom} className="boss-bar bottom" />
      <div ref={shade} className="boss-shade" />
      <div className="boss-block">
        <div ref={eyebrow} className="boss-eyebrow">{c.eyebrow}</div>
        <h1 ref={title} className="boss-title">{c.title}</h1>
        <div ref={line} className="boss-line" />
        <p ref={sub} className="boss-sub">{c.sub}</p>
      </div>
    </div>
  );
}
