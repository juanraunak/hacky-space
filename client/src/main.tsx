import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { net } from './net';

// Dev only: poke the database from the console, e.g. __net.ships().
if (import.meta.env.DEV) (window as unknown as { __net: typeof net }).__net = net;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
