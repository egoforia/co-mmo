import { describe, expect, it } from 'vitest';
import {
  CREATURES,
  ITEMS,
  MONSTER_SKILLS,
  TICK_RATE,
  Tile,
  copyBase,
  generateRegion,
  monsterHeld,
  newCharacter,
  regionDef,
  rollKit,
  skillsOf,
  statusOf,
  validMonsterSkills,
  validateDefinition,
  wornPower,
  type CreatureDef,
  type MonsterSkill,
  type PlayerInfo,
  type RegionMap,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { damageOf, defenceOf, makeCreature, think, type Creature, type Habitat, type Prey } from '../src/creature-brain.ts';
import { useMonsterSkill, type SkillWorld } from '../src/region/monster-skills.ts';
import type { MonsterBlow } from '../src/region/minds.ts';
import type { PlayerState, RegionState } from '../src/region/state.ts';

// Monsters with gear and skills (combat decisions, step 7): loot is rolled
// when a monster appears and its gear is worn, adding power; skills are the
// players' effects with plain numbers.

const sure = (item: string) => ({ item, chance: 1 });

describe('monster gear', () => {
  it('rolls its loot when it appears: gear among it is worn, and all of it is carried', () => {
    const kit = rollKit('bark-golem', { drops: [sure('golem-club'), sure('tonic')] }, () => 0.5);
    expect(copyBase(kit.worn.weapon!)).toBe('golem-club');
    expect(kit.carried.map((s) => copyBase(s.item))).toEqual(['golem-club', 'tonic']);
    expect(monsterHeld(kit.worn)).toEqual({ held: kit.worn.weapon });
    // Nothing rolled, nothing worn.
    expect(rollKit('bark-golem', { drops: [{ item: 'golem-club', chance: 0.01 }] }, () => 0.5)).toEqual({ worn: {}, carried: [] });
  });

  it('worn gear adds its power: a weapon to its blows, armour to its Armor', () => {
    const def = CREATURES['bark-golem']!;
    const bare = makeCreature('g', 'bark-golem', { ...def, drops: [] }, 10, 10, () => 0.5);
    const armed = makeCreature('g', 'bark-golem', { ...def, drops: [sure('golem-club')] }, 10, 10, () => 0.5);
    expect(damageOf(bare)).toBe(def.damage);
    expect(damageOf(armed)).toBe(def.damage + wornPower(armed.kit.worn).attack);
    expect(wornPower(armed.kit.worn).attack).toBeGreaterThan(0);
    expect(defenceOf(bare, 'physical')).toBe(def.armor ?? 0);
    ITEMS['test-helm'] = { name: 'Test Helm', kind: 'equipment', art: 'x', description: '', slot: 'head', bonus: { armor: 4, ward: 2 } };
    try {
      armed.kit.worn.head = 'test-helm';
      expect(defenceOf(armed, 'physical')).toBe((def.armor ?? 0) + 4);
      expect(defenceOf(armed, 'arcane')).toBe((def.ward ?? 0) + 2);
    } finally {
      delete ITEMS['test-helm'];
    }
  });

  it('its body holds what it carried, and it comes back with new gear', () => {
    const clock = { now: 1_000_000 };
    const region = new Region(regionDef('woods')!, undefined, () => clock.now, () => 0.5);
    region.map.safe = [];
    const conn: Connection = { send() {}, close() {} };
    region.join({ id: 'a', name: 'Mara', color: 0xffffff, role: 'player' } satisfies PlayerInfo, conn, { x: null, y: null }, newCharacter());
    const id = region.creatureIds().find((c) => c.includes('walking-mushroom'))!;
    const saved = CREATURES['walking-mushroom']!.drops;
    CREATURES['walking-mushroom']!.drops = [sure('golem-club')];
    try {
      region.rearm(id);
      const me = region.position('a')!;
      region.placeCreature(id, me.x + 1, me.y);
      while (region.creature(id)!.alive) {
        region.handle('a', { t: 'attack' });
        clock.now += 1000;
      }
      const [body] = region.bodyList();
      expect(body!.loot.map((s) => copyBase(s.item))).toContain('golem-club');
    } finally {
      CREATURES['walking-mushroom']!.drops = saved;
    }
  });
});

/** Open ground everywhere, no safe areas. */
function openMap(): RegionMap {
  const map = generateRegion(regionDef('shore')!);
  map.tiles.fill(Tile.Ground);
  Object.assign(map, { buildings: [], storeys: [], stairways: [], spots: [], npcs: [], creatures: [], landmarks: [], safe: [] });
  return map;
}

function monster(skills: MonsterSkill[], more: Partial<CreatureDef> = {}): Creature {
  const def: CreatureDef = { ...CREATURES['walking-mushroom']!, behavior: 'chase', notice: 8, speed: 0.01, damage: 3, hp: 100, cooldown: 1, active: 'always', drops: [], skills, ...more };
  return makeCreature('m', 'test-monster', def, 50.5, 50.5, () => 0.5);
}

describe('monster skills', () => {
  it('uses a ready skill that reaches on its attack beat, then waits out its cooldown', () => {
    const c = monster([{ name: 'Spit', effect: 'bolt', power: 9, cooldown: 5, range: 5 }]);
    const p: Prey = { id: 'a', x: 54.5, y: 50.5, floor: 0, alive: true, lit: false };
    const used: string[] = [];
    let tick = 0;
    const h = (): Habitat => ({
      map: openMap(), now: 1_000_000 + (tick * 1000) / TICK_RATE, tick, random: () => 0.5, phase: 0.5, weather: 'clear', players: [p], creatures: [c],
      hurt: () => used.push('blow'),
      skill: (_c, s) => (used.push(s.name), true),
    });
    c.aggro = 'a';
    c.threat = { a: 1 };
    for (; tick < TICK_RATE * 6; tick++) think(c, h());
    // Four tiles off: no plain blow reaches, the Spit does, once in five seconds (twice in six).
    expect(used).toEqual(['Spit', 'Spit']);
  });

  it('each kind has fitting skills; a wish brings its own, checked', () => {
    expect(skillsOf('chained-demon', CREATURES['chained-demon']!).map((s) => s.effect)).toEqual(['area', 'line']);
    expect(skillsOf('walking-mushroom', CREATURES['walking-mushroom']!)).toEqual([]);
    for (const [kind, skills] of Object.entries(MONSTER_SKILLS)) {
      expect(CREATURES[kind], kind).toBeDefined();
      expect(validMonsterSkills(skills), kind).toHaveLength(skills.length);
    }
    expect(validMonsterSkills([{ name: 'Nap', effect: 'snooze', power: 3 }, { name: 'Sting', effect: 'bolt', power: 9999, status: 'graced' }])).toEqual([
      { name: 'Sting', effect: 'bolt', power: 200, cooldown: 8, range: 5 },
    ]);
    const wish = validateDefinition({ kind: 'creature', name: 'Bog Crab', description: 'A crab of the bog.', behavior: 'chase', level: 2, count: 2, drops: [], look: 'A small crab.', skills: [{ name: 'Pinch', effect: 'strike', power: 6, cooldown: 4, range: 1 }] });
    expect(wish).toMatchObject({ skills: [{ name: 'Pinch', effect: 'strike' }] });
  });
});

/** A small world for one skill: players by id, its monsters, and every blow written down. */
function world(players: PlayerState[], creatures: Creature[]) {
  const blows: { p: string; blow: MonsterBlow }[] = [];
  const told: string[] = [];
  const now = 1_000_000;
  const s = { map: openMap(), now: () => now, players: new Map(players.map((p) => [p.info.id, p])), creatures, notice: (p: PlayerState, text: string) => told.push(`${p.info.id}: ${text}`) } as unknown as RegionState;
  const w: SkillWorld = { s, hurt: (p, _c, _now, blow) => blows.push({ p: p.info.id, blow }), hidden: () => false };
  return { w, blows, told, now };
}

function player(id: string, x: number, y: number): PlayerState {
  return { info: { id, name: id, color: 0, role: 'player' }, character: newCharacter(), x, y, floor: 0, statuses: [] } as unknown as PlayerState;
}

describe('monster skill effects', () => {
  const at = { x: 50.5, y: 50.5 };

  it('a cone hits everyone in front of it, not behind; an area everyone round its target', () => {
    const c = monster([]);
    const front = player('front', at.x + 1, at.y);
    const side = player('side', at.x + 1, at.y + 0.5);
    const behind = player('behind', at.x - 1, at.y);
    const { w, blows, told, now } = world([front, side, behind], [c]);
    expect(useMonsterSkill(w, c, { name: 'Sweep', effect: 'cone', power: 6, cooldown: 8, range: 1 }, front, now)).toBe(true);
    expect(blows.map((b) => b.p).sort()).toEqual(['front', 'side']);
    expect(told).toContain('front: The Walking Mushroom uses Sweep!');
    blows.length = 0;
    useMonsterSkill(w, c, { name: 'Slam', effect: 'area', power: 6, cooldown: 8, range: 1, radius: 2 }, front, now);
    expect(blows.map((b) => b.p).sort()).toEqual(['behind', 'front', 'side']);
  });

  it('a bolt is arcane unless it says, and its status lands on whoever it hits', () => {
    const c = monster([]);
    const p = player('a', at.x + 3, at.y);
    const { w, blows, now } = world([p], [c]);
    useMonsterSkill(w, c, { name: 'Frost Bolt', effect: 'bolt', power: 8, cooldown: 6, range: 5, status: 'slowed' }, p, now);
    expect(blows[0]!.blow).toEqual({ amount: 8, type: 'arcane', close: false });
    expect(statusOf(p, 'slowed', now)).toBeDefined();
  });

  it("a physical skill adds its worn weapon, as a player's does", () => {
    const c = monster([], { drops: [sure('golem-club')] });
    const p = player('a', at.x + 1, at.y);
    const { w, blows, now } = world([p], [c]);
    useMonsterSkill(w, c, { name: 'Smash', effect: 'strike', power: 5, cooldown: 6, range: 1 }, p, now);
    expect(blows[0]!.blow.amount).toBe(5 + wornPower(c.kit.worn).attack);
    expect(blows[0]!.blow.close).toBe(true);
  });

  it('a dash leaps beside its target; a heal finds the most hurt and is not spent with no one hurt', () => {
    const c = monster([]);
    const p = player('a', at.x + 4, at.y);
    const kin = monster([]);
    const { w, now } = world([p], [c, kin]);
    expect(useMonsterSkill(w, c, { name: 'Lunge', effect: 'dash', power: 8, cooldown: 9, range: 4 }, p, now)).toBe(true);
    expect(c.x).toBeCloseTo(at.x + 3, 5);
    const mend: MonsterSkill = { name: 'Mend', effect: 'heal', power: 30, cooldown: 15, range: 4 };
    expect(useMonsterSkill(w, c, mend, p, now)).toBe(false);
    kin.hp = 20;
    c.hp = 50;
    expect(useMonsterSkill(w, c, mend, p, now)).toBe(true);
    expect(kin.hp).toBe(50);
    expect(c.hp).toBe(50);
  });

  it('a shield, a stance and a buff go on itself once at a time; a cleanse needs something to shake off', () => {
    const c = monster([]);
    const p = player('a', at.x + 1, at.y);
    const { w, now } = world([p], [c]);
    expect(useMonsterSkill(w, c, { name: 'Hide', effect: 'shield', power: 30, cooldown: 20, range: 1 }, p, now)).toBe(true);
    expect(statusOf(c, 'shielded', now)?.amount).toBe(30);
    expect(useMonsterSkill(w, c, { name: 'Hide', effect: 'shield', power: 30, cooldown: 20, range: 1 }, p, now)).toBe(false);
    expect(useMonsterSkill(w, c, { name: 'Brace', effect: 'stance', power: 90, cooldown: 15, range: 1 }, p, now)).toBe(true);
    expect(statusOf(c, 'guarded', now)?.amount).toBe(60);
    expect(useMonsterSkill(w, c, { name: 'Rage', effect: 'buff', power: 5, cooldown: 15, range: 1 }, p, now)).toBe(true);
    expect(damageOf(c, now)).toBe(c.def.damage + 5);
    expect(damageOf(c, now + 7000)).toBe(c.def.damage);
    const clean: MonsterSkill = { name: 'Shake', effect: 'cleanse', power: 0, cooldown: 15, range: 1 };
    expect(useMonsterSkill(w, c, clean, p, now)).toBe(false);
    c.statuses.push({ id: 'burning', until: now + 3000, amount: 2 });
    expect(useMonsterSkill(w, c, clean, p, now)).toBe(true);
    expect(c.statuses.some((x) => x.id === 'burning')).toBe(false);
  });

  it('a war cry calls idle monsters near it to its target; a summons only its own kind', () => {
    const c = monster([]);
    const near = monster([]);
    const p = player('a', at.x + 1, at.y);
    const { w, now } = world([p], [c, near]);
    expect(useMonsterSkill(w, c, { name: 'Howl', effect: 'taunt', power: 0, cooldown: 25, range: 1 }, p, now)).toBe(true);
    expect(near.aggro).toBe('a');
    near.aggro = null;
    near.kind = 'other-kind';
    expect(useMonsterSkill(w, c, { name: 'Call', effect: 'summon', power: 0, cooldown: 25, range: 1 }, p, now)).toBe(false);
  });

  it('never hits a player in a safe area', () => {
    const c = monster([]);
    const safe = player('safe', at.x + 1, at.y);
    const out = player('out', at.x - 1, at.y);
    const { w, blows, now } = world([safe, out], [c]);
    w.s.map.safe = [{ x: at.x + 1, y: at.y, radius: 0 }];
    useMonsterSkill(w, c, { name: 'Slam', effect: 'area', power: 6, cooldown: 8, range: 1, radius: 3 }, out, now);
    expect(blows.map((b) => b.p)).toEqual(['out']);
  });
});
