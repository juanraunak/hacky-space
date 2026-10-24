import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './render/gates.css';
import { net } from './net';
import { game, ship, stepGame } from './play/game';
import { origin, camWorld } from './render/origin';
import { input } from './input/input';
import { launch, foot } from './play/onfoot';
import { story } from './play/story';

// Dev only: poke the database from the console, e.g. __net.ships().
if (import.meta.env.DEV) Object.assign(window, { __net: net, __game: game, __ship: ship, __origin: origin, __cam: camWorld, __input: input, __step: stepGame, __launch: launch, __foot: foot, __story: story });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
