import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { net, useNet } from '../net';
import { roomUrl } from '../routing';

export function Lobby() {
  useNet();
  const code = net.code();
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toDataURL(roomUrl(code), { margin: 1, width: 220 }).then(setQr).catch(() => setQr(''));
  }, [code]);

  const players = net.players().filter(p => p.connected);
  const room = net.room();
  const hostGone = room && !players.some(p => p.identity === room.host);

  return (
    <main className="screen">
      <p className="dim">Room</p>
      <h1 className="code">{code}</h1>
      {qr && <img className="qr" src={qr} alt={`QR code for room ${code}`} />}
      <p className="dim small">{roomUrl(code)}</p>
      <ul className="pilots">
        {players.map(p => (
          <li key={p.identity}>
            <span className="dot" style={{ background: p.color }} />
            {p.name}
            {p.identity === room?.host && <span className="dim"> · host</span>}
            {p.identity === net.identity() && <span className="dim"> · you</span>}
          </li>
        ))}
      </ul>
      {net.isHost()
        ? <button className="big" onClick={() => net.startRun()}>Launch ({players.length} pilot{players.length === 1 ? '' : 's'})</button>
        : <p className="dim">Waiting for the host to launch…</p>}
      {hostGone && <button onClick={() => net.claimHost()}>Become host</button>}
    </main>
  );
}
