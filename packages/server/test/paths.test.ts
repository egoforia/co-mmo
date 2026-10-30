import { describe, expect, it } from 'vitest';
import {
  CRIT_MULTIPLIER,
  PATH_MENTORS,
  QUESTS,
  SAND_DOUBLE_ART,
  SPIRIT_HAWK_ART,
  SKILL_NUMBERS_KEPT,
  TICK_SECONDS,
  TRIAL_QUESTS,
  addItem,
  choosePath,
  collides,
  completeQuest,
  gainXp,
  maxHp,
  regionDef,
  startCharacter,
  xpToNext,
  type CallingId,
  type Character,
  type CharacterMessage,
  type GodMessage,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import type { ChatModel, ChatRequest } from '../src/ai/chat.ts';
import { Region, type Connection } from '../src/region.ts';
import { account, joined, pray, start } from './helpers.ts';

// Build plan step 7b on the server: choosing a Path at its mentor, the
// Calling Wish through a prayer, and one behaviour test per Path for its
// signature skill.

/** A character of this Calling at `level`, trial done and Path chosen (when given). */
function hero(calling: CallingId, level: number, path?: string): Character {
  const c = startCharacter('ursine', calling);
  while (c.level < level) gainXp(c, xpToNext(c.level));
  const id = TRIAL_QUESTS[calling];
  const goal = QUESTS[id]!.goal;
  const state = { id, count: goal.kind === 'defeat' ? goal.count : 0, done: false };
  c.quests.push(state);
  if (goal.kind === 'gather') for (const i of goal.items) addItem(c, i.item, i.qty);
  completeQuest(c, state);
  if (path) expect(choosePath(c, path)).toBeUndefined();
  c.energy = 200;
  return c;
}

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const of = <T extends ServerMessage['t']>(c: { messages: ServerMessage[] }, t: T) =>
  c.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
const notices = (c: { messages: ServerMessage[] }) => of(c, 'notice').map((m) => m.text);

/**
 * Mara in the Whispering Woods on open ground with room to the east, one
 * creature to fight and the rest sent far off.
 */
function setup(character: Character, region = new Region(regionDef('woods')!, undefined, () => clock.now, () => 0.5), clock = { now: 1_000_000 }) {
  const conn = fakeConn();
  region.join(info('a', 'Mara'), conn, { x: null, y: null }, character);
  const at = openStretch(region);
  region.placePlayer('a', at.x, at.y);
  const [foe, ...others] = region.creatureIds();
  for (const id of others) region.placeCreature(id, at.x + 40, at.y + 40);
  // Creatures tough enough that a level-10 hero's blows show what they do without ending the fight.
  for (const c of (region as unknown as { s: { creatures: { hp: number; def: { hp: number } }[] } }).s.creatures) {
    c.def = { ...c.def, hp: 10_000 };
    c.hp = 10_000;
  }
  const tick = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
      clock.now += TICK_SECONDS * 1000;
      region.tick();
    }
  };
  const use = (id: string, target?: string) => region.handle('a', { t: 'ability', ability: id, ...(target ? { target } : {}) });
  return { region, clock, conn, foe: foe!, others, at, tick, use, me: () => region.character('a')! };
}

function openStretch(region: Region): { x: number; y: number } {
  const start = region.position('a')!;
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(start.x) + dx + 0.5;
        const y = Math.floor(start.y) + dy + 0.5;
        let clear = true;
        for (let s = -1; s <= 9 && clear; s += 0.25) clear = !collides(region.map, x + s, y) && !collides(region.map, x + s, y - 1) && !collides(region.map, x + s, y + 1);
        if (clear) return { x, y };
      }
    }
  }
  throw new Error('no open ground');
}

const hp = (region: Region, id: string) => region.creature(id)!.hp;
const statusIds = (region: Region, id: string) => region.statusesOf(id).map((s) => s.id);

// --- Choosing a Path at the mentor ------------------------------------------------

describe('the Path mentor', () => {
  it('offers both Paths after the trial, and teaches the chosen one', () => {
    const { region, conn, me } = setup(hero('warden', 10));
    const alder = region.npc(PATH_MENTORS.warden)!;
    region.placePlayer('a', alder.x + 0.8, alder.y, region.floorOf(PATH_MENTORS.warden));
    region.handle('a', { t: 'interact' });
    const talk = of(conn, 'dialogue').at(-1)!;
    expect(talk.npc.name).toBe('Sir Alder');
    expect(talk.paths!.map((p) => [p.id, p.cost])).toEqual([['oakheart', 0], ['stonefist', 0]]);
    region.handle('a', { t: 'choosePath', npc: PATH_MENTORS.warden, path: 'stonefist' });
    expect(me().path).toBe('stonefist');
    expect(me().abilities).toContain('quake-leap');
    expect(notices(conn)).toEqual(expect.arrayContaining(['You walk the Stonefist Path now.', 'You learned Quake Leap.']));
  });

  it('will not set you on a Path from afar, or before the trial', () => {
    const c = startCharacter('ursine', 'warden');
    while (c.level < 10) gainXp(c, xpToNext(c.level));
    const { region, conn, me } = setup(c);
    region.handle('a', { t: 'choosePath', npc: PATH_MENTORS.warden, path: 'oakheart' });
    expect(me().path).toBeUndefined();
    const alder = region.npc(PATH_MENTORS.warden)!;
    region.placePlayer('a', alder.x + 0.8, alder.y, region.floorOf(PATH_MENTORS.warden));
    region.handle('a', { t: 'interact' });
    expect(of(conn, 'dialogue').at(-1)!.paths).toBeUndefined();
    region.handle('a', { t: 'choosePath', npc: PATH_MENTORS.warden, path: 'oakheart' });
    expect(me().path).toBeUndefined();
    expect(notices(conn).at(-1)).toMatch(/Finish your trial first/);
  });

  it('tells you of each Path skill and Calling Wish as you level', () => {
    const c = hero('wishweaver', 14, 'stormcaller');
    const { region, conn } = setup(c);
    region.change('a', { op: 'xp', amount: xpToNext(14) });
    expect(notices(conn)).toEqual(expect.arrayContaining([expect.stringMatching(/^You learned Overflow\. It works by itself/)]));
    while (region.character('a')!.level < 19) region.change('a', { op: 'xp', amount: xpToNext(region.character('a')!.level) });
    region.change('a', { op: 'xp', amount: xpToNext(19) });
    expect(notices(conn)).toEqual(expect.arrayContaining(['You learned Starfall.', expect.stringMatching(/^You earned a Calling Wish/)]));
  });
});

// --- The Calling Wish, through a prayer ---------------------------------------------

/** A God that answers from a script and keeps what it was told. */
function scriptedGod(replies: unknown[]): ChatModel & { asked: ChatRequest[] } {
  return {
    provider: 'gemini',
    model: 'gemini-test',
    asked: [],
    async complete(request) {
      this.asked.push(request);
      return { text: JSON.stringify(replies.shift() ?? { say: 'Hm.', wish: null }), inputTokens: 1, outputTokens: 1, usd: 0 };
    },
  };
}

describe('the Calling Wish', () => {
  const fireflies = { kind: 'skill', skill: 'piercing-arrow', name: 'Firefly Arrow', description: 'A swarm of fireflies streams down the line.', look: { hook: 'fireflies', body: 'a glowing stream', color: '#e8c170', mood: 'gentle' } };
  const offer = (definition: unknown) => ({ say: 'So it shall look.', wish: { tier: 'minor', title: 'Firefly Arrow', summary: 'Piercing Arrow becomes a swarm of fireflies.', definition } });

  it('is free at level 10, renames the skill, and refuses number changes', async () => {
    const god = scriptedGod([offer(fireflies), offer({ ...fireflies, name: 'Big Arrow', base: 99 })]);
    const { store, ws } = await start({ chat: () => [god] });
    const mara = account(store, 'Mara');
    store.accountById(mara.id)!.character = hero('ranger', 10, 'windeye');
    const favor = store.accountById(mara.id)!.character!.favor;
    const c = await joined(ws, mara.token);

    const answer = await pray(c, 'My Piercing Arrow should be a swarm of fireflies');
    expect(god.asked[0]!.system).toMatch(/Mara holds a Calling Wish\. Their skills: .*Piercing Arrow \(piercing-arrow\)/);
    expect(answer.card).toMatchObject({ tier: 'minor', cost: 0 });
    await c.send({ t: 'wish', card: answer.card!.id, confirm: true });
    const done = await c.waitFor<GodMessage>((m) => m.t === 'god' && /^It is done/.test((m as GodMessage).say));
    expect(done.say).toMatch(/Your Piercing Arrow is Firefly Arrow now/);
    const changed = await c.waitFor<CharacterMessage>((m) => m.t === 'character' && !!m.character.skillLooks);
    expect(changed.character.skillLooks!['piercing-arrow']).toMatchObject({ name: 'Firefly Arrow' });
    expect(changed.character).toMatchObject({ callingWishesUsed: 1, favor });
    expect(store.content.find((r) => r.definition?.kind === 'skill')).toMatchObject({ tier: 'minor', favor: 0, status: 'granted' });

    // A Calling Wish never changes numbers: the God's offer is turned down in words, with no card.
    const refused = await pray(c, 'And make it hit for 99');
    expect(refused.card).toBeUndefined();
    expect(refused.say).toBe(SKILL_NUMBERS_KEPT);
  });

  it('is not there before level 10', async () => {
    const god = scriptedGod([offer(fireflies)]);
    const { store, ws } = await start({ chat: () => [god] });
    const mara = account(store, 'Mara');
    const young = startCharacter('falcon', 'ranger');
    young.abilities.push('piercing-arrow');
    store.accountById(mara.id)!.character = young;
    const c = await joined(ws, mara.token);
    const answer = await pray(c, 'My Piercing Arrow should be fireflies');
    expect(god.asked[0]!.system).toMatch(/Mara holds no Calling Wish now/);
    expect(answer.card).toBeUndefined();
    expect(answer.say).toMatch(/level 10/);
  });
});

// --- One signature skill per Path -----------------------------------------------------

describe('Path signature skills', () => {
  it('Oakheart: Rooted Stand adds Armor, slows you, and keeps Stuns and Roots off', () => {
    const { region, use, me } = setup(hero('warden', 10, 'oakheart'));
    use('rooted-stand');
    expect(statusIds(region, 'a')).toContain('slowed');
    expect(region.afflict('a', 'stunned', 1)).toBe(false);
    expect(region.afflict('a', 'rooted', 1)).toBe(false);
    use('rooted-stand');
    expect(region.afflict('a', 'rooted', 1)).toBe(true);
    expect(me().path).toBe('oakheart');
  });

  it('Stonefist: Quake Leap leaps in and slows everything where you land', () => {
    const { region, foe, others, at, use } = setup(hero('warden', 10, 'stonefist'));
    const near = others[0]!;
    region.placeCreature(foe, at.x + 4, at.y);
    region.placeCreature(near, at.x + 4.5, at.y + 1);
    const [a, b] = [hp(region, foe), hp(region, near)];
    use('quake-leap', foe);
    expect(region.position('a')!.x).toBeGreaterThan(at.x + 2);
    expect(hp(region, foe)).toBeLessThan(a);
    expect(hp(region, near)).toBeLessThan(b);
    expect(statusIds(region, near)).toContain('slowed');
  });

  it('Sunblade: Execute does double damage to a creature under 30% health', () => {
    const { region, conn, foe, at, use, tick } = setup(hero('duelist', 10, 'sunblade'));
    region.placeCreature(foe, at.x + 1, at.y);
    const c = (region as unknown as { s: { creatures: { id: string; hp: number }[] } }).s.creatures.find((k) => k.id === foe)!;
    use('execute', foe);
    const first = of(conn, 'hit').at(-1)!.amount;
    tick(11);
    c.hp = 2_000;
    use('execute', foe);
    const second = of(conn, 'hit').at(-1)!.amount;
    expect(second).toBeGreaterThanOrEqual(first * 1.8);
  });

  it('Sandstorm: Mirage hides you, turns creatures away, and makes the next hit critical', () => {
    const { region, conn, foe, at, use, tick } = setup(hero('duelist', 10, 'sandstorm'));
    region.placeCreature(foe, at.x + 1, at.y);
    region.handle('a', { t: 'attack', target: foe });
    expect(region.creatureThreat(foe)!.aggro).toBe('a');
    const plain = of(conn, 'hit').at(-1)!.amount;
    tick(2);
    use('mirage');
    expect(statusIds(region, 'a')).toContain('hidden');
    expect(region.creatureThreat(foe)!.aggro).not.toBe('a');
    // The double of sand stands where they were, for players to see.
    tick(0.1);
    expect(of(conn, 'snapshot').at(-1)!.marks?.map((m) => m.asset)).toContain(SAND_DOUBLE_ART);
    region.handle('a', { t: 'attack', target: foe });
    expect(of(conn, 'hit').at(-1)!.amount).toBeGreaterThanOrEqual(Math.floor(plain * CRIT_MULTIPLIER) - 1);
  });

  it('Windeye: Piercing Arrow hits every creature in a line', () => {
    const { region, foe, others, at, use } = setup(hero('ranger', 10, 'windeye'));
    const behind = others[0]!;
    region.placeCreature(foe, at.x + 3, at.y);
    region.placeCreature(behind, at.x + 7, at.y);
    const [a, b] = [hp(region, foe), hp(region, behind)];
    use('piercing-arrow', foe);
    expect(hp(region, foe)).toBeLessThan(a);
    expect(hp(region, behind)).toBeLessThan(b);
  });

  it('Wildkin: Call Companion brings a spirit hawk that fights until sent home', () => {
    const { region, conn, foe, at, use, tick, me } = setup(hero('ranger', 10, 'wildkin'));
    region.placeCreature(foe, at.x + 3, at.y);
    use('call-companion');
    tick(1.5);
    expect(of(conn, 'hit').some((h) => h.ability === 'call-companion' && h.target === foe)).toBe(true);
    expect(of(conn, 'snapshot').at(-1)!.marks?.map((m) => m.asset)).toContain(SPIRIT_HAWK_ART);
    const energy = me().energy;
    use('call-companion');
    expect(notices(conn).at(-1)).toMatch(/hawk flies home/);
    // Sending it home costs nothing.
    expect(me().energy).toBeGreaterThanOrEqual(energy);
    const hits = of(conn, 'hit').length;
    tick(3);
    expect(of(conn, 'hit').filter((h) => h.ability === 'call-companion').length).toBe(of(conn, 'hit').slice(0, hits).filter((h) => h.ability === 'call-companion').length);
  });

  it('Stormcaller: Firestorm rains each second and sets creatures Burning', () => {
    const { region, conn, foe, at, use, tick } = setup(hero('wishweaver', 10, 'stormcaller'));
    region.placeCreature(foe, at.x + 4, at.y);
    // Held in the fire: the storm stays where it was cast, and a creature that walks out is spared.
    region.afflict(foe, 'rooted', 10);
    use('firestorm', foe);
    tick(0.5);
    expect(statusIds(region, foe)).toContain('burning');
    tick(4);
    expect(of(conn, 'hit').filter((h) => h.ability === 'firestorm').length).toBeGreaterThanOrEqual(3);
  });

  it('Threadbinder: Unravel strips a shield and Silences', () => {
    const { region, foe, at, use } = setup(hero('wishweaver', 10, 'threadbinder'));
    region.placeCreature(foe, at.x + 4, at.y);
    region.afflict(foe, 'shielded', 10, { amount: 5 });
    use('unravel', foe);
    expect(statusIds(region, foe)).toContain('silenced');
    expect(statusIds(region, foe)).not.toContain('shielded');
  });

  it('Dawnbell: Grace heals a little every second, and leaves an Echo', () => {
    const { region, use, tick, me } = setup(hero('bellkeeper', 10, 'dawnbell'));
    me().hp = 10;
    use('grace');
    expect(statusIds(region, 'a')).toContain('graced');
    expect(region.gauge('a')!.pips).toBe(1);
    const before = me().hp;
    tick(3);
    expect(me().hp).toBeGreaterThan(before);
    expect(me().hp).toBeLessThan(maxHp(me()));
  });

  it('Dirgebell: Knell makes a creature hit softer, take more, and heal whoever strikes it', () => {
    const { region, conn, foe, at, use, tick, me } = setup(hero('bellkeeper', 10, 'dirgebell'));
    region.placeCreature(foe, at.x + 1, at.y);
    region.handle('a', { t: 'attack', target: foe });
    const plain = of(conn, 'hit').at(-1)!.amount;
    tick(2);
    use('knell', foe);
    expect(statusIds(region, foe)).toContain('knelled');
    me().hp = 20;
    region.handle('a', { t: 'attack', target: foe });
    expect(of(conn, 'hit').at(-1)!.amount).toBeGreaterThanOrEqual(plain);
    expect(me().hp).toBeGreaterThanOrEqual(20 + Math.round(maxHp(me()) * 0.02) - 1);
  });
});

