import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { net } from './net';
import { game, ship, stepGame } from './play/game';
import { origin, camWorld } from './render/origin';
import { input } from './input/input';

// Dev only: poke the database from the console, e.g. __net.ships().
if (import.meta.env.DEV) Object.assign(window, { __net: net, __game: game, __ship: ship, __origin: origin, __cam: camWorld, __input: input, __step: stepGame });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
