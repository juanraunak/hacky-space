// ?debug shows every subscribed table live. Handy while the game is a shell.
import { net, useNet } from '../net';

export function DebugTables() {
  useNet();
  const data = {
    status: net.status(),
    me: net.identity().slice(0, 12),
    room: net.room(),
    run: net.run(),
    players: net.players(),
    ships: net.ships().map(s => ({ ...s, identity: s.identity.slice(0, 12) })),
    crew: net.crew(),
    tethers: net.tethers(),
    events: net.events(),
  };
  return <pre className="debug">{JSON.stringify(data, null, 1)}</pre>;
}
