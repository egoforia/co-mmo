import { describe, expect, it } from 'vitest';
import {
  BODY_SECONDS,
  CREATURES,
  QUESTS,
  itemCount,
  maxHp,
  newCharacter,
  regionDef,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { World } from '../src/world.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const of = <T extends ServerMessage['t']>(c: { messages: ServerMessage[] }, t: T) =>
  c.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);

/** A region with a controllable clock and dice that always roll the middle. */
function setup(id: string) {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef(id)!, undefined, () => clock.now, () => 0.5);
  return { region, clock };
}

describe('combat', () => {
  it('defeats a mushroom, earns XP and gold, and the mushroom comes back later', () => {
    const { region, clock } = setup('woods');
    const conn = fakeConn();
    region.join(info('a', 'Mara'), conn, { x: null, y: null }, newCharacter());
    const id = region.creatureIds().find((c) => c.includes('walking-mushroom'))!;
    const me = region.position('a')!;
    region.placeCreature(id, me.x + 1, me.y);
    let swings = 0;
    while (region.creature(id)!.alive && swings < 20) {
      region.handle('a', { t: 'attack' });
      clock.now += 1000;
      swings++;
    }
    expect(region.creature(id)!.alive).toBe(false);
    expect(of(conn, 'hit').at(-1)).toMatchObject({ target: id, defeated: true });
    const ch = region.character('a')!;
    expect(ch.xp).toBe(CREATURES['walking-mushroom']!.xp);
    expect(ch.discovered).toContain('walking-mushroom');
    expect(of(conn, 'character').length).toBeGreaterThan(0);

    clock.now += CREATURES['walking-mushroom']!.respawnSeconds * 1000;
    region.tick();
    expect(region.creature(id)!.alive).toBe(true);
  });

  it('a defeated creature leaves its body, which its finder searches with E before it fades', () => {
    const { region, clock } = setup('woods');
    const conn = fakeConn();
    region.join(info('a', 'Mara'), conn, { x: null, y: null }, newCharacter());
    const other = fakeConn();
    region.join(info('b', 'Ilya'), other, { x: null, y: null }, newCharacter());
    const id = region.creatureIds().find((c) => c.includes('walking-mushroom'))!;
    const me = region.position('a')!;
    region.placeCreature(id, me.x + 1, me.y);
    while (region.creature(id)!.alive) {
      region.handle('a', { t: 'attack' });
      clock.now += 1000;
    }
    // The dice roll the middle: the cap (60%) drops, the Tonic (25%) does not, and nothing goes straight to the bag.
    expect(itemCount(region.character('a')!, 'mushroom-cap')).toBe(0);
    const [body] = region.bodyList();
    expect(body).toMatchObject({ kind: 'walking-mushroom', finders: ['a'], loot: [{ item: 'mushroom-cap', qty: 1 }] });
    region.tick();
    const snap = of(conn, 'snapshot').at(-1)!;
    expect(snap.bodies).toEqual([expect.objectContaining({ id: body!.id, name: 'Walking Mushroom', loot: true })]);
    expect(of(other, 'snapshot').at(-1)!.bodies[0]).toMatchObject({ loot: false });

    // Someone who did not fight for it finds nothing.
    region.placePlayer('b', body!.x, body!.y + 0.5);
    region.handle('b', { t: 'interact' });
    expect(itemCount(region.character('b')!, 'mushroom-cap')).toBe(0);
    expect(of(other, 'notice').at(-1)!.text).toContain('Someone else defeated');

    region.placePlayer('a', body!.x + 0.5, body!.y);
    region.handle('a', { t: 'interact' });
    expect(itemCount(region.character('a')!, 'mushroom-cap')).toBe(1);
    expect(of(conn, 'notice').at(-1)!.text).toBe('You search the Walking Mushroom and find a Mushroom Cap.');
    region.handle('a', { t: 'interact' });
    expect(itemCount(region.character('a')!, 'mushroom-cap')).toBe(1);
    expect(of(conn, 'notice').at(-1)!.text).toContain('nothing more to find');

    // The body stays for five minutes, even after the mushroom comes back.
    clock.now += BODY_SECONDS * 1000 - 10_000;
    region.tick();
    expect(region.creature(id)!.alive).toBe(true);
    expect(region.bodyList()).toHaveLength(1);
    clock.now += 10_000;
    region.tick();
    expect(region.bodyList()).toHaveLength(0);
  });

  it('respects the attack cooldown', () => {
    const { region } = setup('woods');
    const conn = fakeConn();
    region.join(info('a'), conn, { x: null, y: null }, newCharacter());
    const id = region.creatureIds()[0]!;
    const me = region.position('a')!;
    region.placeCreature(id, me.x + 1, me.y);
    region.handle('a', { t: 'attack' });
    region.handle('a', { t: 'attack' });
    expect(of(conn, 'hit')).toHaveLength(1);
  });

  it('a mushroom hit back fights back; a crab knight attacks when you come close', () => {
    const { region, clock } = setup('woods');
    const conn = fakeConn();
    region.join(info('a'), conn, { x: null, y: null }, newCharacter());
    const id = region.creatureIds()[0]!;
    const me = region.position('a')!;
    region.placeCreature(id, me.x + 1, me.y);
    region.tick();
    expect(region.character('a')!.hp).toBe(maxHp(newCharacter()));
    region.handle('a', { t: 'attack' });
    clock.now += 2000;
    region.tick();
    expect(region.character('a')!.hp).toBeLessThan(maxHp(newCharacter()));

    const shore = setup('shore');
    shore.region.join(info('b'), fakeConn(), { x: null, y: null }, newCharacter());
    const crab = shore.region.creatureIds()[0]!;
    const b = shore.region.position('b')!;
    shore.region.placeCreature(crab, b.x + 1, b.y);
    shore.clock.now += 2000;
    shore.region.tick();
    expect(shore.region.character('b')!.hp).toBeLessThan(maxHp(newCharacter()));
  });

  it('a player who falls wakes at the Sanctum shrine, Weakened, with nothing lost', () => {
    let now = 5_000_000;
    const world = new World(() => now, () => 0.5);
    const conn = fakeConn();
    const ch = newCharacter();
    ch.hp = 1;
    ch.inventory.push({ item: 'tonic', qty: 3 });
    world.join(info('a', 'Mara'), conn, { regionId: 'desert', x: null, y: null }, ch);
    const desert = world.region('desert')!;
    const scarab = desert.creatureIds()[0]!;
    const me = desert.position('a')!;
    desert.placeCreature(scarab, me.x + 1, me.y);
    for (let i = 0; i < 5 && world.regionOf('a')!.def.id === 'desert'; i++) {
      now += 2000;
      world.tick();
    }
    expect(world.regionOf('a')!.def.id).toBe('sanctum');
    const after = world.regionOf('a')!.character('a')!;
    expect(after.hp).toBe(maxHp(after));
    expect(after.weakenedUntil).toBeGreaterThan(now);
    expect(itemCount(after, 'tonic')).toBe(3);
    expect(of(conn, 'notice').some((n) => n.text.includes('Weakened'))).toBe(true);
  });
});

describe('items', () => {
  it('a Tonic heals and is used up; the Bible cannot be used up', () => {
    const { region } = setup('sanctum');
    const ch = newCharacter();
    ch.hp = 5;
    ch.inventory.push({ item: 'tonic', qty: 1 });
    region.join(info('a'), fakeConn(), { x: null, y: null }, ch);
    region.handle('a', { t: 'use', item: 'tonic' });
    expect(region.character('a')!.hp).toBe(35);
    expect(itemCount(region.character('a')!, 'tonic')).toBe(0);
    region.handle('a', { t: 'use', item: 'bible' });
    expect(itemCount(region.character('a')!, 'bible')).toBe(1);
  });
});

describe('quests', () => {
  function talkTo(region: Region, conn: ReturnType<typeof fakeConn>, npcId: string) {
    const npc = region.map.npcs.find((n) => n.id === npcId)!;
    region.join(info('a', 'Mara'), conn, { x: npc.x, y: npc.y + 1 }, region.character('a') ?? newCharacter());
    region.handle('a', { t: 'interact' });
    return of(conn, 'dialogue').at(-1)!;
  }

  it('Sister Amala sends you to Old Bramble, who rewards you and offers the next quest', () => {
    let now = 0;
    const world = new World(() => now, () => 0.5);
    const conn = fakeConn();
    world.join(info('a', 'Mara'), conn, { regionId: 'sanctum', x: null, y: null }, newCharacter());
    const sanctum = world.region('sanctum')!;
    const amala = sanctum.map.npcs[0]!;
    sanctum.join(info('a', 'Mara'), conn, { x: amala.x, y: amala.y + 1 }, sanctum.character('a')!);
    sanctum.handle('a', { t: 'interact' });
    const offer = of(conn, 'dialogue').at(-1)!;
    expect(offer.offer?.quest).toBe('meet-bramble');
    sanctum.handle('a', { t: 'accept', quest: 'meet-bramble' });
    const ch = sanctum.character('a')!;
    expect(ch.quests).toEqual([{ id: 'meet-bramble', count: 0, done: false }]);

    const woods = world.region('woods')!;
    const left = sanctum.remove('a')!;
    const bramble = woods.map.npcs[0]!;
    woods.join(left.info, conn, { x: bramble.x, y: bramble.y + 1 }, left.character);
    woods.handle('a', { t: 'interact' });
    const reply = of(conn, 'dialogue').at(-1)!;
    expect(reply.text).toContain(QUESTS['meet-bramble']!.thanks);
    expect(reply.offer?.quest).toBe('mushroom-trouble');
    expect(left.character.quests[0]!.done).toBe(true);
    expect(itemCount(left.character, 'tonic')).toBe(2);
    expect(left.character.xp).toBe(15);
    now += 1;
  });

  it('a defeat quest counts kills and pays out when handed in', () => {
    const { region, clock } = setup('woods');
    const conn = fakeConn();
    const ch = newCharacter();
    ch.quests.push({ id: 'meet-bramble', count: 0, done: true });
    region.join(info('a', 'Mara'), conn, { x: null, y: null }, ch);
    let d = talkTo(region, conn, 'old-bramble');
    expect(d.offer?.quest).toBe('mushroom-trouble');
    region.handle('a', { t: 'accept', quest: 'mushroom-trouble' });
    const mushrooms = region.creatureIds();
    for (const id of mushrooms.slice(0, 4)) {
      const me = region.position('a')!;
      region.placeCreature(id, me.x + 1, me.y);
      while (region.creature(id)!.alive) {
        region.handle('a', { t: 'attack' });
        clock.now += 1000;
      }
    }
    expect(region.character('a')!.quests[1]).toMatchObject({ id: 'mushroom-trouble', count: 4, done: false });
    const gold = region.character('a')!.gold;
    d = talkTo(region, conn, 'old-bramble');
    expect(d.text).toContain(QUESTS['mushroom-trouble']!.thanks);
    expect(region.character('a')!.quests[1]!.done).toBe(true);
    expect(region.character('a')!.gold).toBe(gold + 15);
  });

  it('will not accept a quest from afar or out of order', () => {
    const { region } = setup('woods');
    region.join(info('a'), fakeConn(), { x: null, y: null }, newCharacter());
    region.handle('a', { t: 'accept', quest: 'mushroom-trouble' });
    region.handle('a', { t: 'accept', quest: 'crab-tolls' });
    expect(region.character('a')!.quests).toEqual([]);
  });
});
