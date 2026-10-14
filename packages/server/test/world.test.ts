import { describe, expect, it } from 'vitest';
import { newCharacter, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
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
    for (let seq = 1; seq <= 40; seq++) {
      world.handle('a', { t: 'input', seq, dx: -1, dy: 0 });
      world.tick();
      if (world.regionOf('a')!.def.id !== 'sanctum') break;
    }
    const woods = world.regionOf('a')!;
    expect(woods.def.id).toBe('woods');
    expect(a.messages.filter((m) => m.t === 'welcome').at(-1)).toMatchObject({ region: { id: 'woods' } });
    expect(woods.position('a')).toEqual(woods.map.entries.east);
    expect(watcher.messages.some((m) => m.t === 'system' && m.text === 'Mara set off for Whispering Woods.')).toBe(true);
    expect(world.places().find((p) => p.id === 'a')).toMatchObject({ regionId: 'woods' });
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
