import { describe, expect, it } from 'vitest';
import {
  GAUGE_MAX,
  TICK_SECONDS,
  chooseCalling,
  coreSkillsFor,
  maxEnergy,
  maxHp,
  newCharacter,
  regionDef,
  type CallingId,
  type Character,
  type PlayerInfo,
  type ServerMessage,
  type WelcomeMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { account, connect, start } from './helpers.ts';

// Calling core skills in play (docs/callings-build-plan.md, step 7a): each
// Calling's gauge-spending skill, the hotbar the server keeps, and the
// skills characters saved before them find on joining.

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const of = <T extends ServerMessage['t']>(c: { messages: ServerMessage[] }, t: T) =>
  c.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
const notices = (c: { messages: ServerMessage[] }) => of(c, 'notice').map((m) => m.text);

/** A character of this Calling at this level, knowing its core skills. */
function hero(calling: CallingId, level: number): Character {
  const c = newCharacter();
  c.level = level;
  chooseCalling(c, 'ursine', calling);
  c.hp = maxHp(c);
  c.energy = maxEnergy(c);
  return c;
}

/**
 * Mara of a Calling and level in a region (Tolle, in her party, may join
 * too), with every creature sent far off but `foe` and `second`, which
 * `near()` brings beside her. Dice roll the middle.
 */
function setup(calling: CallingId, level: number, regionId = 'woods') {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef(regionId)!, { worldChat: () => undefined, online: () => 2, party: () => ['a', 'b'] }, () => clock.now, () => 0.5);
  const conn = fakeConn();
  region.join(info('a', 'Mara'), conn, { x: null, y: null }, hero(calling, level));
  const me = () => region.character('a')!;
  const at = region.position('a')!;
  const [foe, second, ...rest] = region.creatureIds();
  for (const id of [foe!, second!, ...rest]) region.placeCreature(id, at.x + 40, at.y + 40);
  const tick = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
      clock.now += TICK_SECONDS * 1000;
      region.tick();
    }
  };
  const near = () => region.placeCreature(foe!, at.x + 1, at.y);
  const attack = () => {
    clock.now += 2000;
    region.handle('a', { t: 'attack' });
  };
  const use = (id: string, target?: string) => {
    clock.now += 1100;
    region.handle('a', { t: 'ability', ability: id, ...(target ? { target } : {}) });
  };
  const pips = () => region.gauge('a')?.pips ?? 0;
  const takeHit = () => {
    const before = of(conn, 'hit').filter((h) => h.target === 'a').length;
    for (let ticks = 0; ticks < 100 && of(conn, 'hit').filter((h) => h.target === 'a').length === before; ticks++) tick(TICK_SECONDS);
  };
  const lastHit = () => of(conn, 'hit').filter((h) => h.by === 'a').at(-1)!.amount;
  const shieldSize = () => Number(/shields you from (\d+)/.exec(notices(conn).at(-1)!)![1]);
  return { region, clock, conn, at, foe: foe!, second: second!, me, tick, near, attack, use, pips, takeHit, lastHit, shieldSize };
}

describe('each Calling spends its gauge', () => {
  it('Warden: Bulwark spends all Resolve, half again as strong for each pip', () => {
    const fresh = setup('warden', 4, 'desert');
    fresh.use('bulwark');
    const plain = fresh.shieldSize();
    const t = setup('warden', 4, 'desert');
    t.near();
    t.takeHit();
    t.takeHit();
    expect(t.pips()).toBe(2);
    t.use('bulwark');
    expect(Math.abs(t.shieldSize() - plain * 2)).toBeLessThanOrEqual(1);
    expect(t.pips()).toBe(0);
  });

  it('Warden: Challenge taunts what is near and gives a pip of Resolve for each', () => {
    const t = setup('warden', 2);
    t.near();
    t.region.placeCreature(t.second, t.at.x, t.at.y + 1);
    t.use('challenge');
    expect(t.pips()).toBe(2);
    expect(t.region.statusesOf(t.foe).map((s) => s.id)).toContain('taunted');
  });

  it('Duelist: Whirl spends all Momentum and grows with it', () => {
    const fresh = setup('duelist', 4, 'desert');
    fresh.near();
    fresh.use('whirl');
    const plain = fresh.lastHit();
    const t = setup('duelist', 4, 'desert');
    t.near();
    t.attack();
    t.attack();
    expect(t.pips()).toBe(2);
    t.use('whirl');
    expect(t.lastHit()).toBeGreaterThan(plain);
    expect(t.pips()).toBe(0);
  });

  it('Duelist: Riposte turns the next blow aside, strikes back and gives 2 Momentum', () => {
    const t = setup('duelist', 2, 'desert');
    t.use('riposte');
    expect(t.pips()).toBe(2);
    const hp = t.me().hp;
    t.near();
    for (let i = 0; i < 60 && !of(t.conn, 'hit').some((h) => h.ability === 'riposte'); i++) t.tick(TICK_SECONDS);
    expect(of(t.conn, 'hit').find((h) => h.ability === 'riposte')).toMatchObject({ by: 'a', target: t.foe });
    expect(t.me().hp).toBe(hp);
  });

  it('Ranger: Aimed Shot spends all Focus and hits harder for it', () => {
    const fresh = setup('ranger', 1);
    fresh.near();
    fresh.use('aimed-shot');
    const plain = fresh.lastHit();
    const t = setup('ranger', 1);
    t.tick(5);
    expect(t.pips()).toBe(GAUGE_MAX);
    t.near();
    t.use('aimed-shot');
    expect(t.lastHit()).toBeGreaterThan(plain * 1.5);
    expect(t.pips()).toBe(0);
  });

  it('Wishweaver: three threads in turn make Ember Bolt Woven, and its burn spreads', () => {
    const t = setup('wishweaver', 6, 'desert');
    t.near();
    t.region.placeCreature(t.second, t.at.x + 2, t.at.y);
    t.use('ember-bolt', t.foe);
    t.use('tide-lash', t.foe);
    t.near();
    t.region.placeCreature(t.second, t.at.x + 2, t.at.y);
    t.use('chain-spark', t.foe);
    expect(t.pips()).toBe(3);
    // Two fresh creatures: the Woven bolt burns one, and the burn spreads to the other.
    const [, , third, fourth] = t.region.creatureIds();
    for (const id of [t.foe, t.second]) t.region.placeCreature(id, t.at.x + 40, t.at.y + 40);
    t.region.placeCreature(third!, t.at.x + 1, t.at.y);
    t.region.placeCreature(fourth!, t.at.x + 2.5, t.at.y);
    t.clock.now += 3000;
    t.use('ember-bolt', third);
    expect(t.pips()).toBe(0);
    expect(of(t.conn, 'hit').at(-1)).toMatchObject({ by: 'a', target: third, ability: 'ember-bolt' });
    expect(t.region.statusesOf(fourth!).find((s) => s.id === 'burning')).toBeDefined();
  });

  it('Bellkeeper: Mend leaves an Echo and Toll rings it for half', () => {
    const t = setup('bellkeeper', 4);
    t.region.updateCharacter('a', (c) => { c.hp = 1; });
    t.use('bell-mend');
    const healed = t.me().hp - 1;
    expect(t.pips()).toBe(1);
    const before = t.me().hp;
    t.use('toll');
    expect(t.me().hp - before).toBe(Math.round(healed / 2));
    expect(t.pips()).toBe(0);
  });

  it('Bellkeeper: Peal of Waking raises a Fallen friend where they lie', () => {
    const t = setup('bellkeeper', 8);
    const tolle = fakeConn();
    t.region.join(info('b', 'Tolle'), tolle, { x: t.at.x + 1, y: t.at.y }, hero('warden', 1));
    t.region.updateCharacter('b', (c) => { c.hp = 0; });
    t.tick(TICK_SECONDS);
    expect(t.region.isFallen('b')).toBe(true);
    t.use('peal-of-waking');
    expect(t.region.isFallen('b')).toBe(false);
    const tolleNow = t.region.character('b')!;
    expect(tolleNow.hp).toBe(Math.round(maxHp(tolleNow) * 0.25));
    expect(notices(t.conn)).toContain('You raised Tolle.');
  });
});

describe('the hotbar on the server', () => {
  it('saves a layout of known skills and refuses unknown ones', () => {
    const t = setup('warden', 4);
    t.region.handle('a', { t: 'hotbar', slots: ['bulwark', '', 'shield-bash', '', '', 'challenge'] });
    expect(t.me().hotbar).toEqual(['bulwark', '', 'shield-bash', '', '', 'challenge']);
    expect(of(t.conn, 'character').at(-1)!.character.hotbar).toEqual(['bulwark', '', 'shield-bash', '', '', 'challenge']);
    t.region.handle('a', { t: 'hotbar', slots: ['whirl'] });
    expect(notices(t.conn).at(-1)).toBe('You can only put abilities you know on your hotbar.');
    expect(t.me().hotbar).toEqual(['bulwark', '', 'shield-bash', '', '', 'challenge']);
  });
});

describe('characters saved before core skills', () => {
  it('learn the core skills for their level when they next join', async () => {
    const { store, ws } = await start();
    const mara = account(store, 'Mara');
    const old = { ...hero('ranger', 6), abilities: ['power-strike'] } as Partial<Character>;
    delete old.hotbar;
    store.accountById(mara.id)!.character = old as Character;
    const welcome = await connect(ws, mara.token).waitFor<WelcomeMessage>((m) => m.t === 'welcome');
    expect(welcome.character.abilities).toEqual(['power-strike', ...coreSkillsFor('ranger', 6)]);
    expect(welcome.character.hotbar).toEqual(['power-strike', 'aimed-shot', 'tumble', 'snare-trap', 'volley', '']);
  });

  it('are told of a new skill when a level teaches one', () => {
    const t = setup('ranger', 1);
    t.region.grantXp('a', 30);
    expect(t.me().abilities).toContain('tumble');
    expect(notices(t.conn)).toContain('You learned Tumble. It is on the 2 key.');
  });
});
