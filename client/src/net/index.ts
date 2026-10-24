// THE ONLY FILE THAT TOUCHES THE SPACETIMEDB SDK.
//
// One socket, one store. Game code imports `net` and the plain row types
// below; it never sees an SDK type. Identities become hex strings and
// timestamps become epoch milliseconds at this boundary.
//
// Rows land in plain Maps. React reads them through useNet() (a version
// counter). Hot paths (the frame loop) read net.ships() etc. directly, never
// through React state.

import { useSyncExternalStore } from 'react';
import { DbConnection } from '../module_bindings';

const URI = import.meta.env.VITE_SPACETIME_URI as string;
const DB_NAME = import.meta.env.VITE_SPACETIME_DB as string;
const TOKEN_KEY = 'hackyspace.token';

// ---------------------------------------------------------------------------
// Plain row types, the shape the game sees.

export type Phase = 'lobby' | 'intro' | 'playing' | 'won' | 'lost';

export interface Room { code: string; host: string; phase: Phase; createdAt: number }
export interface Player { identity: string; roomCode: string; name: string; color: string; connected: boolean; joinedAt: number }
export interface Ship {
  identity: string; roomCode: string;
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  tau: number; oxygen: number; hull: number;
  status: 'flying' | 'dark' | 'home';
  updatedAt: number;
}
export interface Run {
  roomCode: string; seed: number; introAt: number; startedAt: number; countdownS: number;
  pilots: number; crewCount: number; result: '' | 'won' | 'lost'; endedAt: number; podAirS: number;
}
export interface Crew {
  id: number; roomCode: string; slot: number; name: string; poi: string; twoShip: boolean;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  status: 'waiting' | 'towed' | 'home' | 'lost'; towedBy: string; tau: number; homeAt: number; pilotTau: number;
  isEinstein: boolean; air: number; airMs: number; px: number; py: number; pz: number; moved: boolean;
}
export interface Tether {
  id: string; roomCode: string; owner: string; targetKind: 'crew' | 'ship';
  targetCrew: number; targetShip: string; since: number;
}
export interface RoomEvent { id: string; roomCode: string; name: string; firedBy: string; firedAt: number }

export interface ShipPose {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  tau: number; oxygen: number; hull: number; status: Ship['status'];
}

export type Status = 'idle' | 'connecting' | 'connected' | 'error';

// ---------------------------------------------------------------------------
// Conversions at the boundary.

type Hexable = { toHexString(): string };
type Stamp = { microsSinceUnixEpoch: bigint };
const hex = (id: Hexable) => id.toHexString();
const ms = (ts: Stamp) => Number(ts.microsSinceUnixEpoch / 1000n);

/* eslint-disable @typescript-eslint/no-explicit-any */
const toRoom = (r: any): Room => ({ code: r.code, host: hex(r.host), phase: r.phase, createdAt: ms(r.createdAt) });
const toPlayer = (r: any): Player => ({
  identity: hex(r.identity), roomCode: r.roomCode, name: r.name, color: r.color,
  connected: r.connected, joinedAt: ms(r.joinedAt),
});
const toShip = (r: any): Ship => ({
  identity: hex(r.identity), roomCode: r.roomCode,
  x: r.x, y: r.y, z: r.z, qx: r.qx, qy: r.qy, qz: r.qz, qw: r.qw,
  vx: r.vx, vy: r.vy, vz: r.vz, tau: r.tau, oxygen: r.oxygen, hull: r.hull,
  status: r.status, updatedAt: ms(r.updatedAt),
});
const toRun = (r: any): Run => ({
  roomCode: r.roomCode, seed: r.seed, introAt: ms(r.introAt), startedAt: ms(r.startedAt),
  countdownS: r.countdownS, pilots: r.pilots, crewCount: r.crewCount, result: r.result, endedAt: ms(r.endedAt), podAirS: r.podAirS,
});
const toCrew = (r: any): Crew => ({
  id: r.id, roomCode: r.roomCode, slot: r.slot, name: r.name, poi: r.poi, twoShip: r.twoShip,
  x: r.x, y: r.y, z: r.z, vx: r.vx, vy: r.vy, vz: r.vz,
  status: r.status, towedBy: hex(r.towedBy), tau: r.tau, homeAt: ms(r.homeAt), pilotTau: r.pilotTau,
  isEinstein: r.isEinstein, air: r.air, airMs: r.airMs, px: r.px, py: r.py, pz: r.pz, moved: r.moved,
});
const toTether = (r: any): Tether => ({
  id: String(r.id), roomCode: r.roomCode, owner: hex(r.owner), targetKind: r.targetKind,
  targetCrew: r.targetCrew, targetShip: hex(r.targetShip), since: ms(r.since),
});
const toEvent = (r: any): RoomEvent => ({
  id: String(r.id), roomCode: r.roomCode, name: r.name, firedBy: hex(r.firedBy), firedAt: ms(r.firedAt),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// State.

let conn: DbConnection | null = null;
let connecting: Promise<DbConnection> | null = null;
let status: Status = 'idle';
let lastError = '';
let me = '';
let subscribedCode = '';
let subscribing: Promise<void> | null = null;

const rooms = new Map<string, Room>();
const players = new Map<string, Player>();
const shipRows = new Map<string, Ship>();
const runs = new Map<string, Run>();
const crewRows = new Map<number, Crew>();
const tethers = new Map<string, Tether>();
const events = new Map<string, RoomEvent>();

// Server clock offset: serverMs ≈ Date.now() + clockOffset. Estimated from our
// own ship row echoes (updatedAt is stamped by the server when it lands).
let clockOffset = 0;
let lastSendAt = 0;

let version = 0;
let bumpQueued = false;
const listeners = new Set<() => void>();
function bump() {
  if (bumpQueued) return;
  bumpQueued = true;
  queueMicrotask(() => {
    bumpQueued = false;
    version++;
    for (const l of listeners) l();
  });
}

function readToken(): string | undefined {
  try { return localStorage.getItem(TOKEN_KEY) ?? undefined; } catch { return undefined; }
}
function writeToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
}

// The SDK can hand back a raw DOM Event on a socket drop: "[object Event]".
function readable(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof Event !== 'undefined' && e instanceof Event) return 'lost connection to the server';
  return 'something went wrong talking to the server';
}

// ---------------------------------------------------------------------------
// Connection and subscriptions.

function wire(c: DbConnection) {
  const keep = <K, R, T>(map: Map<K, T>, to: (r: R) => T, key: (t: T) => K) => ({
    insert: (_: unknown, r: R) => { const t = to(r); map.set(key(t), t); bump(); },
    update: (_: unknown, _old: R, r: R) => { const t = to(r); map.set(key(t), t); bump(); },
    remove: (_: unknown, r: R) => { map.delete(key(to(r))); bump(); },
  });
  const bind = <K, R, T>(table: any, map: Map<K, T>, to: (r: R) => T, key: (t: T) => K) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const h = keep(map, to, key);
    table.onInsert(h.insert);
    table.onDelete(h.remove);
    if (table.onUpdate) table.onUpdate(h.update);
  };
  bind(c.db.room, rooms, toRoom, r => r.code);
  bind(c.db.player, players, toPlayer, r => r.identity);
  bind(c.db.ship, shipRows, toShip, r => r.identity);
  bind(c.db.run, runs, toRun, r => r.roomCode);
  bind(c.db.crew, crewRows, toCrew, r => r.id);
  bind(c.db.tether, tethers, toTether, r => r.id);
  bind(c.db.room_event, events, toEvent, r => r.id);

  // Clock offset from our own echoes: the server stamped updatedAt on arrival.
  c.db.ship.onUpdate((_ctx, _old, row) => {
    if (hex(row.identity) !== me || !lastSendAt) return;
    const sample = ms(row.updatedAt) - (lastSendAt + Date.now()) / 2;
    clockOffset = clockOffset === 0 ? sample : clockOffset * 0.9 + sample * 0.1;
  });
}

function connect(): Promise<DbConnection> {
  if (conn) return Promise.resolve(conn);
  // StrictMode mounts twice; without this guard that opens two sockets.
  if (connecting) return connecting;
  status = 'connecting';
  bump();
  connecting = new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB_NAME)
      .withToken(readToken())
      .onConnect((c, identity, token) => {
        conn = c;
        me = identity.toHexString();
        writeToken(token);
        wire(c);
        status = 'connected';
        lastError = '';
        bump();
        resolve(c);
      })
      .onConnectError((_ctx, e) => {
        connecting = null;
        status = 'error';
        lastError = readable(e);
        bump();
        reject(new Error(lastError));
      })
      .onDisconnect((_ctx, e) => {
        conn = null;
        connecting = null;
        subscribedCode = '';
        subscribing = null;
        status = e ? 'error' : 'idle';
        if (e) lastError = readable(e);
        bump();
      })
      .build();
  });
  return connecting;
}

// Room codes are [A-Z2-9]{6} by construction; this also makes them safe to
// inline into SQL.
export function cleanCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
}

function clearRoomRows() {
  for (const m of [rooms, players, shipRows, runs, crewRows, tethers, events] as Map<unknown, unknown>[]) m.clear();
}

/** Subscribe to one room. Every room-scoped table is filtered by its btree room_code. */
function subscribeRoom(c: DbConnection, code: string): Promise<void> {
  if (subscribedCode === code) return Promise.resolve();
  if (subscribing) return subscribing;
  subscribing = new Promise<void>((resolve, reject) => {
    c.subscriptionBuilder()
      .onApplied(() => {
        subscribedCode = code;
        subscribing = null;
        bump();
        resolve();
      })
      .onError(() => {
        subscribing = null;
        reject(new Error(`could not subscribe to room ${code}`));
      })
      .subscribe([
        `SELECT * FROM room WHERE code = '${code}'`,
        `SELECT * FROM player WHERE room_code = '${code}'`,
        `SELECT * FROM ship WHERE room_code = '${code}'`,
        `SELECT * FROM run WHERE room_code = '${code}'`,
        `SELECT * FROM crew WHERE room_code = '${code}'`,
        `SELECT * FROM tether WHERE room_code = '${code}'`,
        `SELECT * FROM room_event WHERE room_code = '${code}'`,
      ]);
  });
  return subscribing;
}

/** Wait until some row matching `test` shows up (reducers return nothing). */
function waitFor<T>(read: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const hit = read();
    if (hit !== undefined) return resolve(hit);
    const t0 = performance.now();
    const check = () => {
      const v = read();
      if (v !== undefined) { listeners.delete(check); resolve(v); }
      else if (performance.now() - t0 > timeoutMs) { listeners.delete(check); reject(new Error('the server did not answer in time')); }
    };
    listeners.add(check);
    const timer = setInterval(() => { check(); if (!listeners.has(check)) clearInterval(timer); }, 250);
  });
}

let creating: Promise<string> | null = null;

// ---------------------------------------------------------------------------
// The public face.

function call(fn: (c: DbConnection) => void) {
  if (!conn) { console.warn('[net] not connected'); return; }
  try { fn(conn); } catch (e) { lastError = readable(e); bump(); }
}

export const net = {
  status: () => status,
  error: () => lastError,
  identity: () => me,
  code: () => subscribedCode,
  version: () => version,

  /** Server time in ms, estimated. Use for the countdown and run clocks. */
  now: () => Date.now() + clockOffset,

  room: (): Room | undefined => (subscribedCode ? rooms.get(subscribedCode) : undefined),
  run: (): Run | undefined => (subscribedCode ? runs.get(subscribedCode) : undefined),
  players: (): Player[] => [...players.values()].filter(p => p.roomCode === subscribedCode),
  ships: (): Ship[] => [...shipRows.values()].filter(s => s.roomCode === subscribedCode),
  ship: (identity = me): Ship | undefined => shipRows.get(identity),
  crew: (): Crew[] => [...crewRows.values()].filter(c => c.roomCode === subscribedCode).sort((a, b) => a.slot - b.slot),
  tethers: (): Tether[] => [...tethers.values()].filter(t => t.roomCode === subscribedCode),
  events: (): RoomEvent[] => [...events.values()].filter(e => e.roomCode === subscribedCode),
  isHost: () => net.room()?.host === me,

  connect,

  /** Make a new room (reusing one this identity hosts still in the lobby). */
  async createRoom(): Promise<string> {
    if (creating) return creating;
    creating = (async () => {
      const c = await connect();
      const mine = await new Promise<string | undefined>(resolve => {
        c.subscriptionBuilder()
          .onApplied(() => resolve([...rooms.values()].find(r => r.host === me && r.phase === 'lobby')?.code))
          .onError(() => resolve(undefined))
          .subscribe([`SELECT * FROM room WHERE host = 0x${me}`]);
      });
      if (mine) return mine;
      const before = new Set(rooms.keys());
      c.reducers.createRoom({});
      const room = await waitFor(() => [...rooms.values()].find(r => r.host === me && r.phase === 'lobby' && !before.has(r.code)));
      return room.code;
    })().finally(() => { creating = null; });
    return creating;
  },

  /** Connect, subscribe to the room and join it as `name`. Idempotent. */
  async join(rawCode: string, name: string): Promise<void> {
    const code = cleanCode(rawCode);
    const c = await connect();
    if (subscribedCode && subscribedCode !== code) clearRoomRows();
    await subscribeRoom(c, code);
    if (!rooms.get(code)) throw new Error(`no room called ${code}`);
    c.reducers.joinRoom({ code, name });
    await waitFor(() => players.get(me)?.roomCode === code ? true : undefined);
  },

  // --- reducers, one wrapper each -----------------------------------------
  setName: (name: string) => call(c => c.reducers.setName({ name })),
  leaveRoom: () => call(c => c.reducers.leaveRoom({})),
  startRun: () => call(c => c.reducers.startRun({})),
  startLevel: (kind: string) => call(c => c.reducers.startLevel({ kind })),
  beginPlay: () => call(c => c.reducers.beginPlay({})),
  backToLobby: () => call(c => c.reducers.backToLobby({})),
  claimHost: () => call(c => c.reducers.claimHost({})),
  respawn: () => call(c => c.reducers.respawn({})),
  syncShip: (p: ShipPose) => call(c => { lastSendAt = Date.now(); c.reducers.syncShip(p); }),
  tetherCrew: (crewId: number, air: number) => call(c => c.reducers.tetherCrew({ crewId, air })),
  reportPod: (crewId: number, x: number, y: number, z: number, air: number) => call(c => c.reducers.reportPod({ crewId, x, y, z, air })),
  tetherShip: (target: string) => call(c => {
    const row = [...c.db.ship.iter()].find(s => hex(s.identity) === target);
    if (row) c.reducers.tetherShip({ target: row.identity });
  }),
  releaseTether: () => call(c => c.reducers.releaseTether({})),
  dockCrew: (crewId: number, crewTau: number, pilotTau: number, air: number) => call(c => c.reducers.dockCrew({ crewId, crewTau, pilotTau, air })),
  loseCrew: (crewId: number, x: number, y: number, z: number) => call(c => c.reducers.loseCrew({ crewId, x, y, z })),
  fireEvent: (name: string) => call(c => c.reducers.fireEvent({ name })),

  subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};

/** Re-render when anything in the store changes. Not for per-frame reads. */
export function useNet(): number {
  return useSyncExternalStore(net.subscribe, net.version, net.version);
}
