import { describe, expect, it } from 'vitest';
import { ITEM_USE_MS, creatureFromWish, itemCount, levelledCreature, maxHp, newCharacter, regionDef, xpToNext, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const notices = (c: { messages: ServerMessage[] }) => c.messages.flatMap((m) => (m.t === 'notice' ? [m.text] : []));

/** Mara with tonics and Bo hurt beside her, in the Sanctum. */
function twoPlayers() {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef('sanctum')!, undefined, () => clock.now, () => 0.5);
  const mara = fakeConn();
  const bo = fakeConn();
  const a = newCharacter();
  a.inventory.push({ item: 'tonic', qty: 5 });
  a.hp = 1;
  region.join(info('a', 'Mara'), mara, { x: 20.5, y: 20.5 }, a);
  const b = newCharacter();
  b.hp = 1;
  region.join(info('b', 'Bo'), bo, { x: 21.5, y: 20.5 }, b);
  return { region, clock, mara, bo };
}

describe('tonics', () => {
  it('may be used at most twice a second', () => {
    const { region, clock } = twoPlayers();
    region.handle('a', { t: 'use', item: 'tonic' });
    region.handle('a', { t: 'use', item: 'tonic' });
    expect(itemCount(region.character('a')!, 'tonic')).toBe(4);
    clock.now += ITEM_USE_MS;
    region.handle('a', { t: 'use', item: 'tonic' });
    expect(itemCount(region.character('a')!, 'tonic')).toBe(3);
  });

  it('can be given to another player close by, who is healed at once', () => {
    const { region, bo, mara } = twoPlayers();
    region.handle('a', { t: 'use', item: 'tonic', target: 'b' });
    expect(region.character('b')!.hp).toBe(Math.min(maxHp(region.character('b')!), 31));
    expect(region.character('a')!.hp).toBe(1);
    expect(itemCount(region.character('a')!, 'tonic')).toBe(4);
    expect(notices(mara)).toContain('You give Bo a Tonic.');
    expect(notices(bo)).toContain('Mara gives you a Tonic.');
  });

  it('cannot reach someone far away', () => {
    const { region, clock, mara } = twoPlayers();
    region.placePlayer('b', 40.5, 40.5);
    clock.now += ITEM_USE_MS;
    region.handle('a', { t: 'use', item: 'tonic', target: 'b' });
    expect(itemCount(region.character('a')!, 'tonic')).toBe(5);
    expect(notices(mara)).toContain('Step closer to them first.');
  });
});

describe('levels and monsters', () => {
  it('the XP for each level doubles every 5 levels on top of 20 × level^1.5', () => {
    expect(xpToNext(1)).toBe(20);
    expect(xpToNext(10)).toBeCloseTo(2200, -2);
    expect(xpToNext(20)).toBeCloseTo(25000, -3);
  });

  it('wished monsters follow the land formula', () => {
    const wished = creatureFromWish('w1', { kind: 'creature', name: 'Bog Imp', description: 'A small imp.', behavior: 'chase', level: 7, count: 1, look: { description: 'imp' } } as never);
    const land = levelledCreature({ name: 'x', art: 'x', description: 'x', behavior: 'chase', level: 7, speed: 2, notice: 4, drops: [] });
    expect({ hp: wished.hp, damage: wished.damage, xp: wished.xp, gold: wished.gold }).toEqual({ hp: land.hp, damage: land.damage, xp: land.xp, gold: land.gold });
  });
});
