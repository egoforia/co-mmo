import { afterEach, describe, expect, it } from 'vitest';
import { ITEMS, Tile, combatRules, newCharacter, regionDef, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { account, api, start } from './helpers.ts';

// Reach and sight on tiles (docs/combat.md, Rules): blows reach the touching
// tile the player faces, long blades a second tile straight ahead, shots as far as
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
  // Tests fight beside the arrival square: no safe areas here (safe-areas.ts has its own tests).
  region.map.safe = [];
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
  const face = (dx: number, dy: number) => region.facePlayer('a', dx, dy);
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
  const tick = () => {
    clock.now += 50;
    region.tick();
  };
  return { region, conn, tx, ty, ids, put, face, attack, shoot, tick, map };
}

afterEach(() => {
  delete ITEMS['test-bow'];
  delete ITEMS['test-spear'];
});

describe('reach on tiles', () => {
  it('bare hands reach a corner tile but not two tiles off', () => {
    const t = setup();
    t.put(t.ids[0]!, 1, 1);
    t.face(1, 1);
    expect(t.attack()).toBe(1);
    t.put(t.ids[0]!, 2, 0);
    t.face(1, 0);
    expect(t.attack()).toBe(1);
  });

  it('a blow lands only on the tile the player faces', () => {
    const t = setup();
    const [ahead, beside] = t.ids;
    t.put(ahead!, 0, 1);
    t.put(beside!, 1, 0);
    // Facing south: the one to the east is in reach but not struck.
    t.face(0, 1);
    expect(t.shoot()).toEqual([ahead]);
    // Asking for the one beside does not turn them: nothing is struck.
    expect(t.shoot(beside)).toEqual([ahead]);
    t.put(ahead!, 40, 40);
    expect(t.shoot(beside)).toEqual([]);
    t.face(1, 0);
    expect(t.shoot(beside)).toEqual([beside]);
  });

  it('a turn pressed just before a blow counts for it', () => {
    const t = setup();
    t.put(t.ids[0]!, 0, 1);
    t.face(1, 0);
    // Pressing towards the creature (a taken tile turns, no step), then Space at once.
    t.region.handle('a', { t: 'input', seq: 1, dx: 0, dy: 1 });
    t.region.handle('a', { t: 'attack' });
    expect(hits(t.conn).length).toBe(0);
    t.tick();
    expect(hits(t.conn).filter((h) => (h as { by: string }).by === 'a').map((h) => (h as { target: string }).target)).toEqual([t.ids[0]]);
    expect(t.region.position('a')!.y).toBe(t.ty + 0.5);
  });

  it('a step under way keeps the player facing its way, and they turn once it is done', () => {
    const t = setup();
    const facing = () => (t.region as unknown as { s: { players: Map<string, { facing?: { dx: number; dy: number } }> } }).s.players.get('a')!.facing;
    let seq = 0;
    t.region.handle('a', { t: 'input', seq: ++seq, dx: 1, dy: 0 });
    t.tick();
    expect(facing()).toEqual({ dx: 1, dy: 0 });
    // Halfway there, pressing south: still facing east.
    t.region.handle('a', { t: 'input', seq: ++seq, dx: 0, dy: 1 });
    t.tick();
    expect(facing()).toEqual({ dx: 1, dy: 0 });
    // Held on, the step ends and the next begins south: now facing south.
    for (let i = 0; i < 10 && facing()!.dy === 0; i++) {
      t.region.handle('a', { t: 'input', seq: ++seq, dx: 0, dy: 1 });
      t.tick();
    }
    expect(facing()).toEqual({ dx: 0, dy: 1 });
    expect(t.region.position('a')!.x).toBe(t.tx + 1.5);
  });

  it('a spear reaches a second tile straight ahead, not a crooked one', () => {
    ITEMS['test-spear'] = { name: 'Test Spear', kind: 'equipment', art: 'x', description: '', slot: 'weapon', weapon: 'spear' };
    const t = setup('test-spear');
    t.put(t.ids[0]!, 2, 1);
    expect(t.attack()).toBe(0);
    t.face(1, 0);
    t.put(t.ids[0]!, 2, 2);
    // Straight, but not the way they face.
    expect(t.attack()).toBe(0);
    t.face(1, 1);
    expect(t.attack()).toBe(1);
    t.put(t.ids[0]!, 0, -2);
    t.face(0, -1);
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

  it('a creature flanked by two players takes more from each blow', () => {
    const t = setup();
    // Strong enough that rounding hides nothing, and a fresh creature each time.
    t.region.character('a')!.level = 100;
    const [one, two] = t.ids;
    t.put(one!, 1, 0);
    t.attack();
    const plain = (hits(t.conn).at(-1) as { amount: number }).amount;
    t.put(one!, 40, 40);
    t.put(two!, 1, 0);
    t.region.join(info('b'), fakeConn(), { x: null, y: null }, newCharacter());
    t.region.placePlayer('b', t.tx + 2.5, t.ty + 0.5);
    t.attack();
    const flanked = (hits(t.conn).at(-1) as { amount: number }).amount;
    expect(flanked / plain).toBeGreaterThan(1.13);
    expect(flanked / plain).toBeLessThan(1.17);
  });

  it('stepping away from a creature fighting you gives it a free swing', () => {
    const t = setup();
    const id = t.ids[0]!;
    t.put(id, 1, 0);
    // Strike it, so it fights back.
    t.attack();
    const swings = () => t.conn.messages.filter((m) => m.t === 'notice' && /as you turn away/.test((m as { text: string }).text)).length;
    // A step along its side keeps beside it: no swing.
    t.region.handle('a', { t: 'input', seq: 1, dx: 0, dy: 1 });
    t.tick();
    expect(swings()).toBe(0);
    for (let i = 0; i < 20; i++) {
      t.region.handle('a', { t: 'input', seq: 2 + i, dx: -1, dy: 0 });
      t.tick();
    }
    expect(swings()).toBe(1);
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
