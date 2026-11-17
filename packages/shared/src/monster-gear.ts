import { ownPieces } from './copies.ts';
import { lootTable } from './loot.ts';
import { ABILITY_EFFECTS, type AbilityEffect } from './rpg/abilities.ts';
import { STATUSES, type StatusId } from './rpg/statuses.ts';
import { ITEMS, gearBonus, rollDrops, type CreatureDef, type EquipSlot, type InventorySlot } from './rpg.ts';

// Monsters with gear and skills (combat decisions, step 7). A monster's loot
// is rolled when it appears, not when it falls: what it will drop it carries
// all its life, and the gear among it is worn and adds its power. Its skills
// are plain data built from the same effects players' skills use.

/** What a monster wears, by slot, and everything it carries (worn pieces too), rolled when it appears. */
export interface MonsterKit {
  worn: Partial<Record<EquipSlot, string>>;
  carried: InventorySlot[];
}

/**
 * Rolls what a monster carries from its kind's loot table (with its spawn's
 * own extras, `def.drops`), as the body would have held it. Each piece of
 * gear becomes its own found copy, and the first for each slot is worn.
 */
export function rollKit(kind: string, def: Pick<CreatureDef, 'drops'>, random: () => number): MonsterKit {
  const carried = ownPieces(rollDrops(lootTable(kind, def.drops), random), random);
  const worn: MonsterKit['worn'] = {};
  for (const s of carried) {
    const slot = ITEMS[s.item]?.slot;
    if (slot && !worn[slot]) worn[slot] = s.item;
  }
  return { worn, carried };
}

/** What a monster's worn gear adds to its blows, its Armor and its Ward. */
export function wornPower(worn: MonsterKit['worn']): { attack: number; armor: number; ward: number } {
  const c = { equipment: worn };
  return { attack: gearBonus(c, 'attack'), armor: gearBonus(c, 'armor'), ward: gearBonus(c, 'ward') };
}

/** The item a monster shows in its right hand (its weapon, else its charm) and its left (an off-hand item). */
export function monsterHeld(worn: MonsterKit['worn']): { held?: string; offHeld?: string } {
  const held = worn.weapon ?? worn.charm;
  return { ...(held ? { held } : {}), ...(worn.offhand ? { offHeld: worn.offhand } : {}) };
}

/**
 * One of a monster's skills: an effect from the players' kit and plain
 * numbers. Damage effects hurt by `power` (its worn weapon adds to the
 * physical ones); heal and shield give `power`.
 */
export interface MonsterSkill {
  /** What players are told it used. */
  name: string;
  effect: AbilityEffect;
  power: number;
  /** Seconds before it can use it again. */
  cooldown: number;
  /** Tiles to its target: 1 is a touching tile. */
  range: number;
  /** Area, trap and call skills: tiles round the spot; cones and lines reach `range`. */
  radius?: number;
  /** A status it puts on whoever it hits (or on itself, for buff and stance). */
  status?: StatusId;
  /** How long the status lasts; its usual length when missing. */
  seconds?: number;
  /** Arcane hits are softened by Ward and cannot be dodged; physical ones by Armor. Bolts are arcane unless said. */
  type?: 'physical' | 'arcane';
}

/** What each effect does when a monster uses it, in plain words (God's prompt and docs/combat.md). */
export const MONSTER_EFFECT_WORDS: Record<AbilityEffect, string> = {
  strike: 'a heavy blow at its target up close',
  bolt: 'a shot at its target from afar',
  heal: 'heals itself or the most hurt monster near it',
  area: 'hits everyone round its target',
  cone: 'hits everyone in front of it',
  line: 'hits everyone in a line toward its target',
  dash: 'leaps to its target and strikes',
  blink: 'vanishes from beside its target and appears a few tiles away',
  shield: 'shields itself',
  buff: 'gives itself a helpful status',
  debuff: 'puts a harmful status on its target',
  taunt: 'calls every monster near it to fight its target',
  trap: 'roots its target where they stand and hurts them',
  summon: 'calls its own kind from farther round to help',
  stance: 'braces itself, taking less from every blow',
  cleanse: 'shakes off its harmful statuses',
};

/** Effects whose `power` is damage. */
const HURTS: readonly AbilityEffect[] = ['strike', 'bolt', 'area', 'cone', 'line', 'dash', 'trap'];

/** True when the skill hurts players with its `power`. */
export function skillHurts(s: Pick<MonsterSkill, 'effect'>): boolean {
  return HURTS.includes(s.effect);
}

/**
 * A wished monster's skills, checked: up to four, each with a known effect,
 * numbers in sensible ranges and a status that fits (harmful on others,
 * helpful on itself). Unfit skills are left out.
 */
export function validMonsterSkills(raw: unknown): MonsterSkill[] {
  if (!Array.isArray(raw)) return [];
  const out: MonsterSkill[] = [];
  for (const r of raw.slice(0, 4) as Record<string, unknown>[]) {
    const effect = ABILITY_EFFECTS.find((e) => e === r?.effect);
    const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 40) : '';
    if (!effect || !name) continue;
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const status = typeof r.status === 'string' && r.status in STATUSES ? (r.status as StatusId) : undefined;
    const onSelf = effect === 'buff' || effect === 'stance';
    const fits = status && (onSelf ? !STATUSES[status].harmful : STATUSES[status].harmful) && status !== 'weakened' && status !== 'taunted';
    out.push({
      name,
      effect,
      power: num(r.power, 0, 200, 5),
      cooldown: num(r.cooldown, 2, 60, 8),
      range: num(r.range, 1, 8, effect === 'bolt' || effect === 'line' || effect === 'dash' ? 5 : 1),
      ...(typeof r.radius === 'number' ? { radius: num(r.radius, 1, 6, 2) } : {}),
      ...(fits ? { status } : {}),
      ...(fits && typeof r.seconds === 'number' ? { seconds: num(r.seconds, 1, 12, 3) } : {}),
      ...(r.type === 'physical' || r.type === 'arcane' ? { type: r.type } : {}),
    });
  }
  return out;
}
