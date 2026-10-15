import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED, TICK_SECONDS, collides, newCharacter, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { type Connection } from '../src/region.ts';
import { World } from '../src/world.ts';

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

describe('World', () => {
  it('puts players in their saved region, or home when it is unknown', () => {
    const world = new World();
    world.join(info('a'), fakeConn(), { regionId: 'shore', x: null, y: null }, newCharacter());
    world.join(info('b'), fakeConn(), { regionId: 'nowhere', x: null, y: null }, newCharacter());
    expect(world.regionOf('a')!.def.id).toBe('shore');
    expect(world.regionOf('b')!.def.id).toBe('sanctum');
  });

  it('moves a player who walks off the west edge of the Sanctum into the Woods', () => {
    const world = new World();
    const home = world.home;
    const west = home.map.entries.west!;
    const a = fakeConn();
    const watcher = fakeConn();
    world.join(info('a', 'Mara'), a, { regionId: 'sanctum', x: west.x, y: west.y }, newCharacter());
    world.join(info('w'), watcher, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    let last = { x: west.x, y: west.y };
    let seq = 1;
    for (; seq <= 40; seq++) {
      world.handle('a', { t: 'input', seq, dx: -1, dy: 0 });
      world.tick();
      if (world.regionOf('a')!.def.id !== 'sanctum') break;
      last = home.position('a')!;
    }
    const woods = world.regionOf('a')!;
    expect(woods.def.id).toBe('woods');
    const welcome = a.messages.filter((m) => m.t === 'welcome').at(-1);
    expect(welcome).toMatchObject({ region: { id: 'woods' }, ack: seq });
    // One step on from where they were, counted from the Woods' corner: no jump.
    const at = woods.position('a')!;
    expect(at.x).toBeCloseTo(last.x + woods.map.width - PLAYER_SPEED * TICK_SECONDS, 5);
    expect(at.y).toBe(last.y);
    expect(watcher.messages.some((m) => m.t === 'system' && m.text === 'Mara set off for Whispering Woods.')).toBe(true);
    expect(world.places().find((p) => p.id === 'a')).toMatchObject({ regionId: 'woods' });
  });

  it('keeps a player at the same point along the edge when they cross off the road', () => {
    const world = new World();
    const home = world.home;
    const woods = world.region('woods')!;
    const entry = woods.map.entries.east!;
    // A row open on both sides of the Sanctum's west edge, away from the road.
    let y = 2;
    while (collides(home.map, 0.5, y) || collides(woods.map, entry.x, y) || Math.abs(y - entry.y) < 3) y++;
    world.join(info('a', 'Mara'), fakeConn(), { regionId: 'sanctum', x: 0.5, y }, newCharacter());
    for (let seq = 1; seq <= 10 && world.regionOf('a') === home; seq++) {
      world.handle('a', { t: 'input', seq, dx: -1, dy: 0 });
      world.tick();
    }
    expect(world.regionOf('a')).toBe(woods);
    const at = woods.position('a')!;
    expect(at.y).toBe(y);
    expect(at.x).toBeGreaterThan(woods.map.width - 1);
  });

  it('carries steps still waiting over the edge, so none is lost or applied twice', () => {
    const world = new World();
    const home = world.home;
    const west = home.map.entries.west!;
    world.join(info('a', 'Mara'), fakeConn(), { regionId: 'sanctum', x: 0.3, y: west.y }, newCharacter());
    // Six steps queued at once: the first crosses, the rest follow in the Woods.
    for (let seq = 1; seq <= 6; seq++) world.handle('a', { t: 'input', seq, dx: -1, dy: 0 });
    for (let i = 0; i < 4; i++) world.tick();
    const woods = world.region('woods')!;
    expect(world.regionOf('a')).toBe(woods);
    const steps = PLAYER_SPEED * TICK_SECONDS * 6;
    expect(woods.position('a')!.x).toBeCloseTo(0.3 + woods.map.width - steps, 5);
    world.handle('a', { t: 'input', seq: 3, dx: -1, dy: 0 });
    world.tick();
    expect(woods.position('a')!.x).toBeCloseTo(0.3 + woods.map.width - steps, 5);
  });

  it('counts everyone online and shares world chat across regions', () => {
    const world = new World();
    const a = fakeConn();
    const b = fakeConn();
    world.join(info('a', 'Mara'), a, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    world.join(info('b'), b, { regionId: 'desert', x: null, y: null }, newCharacter());
    world.handle('a', { t: 'chat', channel: 'world', text: 'hi all' });
    world.tick();
    expect(b.messages.some((m) => m.t === 'chat' && m.text === 'hi all')).toBe(true);
    expect(b.messages.filter((m) => m.t === 'snapshot').at(-1)).toMatchObject({ online: 2 });
  });

  it('leaves with the region and position to save', () => {
    const world = new World();
    world.join(info('a'), fakeConn(), { regionId: 'desert', x: null, y: null }, newCharacter());
    const place = world.leave('a');
    expect(place).toMatchObject({ regionId: 'desert' });
    expect(world.has('a')).toBe(false);
  });
});
