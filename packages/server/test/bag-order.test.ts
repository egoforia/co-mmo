import { describe, expect, it } from 'vitest';
import { PILE_KIND, PILE_MS, goldOf, itemCount, newCharacter, putItem, regionDef, setGold, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';

// The server arranges the bag on a `bag` message, and says why when it can't.

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });
const notices = (c: { messages: ServerMessage[] }) => c.messages.flatMap((m) => (m.t === 'notice' ? [m.text] : []));

function joined() {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef('sanctum')!, undefined, () => clock.now, () => 0.5);
  const conn = fakeConn();
  const c = newCharacter();
  c.inventory = [];
  putItem(c, 'crab-shell', 6);
  putItem(c, 'wolf-pelt', 1);
  region.join(info('a'), conn, { x: null, y: null }, c);
  return { region, conn, clock, bag: () => region.character('a')!.inventory.map((s) => `${s.item}:${s.qty}`) };
}

describe('arranging the bag on the server', () => {
  it('moves, splits, merges and sorts, and sends the new bag', () => {
    const { region, conn, bag } = joined();
    region.handle('a', { t: 'bag', action: 'move', from: 0, to: 1 });
    expect(bag()).toEqual(['wolf-pelt:1', 'crab-shell:6']);
    region.handle('a', { t: 'bag', action: 'split', from: 1, qty: 2 });
    expect(bag()).toEqual(['wolf-pelt:1', 'crab-shell:4', 'crab-shell:2']);
    region.handle('a', { t: 'bag', action: 'sort' });
    expect(bag()).toEqual(['crab-shell:6', 'wolf-pelt:1']);
    const sent = conn.messages.filter((m) => m.t === 'character').at(-1);
    expect(sent && sent.t === 'character' && sent.character.inventory.map((s) => s.item)).toEqual(['crab-shell', 'wolf-pelt']);
  });

  it('says why when a split cannot be made', () => {
    const { region, conn, bag } = joined();
    region.handle('a', { t: 'bag', action: 'split', from: 1, qty: 1 });
    expect(notices(conn).at(-1)).toMatch(/fewer than the stack holds/);
    expect(bag()).toEqual(['crab-shell:6', 'wolf-pelt:1']);
  });
});

describe('dropping things on the ground', () => {
  it('leaves a pile anyone may take, that joins later drops and fades after ten minutes', () => {
    const { region, conn, clock, bag } = joined();
    region.placePlayer('a', 10, 10);
    region.handle('a', { t: 'bag', action: 'drop', from: 0, qty: 2 });
    expect(bag()).toEqual(['crab-shell:4', 'wolf-pelt:1']);
    expect(notices(conn).at(-1)).toMatch(/Anyone may take it for ten minutes/);
    region.handle('a', { t: 'bag', action: 'drop', from: 1 });
    const piles = region.state.bodies.filter((b) => b.kind === PILE_KIND);
    expect(piles).toHaveLength(1);
    expect(piles[0]!.loot).toEqual([{ item: 'crab-shell', qty: 2 }, { item: 'wolf-pelt', qty: 1 }]);
    expect(piles[0]!.def.name).toBe('Pile of things');

    // Someone else picks some of it up.
    const other = fakeConn();
    const b = newCharacter();
    region.join(info('b'), other, { x: null, y: null }, b);
    region.placePlayer('b', 10.3, 10);
    region.handle('b', { t: 'loot', action: 'take', body: piles[0]!.id, index: 1, item: 'wolf-pelt' });
    expect(itemCount(region.character('b')!, 'wolf-pelt')).toBe(1);

    clock.now += PILE_MS + 1000;
    region.tick();
    expect(region.state.bodies.some((x) => x.kind === PILE_KIND)).toBe(false);
  });

  it('drops coins like anything else, but never the Bible', () => {
    const { region, conn } = joined();
    const c = region.character('a')!;
    setGold(c, 40);
    putItem(c, 'bible');
    region.handle('a', { t: 'bag', action: 'drop', from: c.inventory.findIndex((s) => s.item === 'gold'), qty: 15 });
    expect(goldOf(c)).toBe(25);
    expect(region.state.bodies.find((x) => x.kind === PILE_KIND)?.loot).toEqual([{ item: 'gold', qty: 15 }]);
    region.handle('a', { t: 'bag', action: 'drop', from: c.inventory.findIndex((s) => s.item === 'bible') });
    expect(notices(conn).at(-1)).toMatch(/cannot be dropped/);
    expect(itemCount(c, 'bible')).toBe(1);
  });
});
