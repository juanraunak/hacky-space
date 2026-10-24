import { useEffect, useRef, useState } from 'react';
import { net, useNet } from './net';
import { goToRoom, levelFromPath, useRoomCode } from './routing';
import { Lobby } from './lobby/Lobby';
import { DebugTables } from './lobby/DebugTables';
import { GameScreen } from './play/GameScreen';
import { SpaceBackdrop } from './lobby/SpaceBackdrop';

const NAME_KEY = 'hackyspace.name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
const saveName = (n: string) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* private mode */ } };

export function App() {
  useNet();
  const code = useRoomCode();
  const [name, setName] = useState(readName);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState('');

  // Join the room in the URL once we have a name. Idempotent on reconnect.
  useEffect(() => {
    if (!code || !name || joined === code) return;
    let live = true;
    net.join(code, name)
      .then(() => { if (live) { setJoined(code); setError(''); } })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [code, name, joined]);

  async function host() {
    setError('');
    try { goToRoom(await net.createRoom(), levelFromPath()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  // A level link (/level/pulsar): make a room and drop straight into it.
  const level = levelFromPath();
  useEffect(() => {
    if (level && !code && name) void host();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, code, name]);
  const room0 = net.room();
  const startedLevel = useRef('');
  useEffect(() => {
    if (!level || !room0 || joined !== code || !net.isHost()) return;
    if (room0.phase === 'lobby' && startedLevel.current !== code) {
      startedLevel.current = code;
      net.startLevel(level);
    }
  });

  if (!name) {
    return (
      <>
        <SpaceBackdrop />
        <NamePrompt onName={n => { saveName(n); setName(n); }} />
      </>
    );
  }

  if (!code) {
    return (
      <>
      <SpaceBackdrop />
      <main className="screen title">
        <h1>HACKY SPACE</h1>
        <p className="dim">The star is dying. The crew is scattered. Every pod's clock runs at its own speed.<br />Bring them home, together.</p>
        <button className="big" onClick={host}>Host a room</button>
        <p className="dim small">Friends join by scanning your room's QR code.</p>
        {error && <p className="error">{error}</p>}
      </main>
      </>
    );
  }

  const room = net.room();
  if (!room || joined !== code) {
    return (
      <main className="screen">
        <p className="dim">{error || `Joining ${code}…`}</p>
        {error && <button onClick={() => { location.href = '/'; }}>Back</button>}
      </main>
    );
  }

  // Every client renders purely from room.phase.
  return (
    <>
      {room.phase === 'lobby' ? <><SpaceBackdrop /><Lobby /></> : <GameScreen />}
      {new URLSearchParams(location.search).has('debug') && <DebugTables />}
    </>
  );
}

function NamePrompt({ onName }: { onName: (n: string) => void }) {
  const [v, setV] = useState('');
  return (
    <main className="screen title">
      <h1>HACKY SPACE</h1>
      <form onSubmit={e => { e.preventDefault(); if (v.trim()) onName(v.trim().slice(0, 16)); }}>
        <input autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="Your pilot name" maxLength={16} />
        <button className="big" type="submit">Go</button>
      </form>
    </main>
  );
}
