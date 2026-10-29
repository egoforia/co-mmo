import { afterEach, describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CREATURES,
  TICK_SECONDS,
  collides,
  maxHp,
  newCharacter,
  regionDef,
  type AbilityDef,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { chooseTarget, HEAL_THREAT, type Threatened } from '../src/threat.ts';

// Threat and targeting (docs/attributes.md; docs/callings-build-plan.md,
// step 5): creatures fight whoever threatens them most, healers draw threat,
// taunts force the target, and the server checks the target players choose.

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const hits = (c: { messages: ServerMessage[] }) => c.messages.filter((m): m is Extract<ServerMessage, { t: 'hit' }> => m.t === 'hit');

const taught: string[] = [];
afterEach(() => {
  for (const id of taught.splice(0)) delete ABILITIES[id];
});

/** A made-up ability for one test, with plain numbers. */
function ability(effect: AbilityDef['effect'], more: Partial<AbilityDef> = {}): string {
  const id = `test-${effect}-${taught.length}`;
  ABILITIES[id] = { name: `Test ${effect}`, description: 'For a test.', effect, energy: 0, cooldown: 0, range: 5, base: 2, stat: 'might', factor: 0, ...more };
  taught.push(id);
  return id;
}

/**
 * Mara (a) and Tolle (b), one party, on open shore ground beside a Crab
 * Knight (a creature that fights back rather than running), the rest of the
 * region's creatures sent far away.
 */
function setup(abilities: string[] = []) {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef('shore')!, { worldChat: () => undefined, online: () => 2, party: () => ['a', 'b'] }, () => clock.now, () => 0.5);
  const conns = { a: fakeConn(), b: fakeConn() };
  for (const id of ['a', 'b'] as const) {
    const ch = newCharacter();
    ch.abilities.push(...abilities);
    region.join(info(id, id === 'a' ? 'Mara' : 'Tolle'), conns[id], { x: null, y: null }, ch);
  }
  const at = openGround(region);
  region.placePlayer('a', at.x, at.y);
  region.placePlayer('b', at.x - 1, at.y);
  const ids = region.creatureIds();
  const foe = ids.find((id) => CREATURES[region.creature(id)!.kind]?.behavior === 'patrol')!;
  const others = ids.filter((id) => id !== foe);
  others.forEach((id, i) => region.placeCreature(id, at.x + 40 + i, at.y + 40));
  region.placeCreature(foe, at.x + 1, at.y);
  const tick = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / TICK_SECONDS); i++) {
      clock.now += TICK_SECONDS * 1000;
      region.tick();
    }
  };
  const use = (who: 'a' | 'b', id: string, target?: string) => region.handle(who, { t: 'ability', ability: id, ...(target ? { target } : {}) });
  const mind = () => region.creatureThreat(foe)!;
  return { region, clock, conns, foe, others, at, tick, use, mind, ch: (id: 'a' | 'b') => region.character(id)! };
}

/** Open ground near the spawn with room on every side. */
function openGround(region: Region): { x: number; y: number } {
  const start = region.position('a')!;
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(start.x) + dx + 0.5;
        const y = Math.floor(start.y) + dy + 0.5;
        let clear = true;
        for (let sx = -2; sx <= 6 && clear; sx += 0.5) for (let sy = -2; sy <= 2 && clear; sy += 0.5) clear = !collides(region.map, x + sx, y + sy);
        if (clear) return { x, y };
      }
    }
  }
  throw new Error('no open ground');
}

describe('threat', () => {
  it('a heal draws threat to the healer: half the healing, from every creature fighting the one healed', () => {
    const bolt = ability('bolt');
    const mend = ability('heal', { base: 10, stat: 'spirit' });
    const s = setup([bolt, mend]);
    s.use('a', bolt);
    expect(s.mind().aggro).toBe('a');
    const dealt = s.mind().threat.a!;
    expect(dealt).toBeGreaterThan(0);
    s.ch('a').hp = 5;
    s.use('b', mend);
    const healed = s.ch('a').hp - 5;
    expect(healed).toBeGreaterThan(0);
    expect(s.mind().threat.b).toBeCloseTo(healed * HEAL_THREAT, 5);
    // Healing far more than Mara's blows were worth: it turns on the healer.
    expect(s.mind().threat.b!).toBeGreaterThan(dealt * 1.1);
    s.tick(TICK_SECONDS);
    expect(s.mind().aggro).toBe('b');
  });

  it('damage is threat, times what the ability says', () => {
    const plain = ability('bolt');
    const bash = ability('bolt', { threat: 3 });
    const s = setup([plain, bash]);
    s.use('a', plain);
    s.use('b', bash);
    const blows = hits(s.conns.a).filter((h) => h.target === s.foe);
    expect(s.mind().threat.a).toBeCloseTo(blows[0]!.amount, 5);
    expect(s.mind().threat.b).toBeCloseTo(blows[1]!.amount * 3, 5);
  });

  it('a creature switches target only when another has more than 10% more threat', () => {
    const c: Threatened = { aggro: 'a', respawnAt: null, threat: { a: 100, b: 110 }, statuses: [] };
    const standing = () => true;
    expect(chooseTarget(c, standing, 0)).toBe('a');
    c.threat.b = 110.5;
    expect(chooseTarget(c, standing, 0)).toBe('b');
  });

  it('in the region too: a little more threat is not enough to turn it', () => {
    const bolt = ability('bolt');
    const s = setup([bolt]);
    s.use('a', bolt);
    s.use('b', bolt);
    s.use('b', bolt);
    s.tick(TICK_SECONDS);
    // Tolle has dealt twice Mara's damage now.
    expect(s.mind().aggro).toBe('b');
    s.use('a', bolt);
    s.tick(TICK_SECONDS);
    // Level with Tolle: Mara needs 10% more than that.
    expect(s.mind().aggro).toBe('b');
  });

  it('a taunt forces the target for 4 s, whatever the threat, then threat decides again', () => {
    const bolt = ability('bolt', { base: 6 });
    const taunt = ability('taunt', { radius: 3 });
    const s = setup([bolt, taunt]);
    s.use('a', bolt);
    s.tick(TICK_SECONDS);
    expect(s.mind().aggro).toBe('a');
    s.use('b', taunt);
    expect(s.mind().aggro).toBe('b');
    for (let i = 0; i < 3; i++) s.use('a', bolt);
    s.tick(3.5);
    expect(s.mind().threat.a!).toBeGreaterThan((s.mind().threat.b ?? 0) * 1.1);
    expect(s.mind().aggro).toBe('b');
    s.tick(1);
    expect(s.mind().aggro).toBe('a');
  });

  it('a Fallen player is passed over: it turns to the next with threat instead of going home', () => {
    const bolt = ability('bolt');
    const s = setup([bolt]);
    s.use('a', bolt);
    s.use('a', bolt);
    s.use('b', bolt);
    s.tick(TICK_SECONDS);
    expect(s.mind().aggro).toBe('a');
    s.ch('a').hp = 1;
    s.ch('a').stats.agility = 0;
    s.tick(4);
    expect(s.ch('a').hp).toBe(0);
    expect(s.mind().aggro).toBe('b');
    expect(s.mind().threat.a).toBeUndefined();
  });
});

describe('targeting', () => {
  it('a plain attack goes to the chosen creature in reach, else falls back to the nearest', () => {
    const s = setup();
    const far = s.others[0]!;
    s.region.placeCreature(far, s.at.x + 1, s.at.y + 0.6);
    s.region.handle('a', { t: 'attack', target: far });
    expect(hits(s.conns.a).at(-1)?.target).toBe(far);
    s.region.placeCreature(far, s.at.x + 6, s.at.y);
    s.clock.now += 5000;
    s.region.handle('a', { t: 'attack', target: far });
    expect(hits(s.conns.a).at(-1)?.target).toBe(s.foe);
  });

  it('an ability at a creature out of range falls back to the nearest in range', () => {
    const bolt = ability('bolt', { range: 3 });
    const s = setup([bolt]);
    const far = s.others[0]!;
    s.region.placeCreature(far, s.at.x + 6, s.at.y);
    s.use('a', bolt, far);
    expect(hits(s.conns.a).at(-1)?.target).toBe(s.foe);
  });

  it('a heal with nobody chosen goes to the most hurt ally in range', () => {
    const mend = ability('heal', { base: 10, stat: 'spirit' });
    const s = setup([mend]);
    s.ch('a').hp = Math.round(maxHp(s.ch('a')) * 0.5);
    s.ch('b').hp = Math.round(maxHp(s.ch('b')) * 0.8);
    const [a, b] = [s.ch('a').hp, s.ch('b').hp];
    s.use('b', mend);
    expect(s.ch('a').hp).toBeGreaterThan(a);
    expect(s.ch('b').hp).toBe(b);
  });

  it('a heal goes to the ally chosen, but not past its range', () => {
    const mend = ability('heal', { base: 10, stat: 'spirit', range: 3 });
    const s = setup([mend]);
    s.ch('a').hp = 10;
    s.ch('b').hp = 20;
    s.use('a', mend, 'b');
    expect(s.ch('b').hp).toBeGreaterThan(20);
    s.ch('b').hp = 20;
    s.region.placePlayer('b', s.at.x - 5, s.at.y);
    s.use('a', mend, 'b');
    expect(s.ch('b').hp).toBe(20);
    expect(s.ch('a').hp).toBeGreaterThan(10);
  });

  it('a heal with no range mends only you', () => {
    const mend = ability('heal', { base: 10, stat: 'spirit', range: 0 });
    const s = setup([mend]);
    s.ch('a').hp = 10;
    s.ch('b').hp = 20;
    s.use('b', mend);
    expect(s.ch('a').hp).toBe(10);
    expect(s.ch('b').hp).toBeGreaterThan(20);
  });
});
