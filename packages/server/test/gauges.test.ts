import { afterEach, describe, expect, it } from 'vitest';
import {
  ABILITIES,
  ECHO_MS,
  FOCUS_CRIT,
  GAUGE_MAX,
  MOMENTUM_FADE_MS,
  RESOLVE_CALM_MS,
  RESOLVE_FADE_MS,
  TICK_SECONDS,
  energyPerSecond,
  finisherFactor,
  gaugeOf,
  maxHp,
  newCharacter,
  regionDef,
  startCharacter,
  weaveAfter,
  type AbilityDef,
  type CallingId,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';

// The signature gauges (region/gauges.ts, docs/callings-build-plan.md step
// 6): each fills, empties and is spent as docs/classes.md says, and the
// Warden, Duelist and Ranger gain Energy with each pip.

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const of = <T extends ServerMessage['t']>(c: { messages: ServerMessage[] }, t: T) =>
  c.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
const notices = (c: { messages: ServerMessage[] }) => of(c, 'notice').map((m) => m.text);

const taught: string[] = [];
afterEach(() => {
  for (const id of taught.splice(0)) delete ABILITIES[id];
});

/** A made-up ability for one test, with plain numbers. */
function ability(effect: AbilityDef['effect'], more: Partial<AbilityDef> = {}): string {
  const id = `test-${effect}-${taught.length}`;
  ABILITIES[id] = { name: `Test ${effect}`, description: 'For a test.', effect, energy: 1, cooldown: 1, range: 5, base: 20, stat: 'might', factor: 1, ...more };
  taught.push(id);
  return id;
}

/**
 * Mara of a Calling in a region, with every creature sent far away but
 * `foe`, which `near()` brings beside her. Dice roll `dice.v` (the middle).
 */
function setup(calling: CallingId | undefined, regionId = 'woods', abilities: string[] = []) {
  const clock = { now: 1_000_000 };
  const dice = { v: 0.5 };
  const region = new Region(regionDef(regionId)!, undefined, () => clock.now, () => dice.v);
  const conn = fakeConn();
  const character = calling ? startCharacter('ursine', calling) : newCharacter();
  character.abilities.push(...abilities);
  region.join(info('a', 'Mara'), conn, { x: null, y: null }, character);
  const me = () => region.character('a')!;
  const at = region.position('a')!;
  const [foe, ...rest] = region.creatureIds();
  for (const id of [foe!, ...rest]) region.placeCreature(id, at.x + 40, at.y + 40);
  const tick = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
      clock.now += TICK_SECONDS * 1000;
      region.tick();
    }
  };
  const near = () => region.placeCreature(foe!, at.x + 1, at.y);
  const away = () => region.placeCreature(foe!, at.x + 40, at.y + 40);
  const attack = () => {
    clock.now += 2000;
    region.handle('a', { t: 'attack' });
  };
  const use = (id: string) => {
    clock.now += 1100;
    region.handle('a', { t: 'ability', ability: id });
  };
  const pips = () => region.gauge('a')?.pips ?? 0;
  /** Ticks until a creature's blow reaches Mara; returns how many ticks it took. */
  const takeHit = () => {
    const before = of(conn, 'hit').filter((h) => h.target === 'a').length;
    let ticks = 0;
    for (; ticks < 100 && of(conn, 'hit').filter((h) => h.target === 'a').length === before; ticks++) tick(TICK_SECONDS);
    return ticks;
  };
  const lastHit = () => of(conn, 'hit').filter((h) => h.by === 'a').at(-1)!.amount;
  const shieldSize = () => Number(/shields you from (\d+)/.exec(notices(conn).at(-1)!)![1]);
  return { region, clock, dice, conn, foe: foe!, me, tick, near, away, attack, use, pips, takeHit, lastHit, shieldSize };
}

describe('signature gauges', () => {
  it('each Calling has its own gauge, and the player is told of it', () => {
    expect(gaugeOf('warden')).toBe('resolve');
    expect(gaugeOf('bellkeeper')).toBe('echo');
    expect(gaugeOf(undefined)).toBeUndefined();
    const t = setup('ranger');
    t.tick(TICK_SECONDS);
    expect(of(t.conn, 'gauge')[0]).toMatchObject({ gauge: 'focus', pips: 0 });
    const none = setup(undefined);
    none.tick(1);
    expect(none.region.gauge('a')).toBeUndefined();
    expect(of(none.conn, 'gauge')).toEqual([]);
  });

  it('Warden: Resolve grows with each blow taken, gives 2 Energy a pip, and empties slowly out of combat', () => {
    const t = setup('warden', 'desert');
    t.near();
    t.region.updateCharacter('a', (c) => { c.energy = 0; });
    const ticks = t.takeHit();
    expect(t.pips()).toBe(1);
    // Regeneration while it came, plus 2 for the pip.
    expect(t.me().energy).toBeCloseTo(energyPerSecond(t.me()) * TICK_SECONDS * ticks + 2, 5);
    t.takeHit();
    expect(t.pips()).toBe(2);
    t.tick(TICK_SECONDS);
    expect(of(t.conn, 'gauge').at(-1)).toMatchObject({ gauge: 'resolve', pips: 2 });

    t.away();
    t.region.updateCharacter('a', (c) => { c.hp = maxHp(c); });
    t.tick(RESOLVE_CALM_MS / 1000 - 0.5);
    expect(t.pips()).toBe(2);
    t.tick(1);
    expect(t.pips()).toBe(1);
    t.tick(RESOLVE_FADE_MS / 1000);
    expect(t.pips()).toBe(0);
  });

  it('Warden: a finisher like Bulwark spends all Resolve, +50% per pip', () => {
    const bulwark = ability('shield', { finisher: true, perPip: 0.5, stat: 'vigor' });
    const fresh = setup('warden', 'desert', [bulwark]);
    fresh.use(bulwark);
    const plain = fresh.shieldSize();

    const t = setup('warden', 'desert', [bulwark]);
    t.near();
    t.takeHit();
    t.takeHit();
    expect(t.pips()).toBe(2);
    t.use(bulwark);
    expect(t.shieldSize()).toBeCloseTo(plain * finisherFactor(ABILITIES[bulwark]!, 2), -0.5);
    expect(t.pips()).toBe(0);
  });

  it('Duelist: Momentum grows with each hit that lands, 1 Energy a pip, and empties after 6 s without one', () => {
    const t = setup('duelist');
    t.near();
    t.region.updateCharacter('a', (c) => { c.energy = 0; });
    t.attack();
    expect(t.pips()).toBe(1);
    expect(t.me().energy).toBe(1);
    t.attack();
    expect(t.pips()).toBe(2);
    t.away();
    t.tick(MOMENTUM_FADE_MS / 1000 - 1);
    expect(t.pips()).toBe(2);
    t.tick(1.5);
    expect(t.pips()).toBe(0);
  });

  it('Duelist: a finisher spends all Momentum, grows with it, and its own hit builds none', () => {
    const whirl = ability('strike', { finisher: true, perPip: 0.25, range: 2, base: 2, factor: 0.2 });
    const fresh = setup('duelist', 'woods', [whirl]);
    fresh.near();
    fresh.use(whirl);
    const plain = fresh.lastHit();
    expect(fresh.pips()).toBe(0);

    const t = setup('duelist', 'woods', [whirl]);
    t.near();
    t.attack();
    t.attack();
    expect(t.pips()).toBe(2);
    t.use(whirl);
    expect(t.lastHit()).toBeGreaterThan(plain);
    expect(t.pips()).toBe(0);
  });

  it('Ranger: Focus grows each second standing still, 1 Energy a pip, and moving or being hit empties it', () => {
    const t = setup('ranger', 'desert');
    t.region.updateCharacter('a', (c) => { c.energy = 0; });
    t.tick(1);
    expect(t.pips()).toBe(1);
    expect(t.me().energy).toBeCloseTo(energyPerSecond(t.me()) + 1, 5);
    t.tick(10);
    expect(t.pips()).toBe(GAUGE_MAX);

    t.region.handle('a', { t: 'input', seq: 1, dx: 1, dy: 0 });
    t.tick(TICK_SECONDS);
    expect(t.pips()).toBe(0);

    t.tick(3);
    expect(t.pips()).toBe(3);
    t.near();
    t.takeHit();
    expect(t.pips()).toBe(0);
  });

  it('Ranger: each Focus pip is +5% crit, and a big shot spends it', () => {
    // Dice that crit only with Focus: above the Ranger's own chance, below it with five pips.
    const roll = 0.2;
    expect(roll).toBeLessThan(0.1 + GAUGE_MAX * FOCUS_CRIT);
    const fresh = setup('ranger');
    fresh.dice.v = roll;
    fresh.near();
    fresh.attack();
    const plain = fresh.lastHit();

    const aimed = ability('bolt', { finisher: true, perPip: 0.15, stat: 'agility' });
    const t = setup('ranger', 'woods', [aimed]);
    t.dice.v = roll;
    t.tick(5);
    expect(t.pips()).toBe(GAUGE_MAX);
    t.near();
    t.attack();
    expect(t.lastHit()).toBeGreaterThan(plain);
    t.use(aimed);
    expect(t.pips()).toBe(0);
  });

  it('Wishweaver: a new thread adds Weave, the same thread twice adds none, and at 3 the next spell is Woven', () => {
    expect(weaveAfter(0, undefined, 'ember')).toBe(1);
    expect(weaveAfter(1, 'ember', 'ember')).toBe(1);
    const ember = ability('shield', { thread: 'ember', stat: 'wit' });
    const tide = ability('shield', { thread: 'tide', stat: 'wit' });
    const gale = ability('shield', { thread: 'gale', stat: 'wit' });
    const plainSpell = ability('shield', { stat: 'wit' });
    const t = setup('wishweaver', 'woods', [ember, tide, gale, plainSpell]);
    t.use(ember);
    const plain = t.shieldSize();
    expect(t.pips()).toBe(1);
    t.use(ember);
    expect(t.pips()).toBe(1);
    t.use(plainSpell);
    expect(t.pips()).toBe(1);
    t.use(tide);
    t.use(gale);
    expect(t.pips()).toBe(3);
    t.tick(TICK_SECONDS);
    expect(of(t.conn, 'gauge').at(-1)).toMatchObject({ gauge: 'weave', pips: 3, woven: true });

    t.use(ember);
    expect(Math.abs(t.shieldSize() - plain * 2)).toBeLessThanOrEqual(1);
    expect(t.pips()).toBe(0);
    t.use(tide);
    expect(t.pips()).toBe(1);
  });

  it('Bellkeeper: a heal leaves an Echo, Toll rings it for half the heal, and Echoes fade', () => {
    const mend = ability('heal', { base: 10, stat: 'spirit' });
    const toll = ability('heal', { finisher: true, range: 8, base: 0, factor: 0 });
    const t = setup('bellkeeper', 'woods', [mend, toll]);
    t.use(toll);
    expect(notices(t.conn).at(-1)).toBe('No Echoes are close enough to ring.');

    t.region.updateCharacter('a', (c) => { c.hp = 1; });
    t.use(mend);
    const healed = t.me().hp - 1;
    expect(t.pips()).toBe(1);
    const before = t.me().hp;
    t.use(toll);
    expect(t.me().hp - before).toBe(Math.round(healed / 2));
    expect(t.pips()).toBe(0);

    t.region.updateCharacter('a', (c) => { c.hp = 1; });
    t.use(mend);
    expect(t.pips()).toBe(1);
    t.tick(ECHO_MS / 1000 + 0.5);
    expect(t.pips()).toBe(0);
  });

  it('a gauge starts again when the Calling changes', () => {
    const t = setup('duelist');
    t.near();
    t.attack();
    expect(t.region.gauge('a')).toEqual({ id: 'momentum', pips: 1 });
    t.region.updateCharacter('a', (c) => { c.calling = 'ranger'; });
    expect(t.region.gauge('a')).toEqual({ id: 'focus', pips: 0 });
  });
});
