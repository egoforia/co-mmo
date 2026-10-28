import { afterEach, describe, expect, it } from 'vitest';
import {
  ABILITIES,
  MARK_BONUS,
  STUN_IMMUNE_MS,
  TICK_SECONDS,
  collides,
  maxHp,
  newCharacter,
  regionDef,
  statusLength,
  type AbilityDef,
  type Character,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';

// The effect kit (region/effects/) and statuses (region/statuses.ts): one
// test per effect and per status (docs/callings-build-plan.md, step 4).

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
  ABILITIES[id] = { name: `Test ${effect}`, description: 'For a test.', effect, energy: 1, cooldown: 1, range: 5, base: 6, stat: 'might', factor: 1, ...more };
  taught.push(id);
  return id;
}

/**
 * Mara in the Whispering Woods on a clear stretch of ground with open space
 * east of her, one creature to play with and the rest sent far away.
 */
function setup(abilities: string[] = [], character: Character = newCharacter()) {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef('woods')!, undefined, () => clock.now, () => 0.5);
  const conn = fakeConn();
  character.abilities.push(...abilities);
  region.join(info('a', 'Mara'), conn, { x: null, y: null }, character);
  const spot = openStretch(region);
  region.placePlayer('a', spot.x, spot.y);
  const [foe, ...rest] = region.creatureIds();
  for (const id of rest) region.placeCreature(id, spot.x + 40, spot.y + 40);
  const tick = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
      clock.now += TICK_SECONDS * 1000;
      region.tick();
    }
  };
  const use = (id: string, target?: string) => region.handle('a', { t: 'ability', ability: id, ...(target ? { target } : {}) });
  return { region, clock, conn, foe: foe!, others: rest, at: spot, tick, use, me: () => region.character('a')! };
}

/** A spot near the spawn with eight clear tiles to the east, so blinks, dashes and lines have room. */
function openStretch(region: Region): { x: number; y: number } {
  const start = region.position('a')!;
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(start.x) + dx + 0.5;
        const y = Math.floor(start.y) + dy + 0.5;
        let clear = true;
        for (let s = -1; s <= 8 && clear; s += 0.25) clear = !collides(region.map, x + s, y) && !collides(region.map, x + s, y - 1) && !collides(region.map, x + s, y + 1);
        if (clear) return { x, y };
      }
    }
  }
  throw new Error('no open ground');
}

const hp = (region: Region, id: string) => region.creature(id)!.hp;
const statusesOf = (region: Region, id: string) => region.statusesOf(id).map((s) => s.id);

describe('the effect kit', () => {
  it('strike hits the creature in reach', () => {
    const id = ability('strike', { range: 1.8 });
    const { region, foe, at, use } = setup([id]);
    region.placeCreature(foe, at.x + 1, at.y);
    const before = hp(region, foe);
    use(id);
    expect(hp(region, foe)).toBeLessThan(before);
  });

  it('bolt hits a creature further off, as arcane', () => {
    const id = ability('bolt', { range: 5 });
    const { region, conn, foe, at, use } = setup([id]);
    region.placeCreature(foe, at.x + 4, at.y);
    const before = hp(region, foe);
    use(id);
    expect(hp(region, foe)).toBeLessThan(before);
    expect(of(conn, 'hit').at(-1)).toMatchObject({ target: foe, ability: id, damage: 'arcane' });
  });

  it('heal mends you, and is refused at full health', () => {
    const id = ability('heal', { range: 0 });
    const { use, me, conn } = setup([id]);
    use(id);
    expect(notices(conn).at(-1)).toMatch(/already at full health/);
    me().hp = 5;
    me().energy = 50;
    use(id);
    expect(me().hp).toBeGreaterThan(5);
  });

  it('area hits everything around the spot and nothing outside it', () => {
    const id = ability('area', { radius: 2, range: 0 });
    const { region, foe, others, at, use } = setup([id]);
    const far = others[0]!;
    region.placeCreature(foe, at.x + 1.5, at.y);
    region.placeCreature(far, at.x + 4, at.y);
    const [a, b] = [hp(region, foe), hp(region, far)];
    use(id);
    expect(hp(region, foe)).toBeLessThan(a);
    expect(hp(region, far)).toBe(b);
  });

  it('area at a chosen creature hits around it', () => {
    const id = ability('area', { radius: 1, range: 6 });
    const { region, foe, others, at, use } = setup([id]);
    const near = others[0]!;
    region.placeCreature(foe, at.x + 5, at.y);
    region.placeCreature(near, at.x + 5.5, at.y);
    const [a, b] = [hp(region, foe), hp(region, near)];
    use(id, foe);
    expect(hp(region, foe)).toBeLessThan(a);
    expect(hp(region, near)).toBeLessThan(b);
  });

  it('cone hits what is in front and not what is behind', () => {
    const id = ability('cone', { range: 3 });
    const { region, foe, others, at, use } = setup([id]);
    const behind = others[0]!;
    region.placeCreature(foe, at.x + 2, at.y + 0.5);
    region.placeCreature(behind, at.x - 2, at.y);
    const [a, b] = [hp(region, foe), hp(region, behind)];
    use(id, foe);
    expect(hp(region, foe)).toBeLessThan(a);
    expect(hp(region, behind)).toBe(b);
  });

  it('line hits what stands in line, not beside it', () => {
    const id = ability('line', { range: 6 });
    const { region, foe, others, at, use } = setup([id]);
    const [inLine, aside] = [others[0]!, others[1]!];
    region.placeCreature(foe, at.x + 5, at.y);
    region.placeCreature(inLine, at.x + 2, at.y + 0.2);
    region.placeCreature(aside, at.x + 2, at.y + 2);
    const before = [hp(region, foe), hp(region, inLine), hp(region, aside)];
    use(id, foe);
    expect(hp(region, foe)).toBeLessThan(before[0]!);
    expect(hp(region, inLine)).toBeLessThan(before[1]!);
    expect(hp(region, aside)).toBe(before[2]);
  });

  it('dash runs to the creature and strikes it', () => {
    const id = ability('dash', { range: 6 });
    const { region, foe, at, use } = setup([id]);
    region.placeCreature(foe, at.x + 5, at.y);
    const before = hp(region, foe);
    use(id);
    const me = region.position('a')!;
    expect(me.x).toBeGreaterThan(at.x + 3);
    expect(Math.hypot(me.x - (at.x + 5), me.y - at.y)).toBeLessThanOrEqual(1.1);
    expect(hp(region, foe)).toBeLessThan(before);
  });

  it('blink carries you the way you face', () => {
    const id = ability('blink', { range: 4, base: 0, factor: 0 });
    const { region, at, use, tick } = setup([id]);
    region.handle('a', { t: 'input', seq: 1, dx: 1, dy: 0 });
    tick(TICK_SECONDS);
    const from = region.position('a')!;
    use(id);
    const to = region.position('a')!;
    expect(to.x - from.x).toBeCloseTo(4, 1);
    expect(to.y).toBeCloseTo(at.y, 5);
  });

  it('shield puts a shield on you as big as the amount', () => {
    const id = ability('shield', { duration: 6 });
    const { region, use } = setup([id]);
    use(id);
    const shield = region.statusesOf('a').find((s) => s.id === 'shielded')!;
    expect(shield.amount).toBeGreaterThan(0);
  });

  it('buff puts its status on you', () => {
    const id = ability('buff', { status: 'shielded', radius: 4 });
    const { region, use } = setup([id]);
    use(id);
    expect(statusesOf(region, 'a')).toContain('shielded');
  });

  it('debuff marks a creature, and the mark makes your hits land harder', () => {
    const mark = ability('debuff', { range: 6 });
    const bolt = ability('bolt', { range: 6, cooldown: 0 });
    const { region, conn, foe, at, use, clock } = setup([mark, bolt]);
    region.placeCreature(foe, at.x + 3, at.y);
    use(bolt);
    const plain = of(conn, 'hit').at(-1)!.amount;
    clock.now += 1000;
    use(mark);
    expect(statusesOf(region, foe)).toContain('marked');
    clock.now += 1000;
    use(bolt);
    expect(of(conn, 'hit').at(-1)!.amount).toBeCloseTo(plain * (1 + MARK_BONUS), 0);
  });

  it('taunt leaves creatures around you Taunted by you', () => {
    const id = ability('taunt', { radius: 3, range: 0 });
    const { region, foe, at, use } = setup([id]);
    region.placeCreature(foe, at.x + 2, at.y);
    use(id);
    expect(region.statusesOf(foe).find((s) => s.id === 'taunted')).toMatchObject({ by: 'a' });
  });

  it('trap springs on the first creature to step on it, hurting and rooting it', () => {
    const id = ability('trap', { status: 'rooted' });
    const { region, foe, at, use, tick } = setup([id]);
    use(id);
    expect(region.creature(foe)!.x).not.toBe(at.x);
    const before = hp(region, foe);
    region.placeCreature(foe, at.x + 0.3, at.y);
    tick(TICK_SECONDS);
    expect(hp(region, foe)).toBeLessThan(before);
    expect(statusesOf(region, foe)).toContain('rooted');
  });

  it('summon calls a helper that strikes nearby creatures for a while', () => {
    const id = ability('summon', { radius: 5, duration: 3 });
    const { region, conn, foe, at, use, tick } = setup([id]);
    region.placeCreature(foe, at.x + 2, at.y);
    use(id);
    tick(1.3);
    expect(of(conn, 'hit').filter((h) => h.ability === id && h.target === foe)).toHaveLength(1);
    const hits = () => of(conn, 'hit').filter((h) => h.ability === id).length;
    tick(3);
    const after = hits();
    tick(3);
    expect(hits()).toBe(after);
  });

  it('stance holds its status and drains Energy until used again', () => {
    const id = ability('stance', { energy: 2, status: 'shielded' });
    const { region, use, me, tick, clock } = setup([id]);
    me().energy = 30;
    use(id);
    expect(statusesOf(region, 'a')).toContain('shielded');
    const energy = me().energy;
    tick(2);
    // Two seconds drain 4 Energy but bring some back; less than without the stance.
    expect(me().energy).toBeLessThan(energy + 2 * 1.5);
    clock.now += 1000;
    use(id);
    tick(2);
    expect(statusesOf(region, 'a')).not.toContain('shielded');
  });

  it('a stance ends when Energy runs out', () => {
    const id = ability('stance', { energy: 50, status: 'shielded' });
    const { conn, use, me, tick } = setup([id]);
    me().energy = 50;
    use(id);
    tick(0.5);
    expect(notices(conn).at(-1)).toMatch(/Out of Energy/);
  });

  it('cleanse washes harmful statuses away and keeps the helpful ones', () => {
    const id = ability('cleanse', { radius: 4 });
    const { region, use } = setup([id]);
    region.afflict('a', 'poisoned', 6, { amount: 1 });
    region.afflict('a', 'slowed', 3);
    region.afflict('a', 'shielded', 6, { amount: 10 });
    use(id);
    expect(statusesOf(region, 'a')).toEqual(['shielded']);
  });

  it('a hit can add the skill\'s status to what it hits', () => {
    const id = ability('bolt', { status: 'slowed', duration: 3 });
    const { region, foe, at, use } = setup([id]);
    region.placeCreature(foe, at.x + 3, at.y);
    use(id);
    expect(statusesOf(region, foe)).toContain('slowed');
  });
});

describe('statuses', () => {
  /** How far Mara walks east in half a second of input. */
  const walk = (s: ReturnType<typeof setup>) => {
    const from = s.region.position('a')!;
    for (let i = 1; i <= 10; i++) {
      s.region.handle('a', { t: 'input', seq: 100 + i, dx: 1, dy: 0 });
      s.tick(TICK_SECONDS);
    }
    return s.region.position('a')!.x - from.x;
  };

  it('Slowed: you walk about a third slower', () => {
    const free = walk(setup());
    const s = setup();
    s.region.afflict('a', 'slowed', 3);
    expect(walk(s)).toBeCloseTo(free * 0.65, 1);
  });

  it('Rooted: you cannot move but can still fight', () => {
    const id = ability('strike', { range: 1.8 });
    const s = setup([id]);
    s.region.afflict('a', 'rooted', 3);
    expect(walk(s)).toBe(0);
    s.region.placeCreature(s.foe, s.region.position('a')!.x + 1, s.at.y);
    const before = hp(s.region, s.foe);
    s.use(id);
    expect(hp(s.region, s.foe)).toBeLessThan(before);
  });

  it('Stunned: you cannot move, attack or use abilities', () => {
    const id = ability('strike', { range: 1.8 });
    const s = setup([id]);
    s.region.placeCreature(s.foe, s.at.x + 1, s.at.y);
    s.region.afflict('a', 'stunned', 2);
    const before = hp(s.region, s.foe);
    s.region.handle('a', { t: 'attack' });
    s.use(id);
    expect(hp(s.region, s.foe)).toBe(before);
    expect(notices(s.conn).at(-1)).toMatch(/Stunned/);
    expect(walk(s)).toBe(0);
  });

  it('Stunned: a creature loses its turns', () => {
    const s = setup();
    s.region.placeCreature(s.foe, s.at.x + 3, s.at.y);
    s.region.afflict(s.foe, 'stunned', 1);
    const at = s.region.creature(s.foe)!;
    s.tick(0.5);
    expect(s.region.creature(s.foe)).toMatchObject({ x: at.x, y: at.y });
  });

  it('stun immunity: no new stun takes for six seconds after one', () => {
    const s = setup();
    expect(s.region.afflict(s.foe, 'stunned', 1)).toBe(true);
    s.tick(1.5);
    expect(s.region.afflict(s.foe, 'stunned', 1)).toBe(false);
    s.clock.now += STUN_IMMUNE_MS;
    expect(s.region.afflict(s.foe, 'stunned', 1)).toBe(true);
  });

  it('Silenced: shows on the creature for all to see', () => {
    const s = setup();
    s.region.placeCreature(s.foe, s.at.x + 2, s.at.y);
    s.region.afflict(s.foe, 'silenced', 3);
    s.tick(TICK_SECONDS);
    const seen = of(s.conn, 'snapshot').at(-1)!.creatures.find((c) => c.id === s.foe)!;
    expect(seen.statuses).toEqual(['silenced']);
  });

  it('Burning: arcane damage each second, credited to whoever set the fire', () => {
    const s = setup();
    s.region.placeCreature(s.foe, s.at.x + 2, s.at.y);
    s.region.afflict(s.foe, 'burning', 3, { by: 'a', amount: 3 });
    const before = hp(s.region, s.foe);
    s.tick(1.05);
    expect(hp(s.region, s.foe)).toBeLessThan(before);
    expect(of(s.conn, 'hit').at(-1)).toMatchObject({ by: 'a', target: s.foe, damage: 'arcane' });
  });

  it('Bleeding: damage each second that armour does not stop', () => {
    const s = setup();
    s.me().hp = 30;
    s.region.afflict('a', 'bleeding', 6, { amount: 2 });
    s.tick(2.05);
    const wounds = of(s.conn, 'hit').filter((h) => h.target === 'a');
    expect(wounds.map((h) => h.amount)).toEqual([2, 2]);
  });

  it('Poisoned: damage each second, and heals do less', () => {
    const heal = ability('heal', { range: 0, cooldown: 0 });
    const healed = (poisoned: boolean) => {
      const s = setup([heal]);
      s.me().hp = 5;
      if (poisoned) s.region.afflict('a', 'poisoned', 6, { amount: 1 });
      s.use(heal);
      return s.me().hp - 5;
    };
    expect(healed(true)).toBe(Math.round(healed(false) * 0.7));
    const s = setup();
    s.me().hp = 20;
    s.region.afflict('a', 'poisoned', 6, { amount: 1 });
    s.tick(1.05);
    expect(of(s.conn, 'hit').filter((h) => h.target === 'a').map((h) => h.amount)).toEqual([1]);
  });

  it('Marked: only the one who marked it (and their party) hits harder', () => {
    const bolt = ability('bolt', { range: 6, cooldown: 0 });
    const s = setup([bolt]);
    s.region.placeCreature(s.foe, s.at.x + 3, s.at.y);
    s.use(bolt);
    const plain = of(s.conn, 'hit').at(-1)!.amount;
    s.region.afflict(s.foe, 'marked', 8, { by: 'someone-else' });
    s.clock.now += 1000;
    s.use(bolt);
    expect(of(s.conn, 'hit').at(-1)!.amount).toBeCloseTo(plain, 5);
  });

  it('Taunted: shows on the creature, and who taunted it is kept', () => {
    const s = setup();
    s.region.afflict(s.foe, 'taunted', 4, { by: 'a' });
    expect(s.region.statusesOf(s.foe)[0]).toMatchObject({ id: 'taunted', by: 'a' });
  });

  it('Shielded: a creature\'s blows hit the shield before your health', () => {
    const s = setup();
    s.me().hp = 30;
    s.region.afflict('a', 'shielded', 8, { amount: 1000 });
    s.region.placeCreature(s.foe, s.at.x + 0.8, s.at.y);
    // Provoke it so it fights back.
    s.region.handle('a', { t: 'attack' });
    s.tick(3);
    const blows = of(s.conn, 'hit').filter((h) => h.target === 'a');
    expect(blows.length).toBeGreaterThan(0);
    expect(blows.every((h) => h.amount === 0)).toBe(true);
    expect(s.me().hp).toBeGreaterThanOrEqual(30);
  });

  it('Weakened: sent with your statuses while it lasts', () => {
    const s = setup();
    s.me().weakenedUntil = s.clock.now + 30_000;
    s.tick(TICK_SECONDS);
    expect(of(s.conn, 'snapshot').at(-1)!.statuses).toEqual([{ id: 'weakened', left: 30 }]);
  });

  it('Vigor shortens your harmful statuses', () => {
    const tough = newCharacter();
    tough.stats.vigor = 20;
    const s = setup([], tough);
    s.region.afflict('a', 'slowed', 3);
    const left = s.region.statusesOf('a')[0]!.until - s.clock.now;
    expect(left).toBe(statusLength('slowed', 3, 20));
    expect(left).toBeLessThan(3000);
  });

  it('your snapshot lists your statuses; others see them on you', () => {
    const s = setup();
    const bo = fakeConn();
    s.region.join(info('b', 'Bo'), bo, { x: s.at.x + 1, y: s.at.y }, newCharacter());
    s.region.afflict('a', 'slowed', 3);
    s.tick(TICK_SECONDS);
    expect(of(s.conn, 'snapshot').at(-1)!.statuses).toEqual([{ id: 'slowed', left: 3 }]);
    expect(of(bo, 'snapshot').at(-1)!.players.find((p) => p.id === 'a')!.statuses).toEqual(['slowed']);
  });

  it('harmful statuses fall away when you fall', () => {
    const s = setup();
    s.region.afflict('a', 'bleeding', 6, { amount: 1 });
    s.me().hp = 0;
    s.tick(TICK_SECONDS);
    expect(s.region.statusesOf('a')).toHaveLength(0);
    expect(maxHp(s.me())).toBeGreaterThan(0);
  });
});
