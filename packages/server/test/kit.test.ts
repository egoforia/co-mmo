import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CREATOR_LEVEL_FAVOR,
  CREATOR_XP,
  ITEMS,
  addItem,
  itemCount,
  newCharacter,
  regionDef,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { Store } from '../src/store.ts';
import { account, app, joined, start, wish } from './helpers.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const of = <T extends ServerMessage['t']>(c: { messages: ServerMessage[] }, t: T) =>
  c.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
const notices = (c: { messages: ServerMessage[] }) => of(c, 'notice').map((m) => m.text);

function setup(id: string) {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef(id)!, undefined, () => clock.now, () => 0.5);
  return { region, clock };
}

/** Stands a player right beside an NPC. */
function besideNpc(region: Region, player: string, npc: string): void {
  const n = region.npc(npc)!;
  region.placePlayer(player, n.x + 0.5, n.y);
}

describe('shops and trainers', () => {
  it('Marina sells and buys, but only while you stand with her', () => {
    const { region } = setup('shore');
    const conn = fakeConn();
    const c = newCharacter();
    c.gold = 30;
    addItem(c, 'crab-shell', 4);
    region.join(info('a', 'Mara'), conn, { x: null, y: null }, c);
    region.placePlayer('a', 10, 10);
    region.handle('a', { t: 'shop', action: 'buy', npc: 'marina', id: 'wooden-sword' });
    expect(notices(conn).at(-1)).toMatch(/Walk up to Marina/);

    besideNpc(region, 'a', 'marina');
    region.handle('a', { t: 'interact' });
    expect(of(conn, 'dialogue').at(-1)).toMatchObject({ shop: true });
    region.handle('a', { t: 'shop', action: 'buy', npc: 'marina', id: 'wooden-sword' });
    region.handle('a', { t: 'shop', action: 'sell', npc: 'marina', id: 'crab-shell', qty: 4 });
    const ch = region.character('a')!;
    expect(itemCount(ch, 'wooden-sword')).toBe(1);
    expect(itemCount(ch, 'crab-shell')).toBe(0);
    expect(ch.gold).toBe(30 - 15 + 4 * 2);
    expect(of(conn, 'character').at(-1)!.character.gold).toBe(ch.gold);
  });

  it('Sister Amala teaches Mend, which heals for Energy and then rests', () => {
    const { region, clock } = setup('sanctum');
    const conn = fakeConn();
    const c = newCharacter();
    c.gold = 15;
    region.join(info('a', 'Mara'), conn, { x: null, y: null }, c);
    besideNpc(region, 'a', 'sister-amala');
    region.handle('a', { t: 'shop', action: 'learn', npc: 'sister-amala', id: 'mend' });
    const ch = region.character('a')!;
    expect(ch.abilities).toEqual(['mend']);
    ch.hp = 5;
    const energy = ch.energy;
    region.handle('a', { t: 'ability', ability: 'mend' });
    expect(ch.hp).toBeGreaterThan(5);
    expect(ch.energy).toBe(energy - ABILITIES.mend!.energy);
    expect(of(conn, 'cooldown').at(-1)).toMatchObject({ ability: 'mend', seconds: ABILITIES.mend!.cooldown });
    const healed = ch.hp;
    ch.hp = 5;
    region.handle('a', { t: 'ability', ability: 'mend' });
    expect(ch.hp).toBe(5);
    clock.now += ABILITIES.mend!.cooldown * 1000;
    region.handle('a', { t: 'ability', ability: 'mend' });
    expect(ch.hp).toBe(healed);
  });
});

describe('abilities and gear in combat', () => {
  it('Firebolt hits a creature five steps away and needs Energy', () => {
    const { region, clock } = setup('woods');
    const conn = fakeConn();
    const c = newCharacter();
    c.abilities.push('firebolt');
    region.join(info('a'), conn, { x: null, y: null }, c);
    const id = region.creatureIds().find((k) => k.includes('walking-mushroom'))!;
    const me = region.position('a')!;
    region.placeCreature(id, me.x + 4, me.y);
    const hp = region.creature(id)!.hp;
    region.handle('a', { t: 'ability', ability: 'firebolt' });
    expect(region.creature(id)!.hp).toBeLessThan(hp);
    expect(of(conn, 'hit').at(-1)).toMatchObject({ target: id, ability: 'firebolt' });
    region.character('a')!.energy = 0;
    clock.now += ABILITIES.firebolt!.cooldown * 1000;
    region.handle('a', { t: 'ability', ability: 'firebolt' });
    expect(notices(conn).at(-1)).toMatch(/Not enough Energy/);
  });

  it('an ability you have not learned does nothing', () => {
    const { region } = setup('woods');
    const conn = fakeConn();
    region.join(info('a'), conn, { x: null, y: null }, newCharacter());
    region.handle('a', { t: 'ability', ability: 'firebolt' });
    expect(of(conn, 'hit')).toHaveLength(0);
  });

  it('armour softens creature blows', () => {
    const hits = (gear: boolean) => {
      const { region, clock } = setup('desert');
      const conn = fakeConn();
      const c = newCharacter();
      if (gear) {
        addItem(c, 'shell-mail');
        region.join(info('a'), conn, { x: null, y: null }, c);
        region.handle('a', { t: 'equip', item: 'shell-mail' });
      } else {
        region.join(info('a'), conn, { x: null, y: null }, c);
      }
      const id = region.creatureIds().find((k) => k.includes('sun-scarab'))!;
      const me = region.position('a')!;
      region.placeCreature(id, me.x + 1, me.y);
      for (let i = 0; i < 40 && !of(conn, 'hit').some((h) => h.target === 'a'); i++) {
        region.tick();
        clock.now += 100;
      }
      return of(conn, 'hit').find((h) => h.target === 'a')!.amount;
    };
    expect(hits(true)).toBeLessThan(hits(false));
  });
});

describe('crafting on the server', () => {
  it('makes a Tonic from mushroom caps', () => {
    const { region } = setup('woods');
    const conn = fakeConn();
    const c = newCharacter();
    addItem(c, 'mushroom-cap', 2);
    region.join(info('a'), conn, { x: null, y: null }, c);
    region.handle('a', { t: 'craft', recipe: 'tonic' });
    expect(itemCount(region.character('a')!, 'tonic')).toBe(1);
    expect(notices(conn).at(-1)).toMatch(/You made a Tonic/);
  });
});

describe('trading between players', () => {
  function two() {
    const { region } = setup('sanctum');
    const a = fakeConn();
    const b = fakeConn();
    const ca = newCharacter();
    addItem(ca, 'crab-shell', 3);
    const cb = newCharacter();
    cb.gold = 20;
    region.join(info('a', 'Mara'), a, { x: null, y: null }, ca);
    region.join(info('b', 'Ilya'), b, { x: null, y: null }, cb);
    return { region, a, b };
  }

  it('swaps only when both agree to what is on the table', () => {
    const { region, a, b } = two();
    region.handle('a', { t: 'trade', action: 'request', name: 'ilya' });
    expect(of(b, 'trade-request').at(-1)).toMatchObject({ from: { id: 'a', name: 'Mara' } });
    region.handle('b', { t: 'trade', action: 'accept' });
    expect(of(a, 'trade').at(-1)!.trade).toMatchObject({ with: { name: 'Ilya' } });
    region.handle('a', { t: 'trade', action: 'offer', offer: { items: [{ item: 'crab-shell', qty: 3 }], gold: 0 } });
    region.handle('b', { t: 'trade', action: 'offer', offer: { items: [], gold: 12 } });
    region.handle('a', { t: 'trade', action: 'confirm' });
    // A change after agreeing clears both agreements.
    region.handle('b', { t: 'trade', action: 'offer', offer: { items: [], gold: 10 } });
    expect(of(a, 'trade').at(-1)!.trade).toMatchObject({ myConfirm: false, theirConfirm: false });
    region.handle('b', { t: 'trade', action: 'confirm' });
    expect(itemCount(region.character('b')!, 'crab-shell')).toBe(0);
    region.handle('a', { t: 'trade', action: 'confirm' });
    expect(itemCount(region.character('b')!, 'crab-shell')).toBe(3);
    expect(region.character('a')!.gold).toBe(10);
    expect(region.character('b')!.gold).toBe(10);
    expect(of(a, 'trade').at(-1)!.trade).toBeNull();
    expect(notices(b).at(-1)).toMatch(/Trade done/);
  });

  it('will not offer what you do not have, nor the Bible', () => {
    const { region, a } = two();
    region.handle('a', { t: 'trade', action: 'request', name: 'Ilya' });
    region.handle('b', { t: 'trade', action: 'accept' });
    region.handle('a', { t: 'trade', action: 'offer', offer: { items: [{ item: 'crab-shell', qty: 9 }], gold: 0 } });
    expect(notices(a).at(-1)).toMatch(/do not have all/);
    region.handle('a', { t: 'trade', action: 'offer', offer: { items: [{ item: 'bible', qty: 1 }], gold: 0 } });
    expect(of(a, 'trade').at(-1)!.trade!.mine.items).toEqual([]);
  });

  it('ends the trade when one side walks away', () => {
    const { region, b } = two();
    region.handle('a', { t: 'trade', action: 'request', name: 'Ilya' });
    region.handle('b', { t: 'trade', action: 'accept' });
    region.remove('a');
    expect(of(b, 'trade').at(-1)!.trade).toBeNull();
    expect(notices(b).at(-1)).toMatch(/walked away/);
  });

  it('only trades with someone close by', () => {
    const { region, a } = two();
    region.placePlayer('b', region.position('a')!.x + 10, region.position('a')!.y);
    region.handle('a', { t: 'trade', action: 'request', name: 'Ilya' });
    expect(notices(a).at(-1)).toMatch(/Walk closer/);
  });
});

describe('Creator XP', () => {
  it('pays the wisher when others wear their wished gear, once in a while, and never for their own', async () => {
    const { store, ws } = await start();
    const mara = account(store, 'Mara', 'owner');
    const ilya = account(store, 'Ilya');
    const m = await joined(ws, mara.token);
    const i = await joined(ws, ilya.token);
    await wish(m, 'I wish for a blue hat');
    await m.waitFor((msg) => msg.t === 'god' && msg.say.includes('bag'));
    const hat = store.content[0]!.id;
    expect(ITEMS[hat]).toMatchObject({ slot: 'head' });
    const world = app!.world;
    const region = world.regionOf(mara.id)!;
    region.handle(mara.id, { t: 'equip', item: hat });
    expect(world.regionOf(mara.id)!.character(mara.id)!.creatorXp).toBe(0);

    region.updateCharacter(mara.id, (c) => c.equipment.head && delete c.equipment.head);
    region.updateCharacter(ilya.id, (c) => addItem(c, hat));
    region.handle(ilya.id, { t: 'equip', item: hat });
    region.handle(ilya.id, { t: 'equip', slot: 'head' });
    region.handle(ilya.id, { t: 'equip', item: hat });
    expect(region.character(mara.id)!.creatorXp).toBe(CREATOR_XP.equip);
    await i.waitFor((msg) => msg.t === 'notice' && msg.text.includes('put on'));
  });

  it('a wished ability arrives as a scroll; a friend who reads it earns the wisher Creator XP', async () => {
    const { store, ws } = await start();
    const mara = account(store, 'Mara', 'owner');
    const ilya = account(store, 'Ilya');
    const m = await joined(ws, mara.token);
    await joined(ws, ilya.token);
    const card = await wish(m, 'Please make me a lightning bolt spell');
    expect(card).toMatchObject({ tier: 'moderate', where: 'A scroll in your bag' });
    await m.waitFor((msg) => msg.t === 'god' && msg.say.includes('bag'));
    const id = store.content[0]!.id;
    expect(ABILITIES[id]).toMatchObject({ effect: 'bolt' });
    const region = app!.world.regionOf(mara.id)!;
    region.handle(mara.id, { t: 'trade', action: 'request', name: 'Ilya' });
    region.handle(ilya.id, { t: 'trade', action: 'accept' });
    region.handle(mara.id, { t: 'trade', action: 'offer', offer: { items: [{ item: id, qty: 1 }], gold: 0 } });
    region.handle(mara.id, { t: 'trade', action: 'confirm' });
    region.handle(ilya.id, { t: 'trade', action: 'confirm' });
    region.handle(ilya.id, { t: 'use', item: id });
    expect(region.character(ilya.id)!.abilities).toEqual([id]);
    expect(region.character(mara.id)!.creatorXp).toBe(CREATOR_XP.learn);
  });

  it('credits a wisher who is offline, and a Creator level brings Favor', () => {
    const store = Store.memory();
    const ilya = account(store, 'Ilya');
    store.savePosition(ilya.id, 1, 1, 'sanctum', newCharacter());
    const favor = store.accountById(ilya.id)!.character!.favor;
    expect(store.addCreatorXp(ilya.id, 12)).toBe(1);
    const c = store.accountById(ilya.id)!.character!;
    expect([c.creatorLevel, c.creatorXp, c.favor]).toEqual([2, 2, favor + CREATOR_LEVEL_FAVOR]);
  });
});
