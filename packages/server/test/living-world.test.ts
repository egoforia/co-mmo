import { afterEach, describe, expect, it } from 'vitest';
import {
  CREATURES,
  DEFAULT_SKY,
  FLAME_LIGHT,
  ITEMS,
  TICK_RATE,
  collides,
  newCharacter,
  regionDef,
  weatherAt,
  type CreatureDef,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { findPath } from '../src/walkers.ts';
import { World } from '../src/world.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const none = { x: null, y: null };
const DAY = DEFAULT_SKY.dayMinutes * 60_000;
/** Epoch ms at a game hour, some days in. */
const hour = (h: number) => DAY * 10 + (h / 24) * DAY;

/** A region with a controllable clock and dice that always roll the middle. */
function setup(id: string, h: number) {
  const clock = { now: hour(h) };
  const region = new Region(regionDef(id)!, undefined, () => clock.now, () => 0.5);
  return { region, clock };
}

function ticks(region: Region, clock: { now: number }, n: number): void {
  for (let i = 0; i < n; i++) {
    clock.now += 1000 / TICK_RATE;
    region.tick();
  }
}

describe('creatures', () => {
  afterEach(() => {
    delete CREATURES['test-timid'];
    delete ITEMS['test-torch'];
  });

  it('Sun Scarabs sleep through the night and hunt as a pack by day', () => {
    const night = setup('desert', 1);
    night.region.join(info('a'), fakeConn(), none, newCharacter());
    const [first] = night.region.creatureIds();
    const me = night.region.position('a')!;
    ticks(night.region, night.clock, 2 * TICK_RATE);
    night.region.placeCreature(first!, me.x + 2, me.y);
    ticks(night.region, night.clock, 2);
    expect(night.region.creatureMood(first!)).toEqual({ mood: 'asleep', aggro: null });

    const day = setup('desert', 12);
    day.region.join(info('b'), fakeConn(), none, newCharacter());
    const ids = day.region.creatureIds();
    const b = day.region.position('b')!;
    // Two of the pack close together, one of them close enough to notice the player.
    day.region.placeCreature(ids[0]!, b.x + 2, b.y);
    day.region.placeCreature(ids[1]!, b.x + 6, b.y);
    ticks(day.region, day.clock, 1);
    expect(day.region.creatureMood(ids[0]!)!.aggro).toBe('b');
    expect(day.region.creatureMood(ids[1]!)!.aggro).toBe('b');
  });

  it('a sleeping creature wakes when struck', () => {
    const { region, clock } = setup('desert', 1);
    region.join(info('a'), fakeConn(), none, newCharacter());
    const [id] = region.creatureIds();
    const me = region.position('a')!;
    region.placeCreature(id!, me.x + 1, me.y);
    ticks(region, clock, 2);
    expect(region.creatureMood(id!)!.mood).toBe('asleep');
    region.handle('a', { t: 'attack' });
    expect(region.creatureMood(id!)).toEqual({ mood: undefined, aggro: 'a' });
  });

  it('a badly hurt mushroom runs away, then heads home', () => {
    const { region, clock } = setup('woods', 12);
    const conn = fakeConn();
    region.join(info('a'), conn, none, newCharacter());
    const id = region.creatureIds().find((c) => c.includes('walking-mushroom'))!;
    const me = region.position('a')!;
    region.placeCreature(id, me.x + 1, me.y);
    while ((region.creature(id)!.hp / CREATURES['walking-mushroom']!.hp) > 0.3) {
      region.handle('a', { t: 'attack' });
      clock.now += 1500;
    }
    expect(region.creatureMood(id)!.mood).toBe('fleeing');
    const before = Math.hypot(region.creature(id)!.x - me.x, region.creature(id)!.y - me.y);
    ticks(region, clock, TICK_RATE);
    expect(Math.hypot(region.creature(id)!.x - me.x, region.creature(id)!.y - me.y)).toBeGreaterThan(before);
    region.tick();
    const snap = conn.messages.filter((m) => m.t === 'snapshot').at(-1) as Extract<ServerMessage, { t: 'snapshot' }>;
    expect(snap.creatures.find((c) => c.id === id)?.mood).toBe('fleeing');
    ticks(region, clock, 5 * TICK_RATE);
    expect(region.creatureMood(id)!.mood).toBeUndefined();
  });

  it('a timid creature never fights and runs from anyone who comes close', () => {
    const timid: CreatureDef = { ...CREATURES['walking-mushroom']!, name: 'Shy Moth', behavior: 'timid', notice: 3.5, speed: 3 };
    CREATURES['test-timid'] = timid;
    const { region, clock } = setup('sanctum', 12);
    region.join(info('a'), fakeConn(), none, newCharacter());
    const me = region.position('a')!;
    region.addCreatures('test-timid', [{ x: me.x + 2, y: me.y }]);
    ticks(region, clock, 1);
    expect(region.creatureMood('test-timid-0')!.mood).toBe('fleeing');
    ticks(region, clock, 2 * TICK_RATE);
    const c = region.creature('test-timid-0')!;
    expect(Math.hypot(c.x - me.x, c.y - me.y)).toBeGreaterThan(3);
    expect(region.character('a')!.hp).toBe(newCharacter().hp);
  });

  it('a Crab Knight walks its rounds', () => {
    const { region, clock } = setup('shore', 12);
    const [id] = region.creatureIds();
    const start = region.creature(id!)!;
    const spots = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ticks(region, clock, TICK_RATE);
      const c = region.creature(id!)!;
      spots.add(`${Math.round(c.x)},${Math.round(c.y)}`);
      expect(Math.hypot(c.x - start.x, c.y - start.y)).toBeLessThanOrEqual(4.5);
    }
    expect(spots.size).toBeGreaterThan(2);
  });

  it('creatures see less in the dark, but spot a player carrying a torch', () => {
    const { region, clock } = setup('shore', 1);
    const ch = newCharacter();
    region.join(info('a'), fakeConn(), none, ch);
    const [id] = region.creatureIds();
    const me = region.position('a')!;
    // Within a Crab Knight's notice by day (3), beyond it in the dark.
    region.placeCreature(id!, me.x + 2.4, me.y);
    ticks(region, clock, 1);
    expect(region.creatureMood(id!)!.aggro).toBeNull();
    ITEMS['test-torch'] = { ...ITEMS['crab-lance']!, name: 'Test Torch', light: FLAME_LIGHT };
    region.change('a', { op: 'give', item: 'test-torch', qty: 1 });
    region.handle('a', { t: 'equip', item: 'test-torch' });
    region.placeCreature(id!, me.x + 2.4, me.y);
    ticks(region, clock, 1);
    expect(region.creatureMood(id!)!.aggro).toBe('a');
  });
});

describe('people', () => {
  it('keep their day: Old Bramble gathers herbs in the clearing by day and sleeps at home at night', () => {
    const { region, clock } = setup('woods', 12);
    const home = region.npc('old-bramble')!.home;
    ticks(region, clock, 40 * TICK_RATE);
    const out = region.npc('old-bramble')!;
    expect(Math.hypot(out.x - home.x, out.y - home.y)).toBeGreaterThan(5);
    expect(collides(region.map, out.x, out.y)).toBe(false);

    clock.now = hour(23);
    ticks(region, clock, 40 * TICK_RATE);
    const back = region.npc('old-bramble')!;
    expect(Math.hypot(back.x - home.x, back.y - home.y)).toBeLessThan(1);
    expect(back.asleep).toBe(true);
  });

  it('wake when spoken to, and still talk', () => {
    const { region, clock } = setup('shore', 23);
    const conn = fakeConn();
    region.join(info('a'), conn, none, newCharacter());
    // Out of her way: nobody sleeps while someone stands there talking.
    region.placePlayer('a', region.map.spawn.x - 8, region.map.spawn.y);
    ticks(region, clock, 30 * TICK_RATE);
    const marina = region.npc('marina')!;
    expect(marina.asleep).toBe(true);
    region.placePlayer('a', marina.x + 1, marina.y);
    region.handle('a', { t: 'interact' });
    const talk = conn.messages.find((m) => m.t === 'dialogue') as Extract<ServerMessage, { t: 'dialogue' }>;
    expect(talk.text).toMatch(/^Marina the Trader wakes with a start/);
    expect(talk.shop).toBe(true);
  });

  it('Sister Amala keeps her vigil awake at night', () => {
    const { region, clock } = setup('sanctum', 23);
    ticks(region, clock, 10 * TICK_RATE);
    expect(region.npc('sister-amala')!.asleep).toBe(false);
  });

  it('find their way around walls into a building', () => {
    const woods = setup('woods', 12).region;
    const bramble = woods.npc('old-bramble')!;
    const path = findPath(woods.map, woods.map.spawn, bramble.home)!;
    expect(path.at(-1)).toEqual(bramble.home);
    expect(path.length).toBeGreaterThan(2);
  });
});

describe('weather', () => {
  it('is in the welcome, and everyone hears when it turns', () => {
    const { region, clock } = setup('shore', 12);
    const conn = fakeConn();
    region.join(info('a'), conn, none, newCharacter());
    const welcome = conn.messages[0] as Extract<ServerMessage, { t: 'welcome' }>;
    expect(welcome.sky).toEqual({ config: DEFAULT_SKY, now: clock.now, weather: weatherAt('shore', 'sunlit-shore', clock.now, DEFAULT_SKY) });
    region.tick();
    // Walk the clock on spell by spell until the weather changes.
    const spell = DEFAULT_SKY.weatherMinutes * 60_000;
    let turned: ServerMessage | undefined;
    for (let i = 0; i < 50 && !turned; i++) {
      clock.now += spell;
      region.tick();
      turned = conn.messages.find((m) => m.t === 'sky');
    }
    expect(turned).toMatchObject({ t: 'sky', weather: weatherAt('shore', 'sunlit-shore', clock.now, DEFAULT_SKY) });
  });

  it('follows the world’s settings, on every server alike', () => {
    const world = new World(() => hour(12), () => 0.5, { dayMinutes: 10, weatherMinutes: 5, weather: false });
    expect(world.state().sky).toEqual({ dayMinutes: 10, weatherMinutes: 5, weather: false });
    expect(world.skyOver(regionDef('desert')!).weather).toBe('clear');
    const conn = fakeConn();
    world.join(info('a'), conn, { regionId: 'desert', x: null, y: null }, newCharacter());
    const welcome = conn.messages.find((m) => m.t === 'welcome') as Extract<ServerMessage, { t: 'welcome' }>;
    expect(welcome.sky.config.dayMinutes).toBe(10);
  });
});
