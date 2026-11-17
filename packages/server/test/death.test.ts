import { describe, expect, it } from 'vitest';
import { GOLD, PLAYER_BODY_MS, deathXp, goldOf, newCharacter, setGold, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import type { Connection } from '../src/region.ts';
import type { SavedBody } from '../src/region/state.ts';
import { World } from '../src/world.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const notices = (c: { messages: ServerMessage[] }) => c.messages.flatMap((m) => (m.t === 'notice' ? [m.text] : []));

/** Mara, level 3 with 40 gold and a sword worn, falls to a scarab in the desert; the dice roll `dice.v`. */
function fall() {
  const clock = { now: 5_000_000 };
  const dice = { v: 0.5 };
  const world = new World(() => clock.now, () => dice.v);
  // Tests fight beside the arrival square: no safe areas here (safe-areas.ts has its own tests).
  for (const r of world.units()) r.map.safe = [];
  const saved = new Map<string, SavedBody>();
  world.onPlayerBody = (b, gone) => (gone ? saved.delete(b.id) : saved.set(b.id, b));
  const conn = fakeConn();
  const ch = newCharacter();
  ch.level = 3;
  ch.xp = 5;
  ch.hp = 1;
  setGold(ch, 40);
  ch.equipment.weapon = 'wooden-sword';
  ch.inventory.push({ item: 'tonic', qty: 2 });
  world.join(info('a', 'Mara'), conn, { regionId: 'desert', x: null, y: null }, ch);
  const desert = world.local('desert')!;
  const scarab = desert.creatureIds()[0]!;
  const me = desert.position('a')!;
  desert.placeCreature(scarab, me.x + 1, me.y);
  for (let i = 0; i < 5 && !desert.isFallen('a'); i++) {
    clock.now += 2000;
    world.tick();
  }
  const wake = () => {
    world.handle('a', { t: 'wake' });
    clock.now += 100;
    world.tick();
  };
  return { world, desert, conn, clock, dice, saved, wake, at: me };
}

describe('death', () => {
  it('costs XP, a level when there is not enough, and all the gold, which lies on the body', () => {
    const { world, desert, conn, saved, wake, clock } = fall();
    expect(desert.isFallen('a')).toBe(true);
    wake();
    const after = world.regionOf('a')!.character('a')!;
    expect(after.level).toBe(2);
    expect(after.xp).toBeGreaterThanOrEqual(0);
    expect(goldOf(after)).toBe(0);
    // The dice rolled high: the sword and the bag stay.
    expect(after.equipment.weapon).toBe('wooden-sword');
    expect(after.inventory.some((s) => s.item === 'tonic')).toBe(true);
    const body = desert.allBodies().find((b) => b.id.startsWith('pb-a-'))!;
    expect(body.loot).toEqual([{ item: GOLD, qty: 40 }]);
    expect(body.until - clock.now).toBeGreaterThan(PLAYER_BODY_MS - 1000);
    expect([...saved.values()][0]).toMatchObject({ region: 'desert', owner: { id: 'a', name: 'Mara' }, loot: [{ item: GOLD, qty: 40 }] });
    expect(notices(conn).some((t) => t.startsWith(`You lost ${deathXp(3)} XP and a level.`))).toBe(true);
  });

  it('now and then drops worn gear, unbound, and the whole bag', () => {
    const { world, desert, dice, wake } = fall();
    dice.v = 0.1;
    wake();
    const after = world.regionOf('a')!.character('a')!;
    expect(after.equipment.weapon).toBeUndefined();
    // The Bible never leaves its owner.
    expect(after.inventory.map((s) => s.item)).toEqual(['bible']);
    const loot = desert.allBodies().find((b) => b.id.startsWith('pb-a-'))!.loot.map((s) => s.item);
    expect(loot).toEqual(expect.arrayContaining([GOLD, 'wooden-sword', 'tonic']));
  });

  it('lets anyone take from the body, tells its owner, and fades when empty or after an hour', () => {
    const { world, desert, saved, wake, clock, at } = fall();
    wake();
    const bo = fakeConn();
    world.join(info('b', 'Bo'), bo, { regionId: 'desert', x: at.x, y: at.y }, newCharacter());
    const body = desert.allBodies().find((b) => b.id.startsWith('pb-a-'))!;
    const mara = fakeConn();
    world.join(info('a', 'Mara'), mara, { regionId: 'sanctum', x: null, y: null }, world.regionOf('a')!.character('a')!);
    world.handle('b', { t: 'loot', body: body.id, action: 'all' });
    expect(goldOf(desert.character('b')!)).toBe(40);
    expect(notices(mara)).toContain('Bo took 40 gold from your body.');
    clock.now += 100;
    world.tick();
    expect(desert.allBodies().some((b) => b.id === body.id)).toBe(false);
    expect(saved.size).toBe(0);
  });

  it('keeps a body through a restart until its hour is up', () => {
    const { saved, wake } = fall();
    wake();
    const body = [...saved.values()][0]!;
    const clock = { now: body.until - 1000 };
    const again = new World(() => clock.now, () => 0.5);
    // Tests fight beside the arrival square: no safe areas here (safe-areas.ts has its own tests).
    for (const r of again.units()) r.map.safe = [];
    again.restoreBodies([body]);
    expect(again.local('desert')!.allBodies().map((b) => b.id)).toContain(body.id);
    const late = new World(() => body.until + 1, () => 0.5);
    // Tests fight beside the arrival square: no safe areas here (safe-areas.ts has its own tests).
    for (const r of late.units()) r.map.safe = [];
    late.restoreBodies([body]);
    expect(late.local('desert')!.allBodies().map((b) => b.id)).not.toContain(body.id);
  });
});
