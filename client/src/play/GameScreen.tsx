import { useEffect } from 'react';
import { net, useNet } from '../net';
import { Scene } from '../render/Scene';
import { Hud } from '../hud/Hud';
import { TouchInput } from '../input/TouchInput';
import { installDesktopInput, isTouch } from '../input/input';
import { resetComms } from './einstein';
import { resetCutscenes } from '../cutscenes/cutscenes';

let lastSeed = -1;

export function GameScreen() {
  useNet();
  const run = net.run();
  const room = net.room();

  useEffect(() => { installDesktopInput(); }, []);

  // A fresh run: clear the radio and the cutscene bookkeeping.
  useEffect(() => {
    if (run && run.seed !== lastSeed) { lastSeed = run.seed; resetComms(); resetCutscenes(); }
  }, [run]);

  // The intro ends on server time; any client nudges the phase along.
  useEffect(() => {
    const id = setInterval(() => {
      const r = net.room(), rn = net.run();
      if (r?.phase === 'intro' && rn && net.now() >= rn.startedAt) net.beginPlay();
      if (r?.phase === 'playing') { try { localStorage.setItem('hackyspace.seenIntro', '1'); } catch { /* fine */ } }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const playing = room?.phase === 'playing';
  return (
    <div className="game">
      <Scene />
      <Hud />
      <TouchInput showButtons={isTouch() && playing} />
    </div>
  );
}
