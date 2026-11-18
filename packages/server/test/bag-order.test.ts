import { describe, expect, it } from 'vitest';
import { newCharacter, putItem, regionDef, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
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
  const region = new Region(regionDef('sanctum')!, undefined, () => 1_000_000, () => 0.5);
  const conn = fakeConn();
  const c = newCharacter();
  c.inventory = [];
  putItem(c, 'crab-shell', 6);
  putItem(c, 'wolf-pelt', 1);
  region.join(info('a'), conn, { x: null, y: null }, c);
  return { region, conn, bag: () => region.character('a')!.inventory.map((s) => `${s.item}:${s.qty}`) };
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
