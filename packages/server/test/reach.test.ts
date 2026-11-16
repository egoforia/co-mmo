import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS, Tile, combatRules, newCharacter, regionDef, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { account, api, start } from './helpers.ts';

// Reach and sight on tiles (docs/combat.md, Rules): blows reach the eight
// touching tiles, long blades a second tile straight ahead, shots as far as
// they say along a clear line, and bodies block shots when the Owner says so.

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}
const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });
const hits = (c: { messages: ServerMessage[] }) => c.messages.filter((m) => m.t === 'hit');

/** A player at a tile's middle in the woods with open ground about them, one creature out of the way, and a clock. */
function setup(weapon?: string) {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef('woods')!, undefined, () => clock.now, () => 0.5);
  const conn = fakeConn();
  const ch = newCharacter();
  if (weapon) ch.equipment.weapon = weapon;
  region.join(info('a'), conn, { x: null, y: null }, ch);
  const me = region.position('a')!;
  const tx = Math.floor(me.x);
  const ty = Math.floor(me.y);
  region.placePlayer('a', tx + 0.5, ty + 0.5);
  // Open ground for eight tiles about them, so only what a test puts there is in the way.
  const map = region.map;
  for (let y = ty - 8; y <= ty + 8; y++) for (let x = tx - 8; x <= tx + 8; x++) map.tiles[y * map.width + x] = Tile.Ground;
  const ids = region.creatureIds();
  for (const id of ids) region.placeCreature(id, tx + 40, ty + 40);
  const put = (id: string, dx: number, dy: number) => region.placeCreature(id, tx + dx + 0.5, ty + dy + 0.5);
  const attack = () => {
    clock.now += 3000;
    region.handle('a', { t: 'attack' });
    return hits(conn).length;
  };
  /** Fires at a creature (the nearest in reach when that one is not) and says which were hit. */
  const shoot = (target?: string) => {
    const before = hits(conn).length;
    clock.now += 3000;
    region.handle('a', { t: 'attack', ...(target ? { target } : {}) });
    return hits(conn).slice(before).map((h) => (h as { target: string }).target);
  };
  return { region, conn, tx, ty, ids, put, attack, shoot, map };
}

afterEach(() => {
  delete ITEMS['test-bow'];
  delete ITEMS['test-spear'];
});

describe('reach on tiles', () => {
  it('bare hands reach a corner tile but not two tiles off', () => {
    const t = setup();
    t.put(t.ids[0]!, 1, 1);
    expect(t.attack()).toBe(1);
    t.put(t.ids[0]!, 2, 0);
    expect(t.attack()).toBe(1);
  });

  it('a spear reaches a second tile straight ahead, not a crooked one', () => {
    ITEMS['test-spear'] = { name: 'Test Spear', kind: 'equipment', art: 'x', description: '', slot: 'weapon', weapon: 'spear' };
    const t = setup('test-spear');
    t.put(t.ids[0]!, 2, 1);
    expect(t.attack()).toBe(0);
    t.put(t.ids[0]!, 2, 2);
    expect(t.attack()).toBe(1);
    t.put(t.ids[0]!, 0, -2);
    expect(t.attack()).toBe(2);
  });

  it('a bow needs a clear line: a tree stops it, water does not', () => {
    ITEMS['test-bow'] = { name: 'Test Bow', kind: 'equipment', art: 'x', description: '', slot: 'weapon', weapon: 'bow' };
    const t = setup('test-bow');
    t.put(t.ids[0]!, 5, 0);
    t.map.tiles[t.ty * t.map.width + t.tx + 2] = Tile.Tree;
    expect(t.attack()).toBe(0);
    t.map.tiles[t.ty * t.map.width + t.tx + 2] = Tile.Water;
    expect(t.attack()).toBe(1);
    // Six tiles is as far as a bow goes.
    t.put(t.ids[0]!, 7, 0);
    expect(t.attack()).toBe(1);
  });

  it('bodies block shots only when the Owner says so', () => {
    ITEMS['test-bow'] = { name: 'Test Bow', kind: 'equipment', art: 'x', description: '', slot: 'weapon', weapon: 'bow' };
    const t = setup('test-bow');
    const [far, near] = t.ids;
    t.put(far!, 5, 0);
    t.put(near!, 2, 0);
    // Off (as always before): the arrow flies over the near one to the far one.
    expect(t.shoot(far)).toEqual([far]);
    t.region.combatRules = combatRules({ bodiesBlockShots: true });
    // On: the near one stands in the way, so the shot goes to the one it can reach.
    expect(t.shoot(far)).toEqual([near]);
  });

  it("only the Owner sets the Combat page's rules, and they are kept", async () => {
    const { store, base } = await start();
    const owner = account(store, 'egoforia', 'owner');
    const steward = account(store, 'Mara', 'steward');
    expect((await api(base, '/api/admin/combat', steward.token)).status).toBe(403);
    expect((await api(base, '/api/admin/combat', owner.token)).body.rules).toEqual({ bodiesBlockShots: false });
    expect((await api(base, '/api/admin/combat', owner.token, 'PUT', { bodiesBlockShots: true })).status).toBe(200);
    expect(store.settings.combat).toEqual({ bodiesBlockShots: true });
    expect((await api(base, '/api/admin/combat', owner.token)).body.rules).toEqual({ bodiesBlockShots: true });
  });
});
