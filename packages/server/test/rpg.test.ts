import { describe, expect, it } from 'vitest';
import {
  BODY_SECONDS,
  CREATURES,
  ITEMS,
  afterArmor,
  attackPower,
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

  it('a defeated creature leaves its body, whose loot anyone opens with E before it fades', () => {
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
    expect(of(conn, 'snapshot').at(-1)!.bodies).toEqual([expect.objectContaining({ id: body!.id, name: 'Walking Mushroom', loot: true })]);
    // Loot is shared: someone who did not fight for it sees it too.
    expect(of(other, 'snapshot').at(-1)!.bodies[0]).toMatchObject({ loot: true });

    // E opens the loot window; nothing moves to the bag until it is taken.
    region.placePlayer('b', body!.x, body!.y + 0.5);
    region.handle('b', { t: 'interact' });
    expect(of(other, 'loot').at(-1)!.loot).toEqual({ id: body!.id, name: 'Walking Mushroom', asset: 'woods-mushroom', items: [{ item: 'mushroom-cap', qty: 1 }] });
    expect(itemCount(region.character('b')!, 'mushroom-cap')).toBe(0);
    region.placePlayer('a', body!.x + 0.5, body!.y);
    region.handle('a', { t: 'interact' });
    expect(of(conn, 'loot').at(-1)!.loot!.items).toHaveLength(1);

    // Ilya takes the cap; Mara's open window empties and closes, and she hears who took it.
    region.handle('b', { t: 'loot', action: 'take', body: body!.id, index: 0, item: 'mushroom-cap' });
    expect(itemCount(region.character('b')!, 'mushroom-cap')).toBe(1);
    expect(of(other, 'notice').at(-1)!.text).toBe('You take a Mushroom Cap from the Walking Mushroom.');
    expect(of(conn, 'notice').at(-1)!.text).toBe('Ilya took a Mushroom Cap from the Walking Mushroom you defeated.');
    expect(of(conn, 'loot').at(-1)!.loot).toBeNull();
    expect(of(other, 'loot').at(-1)!.loot).toBeNull();
    // Too late: it is gone.
    region.handle('a', { t: 'loot', action: 'take', body: body!.id, index: 0, item: 'mushroom-cap' });
    expect(itemCount(region.character('a')!, 'mushroom-cap')).toBe(0);
    region.handle('a', { t: 'interact' });
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

  it('takes one thing at a time or everything, leaves the rest on the body, and closes when you walk away', () => {
    const { region, clock } = setup('woods');
    const conn = fakeConn();
    region.join(info('a', 'Mara'), conn, { x: null, y: null }, newCharacter());
    const saved = CREATURES['walking-mushroom']!.drops;
    // Three things, all sure to drop.
    CREATURES['walking-mushroom']!.drops = [{ item: 'mushroom-cap', chance: 1, qty: 2 }, { item: 'tonic', chance: 1 }, { item: 'goat-horn', chance: 1 }];
    try {
      const id = region.creatureIds().find((c) => c.includes('walking-mushroom'))!;
      const me = region.position('a')!;
      region.placeCreature(id, me.x + 1, me.y);
      while (region.creature(id)!.alive) {
        region.handle('a', { t: 'attack' });
        clock.now += 1000;
      }
      const [body] = region.bodyList();
      region.placePlayer('a', body!.x + 0.5, body!.y);
      region.handle('a', { t: 'interact' });
      expect(of(conn, 'loot').at(-1)!.loot!.items.map((s) => s.item)).toEqual(['mushroom-cap', 'tonic', 'goat-horn']);
      // A stale index still takes the thing that was chosen.
      region.handle('a', { t: 'loot', action: 'take', body: body!.id, index: 0, item: 'tonic' });
      expect(itemCount(region.character('a')!, 'tonic')).toBe(1);
      expect(of(conn, 'loot').at(-1)!.loot!.items.map((s) => s.item)).toEqual(['mushroom-cap', 'goat-horn']);
      // Closing leaves the rest where it lies.
      region.handle('a', { t: 'loot', action: 'close', body: body!.id });
      expect(region.bodyList()[0]!.loot.map((s) => s.item)).toEqual(['mushroom-cap', 'goat-horn']);
      region.handle('a', { t: 'interact' });
      // Walking away closes the window.
      const before = of(conn, 'loot').length;
      region.placePlayer('a', body!.x + 5, body!.y);
      region.tick();
      expect(of(conn, 'loot').length).toBe(before + 1);
      expect(of(conn, 'loot').at(-1)!.loot).toBeNull();
      region.handle('a', { t: 'loot', action: 'all', body: body!.id });
      expect(itemCount(region.character('a')!, 'goat-horn')).toBe(0);
      expect(of(conn, 'notice').at(-1)!.text).toMatch(/too far/);
      region.placePlayer('a', body!.x + 0.5, body!.y);
      region.handle('a', { t: 'loot', action: 'all', body: body!.id });
      expect(itemCount(region.character('a')!, 'mushroom-cap')).toBe(2);
      expect(itemCount(region.character('a')!, 'goat-horn')).toBe(1);
      expect(of(conn, 'notice').at(-1)!.text).toBe('You take 2 × Mushroom Cap, a Goat Horn from the Walking Mushroom.');
      expect(region.bodyList()[0]!.loot).toEqual([]);
    } finally {
      CREATURES['walking-mushroom']!.drops = saved;
    }
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

  it('weapons reach as far as their family: a bow fires across the glade, an arcane wand meets Ward instead of Armor', () => {
    ITEMS['test-bow'] = { name: 'Test Bow', kind: 'equipment', art: 'x', description: '', slot: 'weapon', weapon: 'bow' };
    ITEMS['test-wand'] = { name: 'Test Wand', kind: 'equipment', art: 'x', description: '', slot: 'weapon', weapon: 'wand' };
    try {
      const { region, clock } = setup('woods');
      const conn = fakeConn();
      const c = newCharacter();
      region.join(info('a'), conn, { x: null, y: null }, c);
      const id = region.creatureIds().find((k) => k.includes('walking-mushroom'))!;
      const me = region.position('a')!;
      region.placeCreature(id, me.x + 4, me.y);
      // Bare hands do not reach four steps.
      region.handle('a', { t: 'attack' });
      expect(of(conn, 'hit')).toHaveLength(0);
      const ch = region.character('a')!;
      ch.equipment.weapon = 'test-bow';
      clock.now += 2000;
      region.handle('a', { t: 'attack' });
      const shot = of(conn, 'hit')[0]!;
      // The mushroom's Armor of 1 softens the physical arrow.
      expect(shot).toMatchObject({ target: id, ranged: true, damage: 'physical', amount: afterArmor(attackPower(ch), CREATURES['walking-mushroom']!.armor!) });
      ch.equipment.weapon = 'test-wand';
      clock.now += 2000;
      region.handle('a', { t: 'attack' });
      // It has no Ward, so the arcane bolt lands whole.
      expect(of(conn, 'hit')[1]).toMatchObject({ ranged: true, damage: 'arcane', amount: attackPower(ch) });
    } finally {
      delete ITEMS['test-bow'];
      delete ITEMS['test-wand'];
    }
  });

  it('a greatsword swing hits the two nearest creatures in reach', () => {
    ITEMS['test-greatsword'] = { name: 'Test Greatsword', kind: 'equipment', art: 'x', description: '', slot: 'weapon', weapon: 'greatsword' };
    try {
      const { region } = setup('woods');
      const conn = fakeConn();
      const c = newCharacter();
      c.equipment.weapon = 'test-greatsword';
      region.join(info('a'), conn, { x: null, y: null }, c);
      const me = region.position('a')!;
      const [one, two, three] = region.creatureIds();
      region.placeCreature(one!, me.x + 1, me.y);
      region.placeCreature(two!, me.x, me.y + 1.5);
      region.placeCreature(three!, me.x + 5, me.y);
      region.handle('a', { t: 'attack' });
      expect(of(conn, 'hit').map((h) => h.target).sort()).toEqual([one, two].sort());
    } finally {
      delete ITEMS['test-greatsword'];
    }
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

  it('a player who falls wakes at the Sanctum shrine, Weakened, with nothing lost, once no friend raises them', () => {
    let now = 5_000_000;
    const world = new World(() => now, () => 0.5);
    const conn = fakeConn();
    const ch = newCharacter();
    ch.hp = 1;
    ch.inventory.push({ item: 'tonic', qty: 3 });
    world.join(info('a', 'Mara'), conn, { regionId: 'desert', x: null, y: null }, ch);
    const desert = world.local('desert')!;
    const scarab = desert.creatureIds()[0]!;
    const me = desert.position('a')!;
    desert.placeCreature(scarab, me.x + 1, me.y);
    // Fallen first, for up to 10 s, then the shrine.
    for (let i = 0; i < 12 && world.regionOf('a')!.def.id === 'desert'; i++) {
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
    const sanctum = world.local('sanctum')!;
    const amala = sanctum.map.npcs[0]!;
    sanctum.join(info('a', 'Mara'), conn, { x: amala.x, y: amala.y + 1 }, sanctum.character('a')!);
    sanctum.handle('a', { t: 'interact' });
    const offer = of(conn, 'dialogue').at(-1)!;
    expect(offer.offer?.quest).toBe('meet-bramble');
    sanctum.handle('a', { t: 'accept', quest: 'meet-bramble' });
    const ch = sanctum.character('a')!;
    expect(ch.quests).toEqual([{ id: 'meet-bramble', count: 0, done: false }]);

    const woods = world.local('woods')!;
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
