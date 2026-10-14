import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED, TICK_SECONDS, regionDef, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[]; closed: string | null } = {
    messages,
    closed: null,
    send: (m) => messages.push(m),
    close(reason) {
      this.closed = reason;
    },
  };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const none = { x: null, y: null };
const sanctum = regionDef('sanctum')!;

describe('Region', () => {
  it('welcomes a player at spawn and announces them', () => {
    const region = new Region(sanctum);
    const a = fakeConn();
    region.join(info('a', 'Mara'), a, none);
    expect(a.messages[0]).toMatchObject({ t: 'welcome', x: region.map.spawn.x, y: region.map.spawn.y });
    expect(a.messages[1]).toMatchObject({ t: 'system', text: 'Mara entered the Sanctum.' });
  });

  it('restores a saved position only when it is walkable', () => {
    const region = new Region(sanctum);
    const ok = { x: region.map.spawn.x + 1, y: region.map.spawn.y };
    region.join(info('a'), fakeConn(), ok);
    expect(region.position('a')).toEqual(ok);
    const shrine = region.map.landmarks.find((l) => l.asset === 'sanctum-shrine')!;
    const blocked = { x: Math.floor(shrine.x) + 0.5, y: Math.floor(shrine.y) - 0.5 };
    region.join(info('b'), fakeConn(), blocked);
    expect(region.position('b')).toEqual(region.map.spawn);
  });

  it('applies inputs on tick and acknowledges them', () => {
    const region = new Region(sanctum);
    const a = fakeConn();
    region.join(info('a'), a, none);
    region.handle('a', { t: 'input', seq: 1, dx: 1, dy: 0 });
    region.tick();
    const snap = a.messages.at(-1)!;
    expect(snap).toMatchObject({ t: 'snapshot', ack: 1 });
    expect((snap as { x: number }).x).toBeCloseTo(region.map.spawn.x + PLAYER_SPEED * TICK_SECONDS);
  });

  it('limits how far a flooding client can move per tick', () => {
    const region = new Region(sanctum);
    region.join(info('a'), fakeConn(), none);
    for (let seq = 1; seq <= 50; seq++) region.handle('a', { t: 'input', seq, dx: 1, dy: 0 });
    region.tick();
    const moved = region.position('a')!.x - region.map.spawn.x;
    expect(moved).toBeLessThanOrEqual(2 * PLAYER_SPEED * TICK_SECONDS + 1e-9);
  });

  it('only sends players inside the view radius', () => {
    const region = new Region(sanctum);
    const a = fakeConn();
    const { spawn } = region.map;
    region.join(info('a'), a, none);
    region.join(info('near'), fakeConn(), { x: spawn.x + 2, y: spawn.y });
    region.join(info('far'), fakeConn(), { x: 1.5, y: 32.5 });
    region.tick();
    const snap = a.messages.at(-1) as Extract<ServerMessage, { t: 'snapshot' }>;
    expect(snap.online).toBe(3);
    expect(snap.players.map((p) => p.id)).toEqual(['near']);
  });

  it('delivers say chat nearby and world chat everywhere', () => {
    const region = new Region(sanctum);
    const a = fakeConn();
    const near = fakeConn();
    const far = fakeConn();
    const { spawn } = region.map;
    region.join(info('a', 'Mara'), a, none);
    region.join(info('near'), near, { x: spawn.x + 2, y: spawn.y });
    region.join(info('far'), far, { x: 1.5, y: 32.5 });
    region.handle('a', { t: 'chat', channel: 'say', text: '  hello   there ' });
    region.handle('a', { t: 'chat', channel: 'world', text: 'hi all' });
    const chats = (c: typeof a) => c.messages.filter((m) => m.t === 'chat').map((m) => (m as { text: string }).text);
    expect(chats(near)).toEqual(['hello there', 'hi all']);
    expect(chats(far)).toEqual(['hi all']);
  });

  it('rate limits chat', () => {
    let now = 0;
    const region = new Region(sanctum, undefined, () => now);
    const a = fakeConn();
    region.join(info('a'), a, none);
    for (let i = 0; i < 7; i++) region.handle('a', { t: 'chat', channel: 'say', text: `m${i}` });
    expect(a.messages.filter((m) => m.t === 'chat')).toHaveLength(5);
    expect(a.messages.some((m) => m.t === 'error' && m.code === 'chat_rate')).toBe(true);
    now = 6000;
    region.handle('a', { t: 'chat', channel: 'say', text: 'later' });
    expect(a.messages.filter((m) => m.t === 'chat')).toHaveLength(6);
  });

  it('replaces an older connection for the same player', () => {
    const region = new Region(sanctum);
    const first = fakeConn();
    region.join(info('a'), first, none);
    region.join(info('a'), fakeConn(), none);
    expect(first.closed).toBeTruthy();
    expect(region.online).toBe(1);
  });
});
