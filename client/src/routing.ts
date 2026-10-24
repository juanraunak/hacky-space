// No router library: "/" is the host screen, "/r/CODE" is a room.
import { useEffect, useState } from 'react';
import { cleanCode } from './net';

export function roomFromPath(path = location.pathname): string {
  const m = path.match(/^\/r\/([A-Za-z0-9]+)/);
  return m ? cleanCode(m[1]) : '';
}

export function roomUrl(code: string): string {
  return `${location.origin}/r/${code}`;
}

/** Move to /r/CODE without a reload, keeping the query string. */
export function goToRoom(code: string, extra = '') {
  const q = new URLSearchParams(location.search);
  if (extra) q.set('level', extra);
  const qs = q.toString();
  history.replaceState(null, '', `/r/${code}${qs ? `?${qs}` : ''}`);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoomCode(): string {
  const [code, setCode] = useState(roomFromPath);
  useEffect(() => {
    const on = () => setCode(roomFromPath());
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  return code;
}

/** /level/pulsar, /level/black-hole, /level/wormhole: a single rescue, straight into play. */
export function levelFromPath(path = location.pathname, search = location.search): string {
  const m = path.match(/^\/level\/([a-z-]+)/) ?? null;
  const raw = m ? m[1] : new URLSearchParams(search).get('level') ?? '';
  const kind = raw.replace(/-/g, '_');
  return ['black_hole', 'pulsar', 'wormhole'].includes(kind) ? kind : '';
}
