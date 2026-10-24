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
export function goToRoom(code: string) {
  history.replaceState(null, '', `/r/${code}${location.search}`);
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
