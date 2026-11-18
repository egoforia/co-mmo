// Death (combat decisions, step 3): what a player loses when they wake at
// the shrine instead of being raised. Some XP, maybe a level, all the gold
// they carry, and now and then a worn piece or the whole bag. What drops
// lies on their body where they fell, for an hour, for anyone to take.

import { unbindCopy } from './copies.ts';
import { EQUIP_SLOTS, GOLD, ITEMS, goldOf, levelDownStats, maxEnergy, maxHp, takeGold, xpToNext, type Character, type InventorySlot } from './rpg.ts';

/** The share of the XP to the next level lost on each death. */
export const DEATH_XP_SHARE = 0.25;
/** The chance each worn piece drops, and the chance the bag drops with all it holds. */
export const DEATH_DROP_CHANCE = 0.15;
/** How long a player's body lies where they fell, so they may come back for their things. */
export const PLAYER_BODY_MS = 60 * 60 * 1000;

/** XP a death costs at this level. */
export function deathXp(level: number): number {
  return Math.round(xpToNext(level) * DEATH_XP_SHARE);
}

/** XP a death would cost this character: at level 1 there is no level to lose, so only the XP they have goes. */
export function deathXpFor(c: Pick<Character, 'level' | 'xp'>): number {
  return c.level > 1 ? deathXp(c.level) : Math.min(deathXp(c.level), c.xp);
}

/**
 * Takes XP away; below 0 the character drops a level (never below 1) and
 * what that level gave comes back off (levelDownStats). Returns the levels lost.
 */
export function loseXp(c: Character, amount: number): number {
  c.xp -= amount;
  let lost = 0;
  while (c.xp < 0 && c.level > 1) {
    c.level--;
    lost++;
    c.xp += xpToNext(c.level);
    levelDownStats(c);
  }
  if (c.xp < 0) c.xp = 0;
  if (lost) {
    c.hp = Math.min(c.hp, maxHp(c));
    c.energy = Math.min(c.energy, maxEnergy(c));
  }
  return lost;
}

/** True for things that never leave their owner: the Bible, sleeping wish items. Bound gear unbinds instead. */
function staysWithOwner(item: string): boolean {
  const def = ITEMS[item];
  return !!def?.bound && !def.copy;
}

/**
 * Rolls what a death drops and takes it from the character: all their gold,
 * each worn piece with DEATH_DROP_CHANCE, and with the same chance the bag
 * with everything in it. Bound pieces that drop are no longer bound.
 */
export function rollDeathDrops(c: Character, random: () => number = Math.random): InventorySlot[] {
  const drops: InventorySlot[] = [];
  const gold = goldOf(c);
  if (gold > 0 && takeGold(c, gold)) drops.push({ item: GOLD, qty: gold });
  for (const slot of EQUIP_SLOTS) {
    const worn = c.equipment[slot];
    if (!worn || staysWithOwner(worn) || random() >= DEATH_DROP_CHANCE) continue;
    delete c.equipment[slot];
    drops.push({ item: unbindCopy(worn), qty: 1 });
  }
  if (random() < DEATH_DROP_CHANCE) {
    const kept: InventorySlot[] = [];
    for (const s of c.inventory) {
      if (staysWithOwner(s.item)) kept.push(s);
      else drops.push({ item: unbindCopy(s.item), qty: s.qty });
    }
    c.inventory = kept;
  }
  return drops;
}

/** What a player reads about their death, in plain words. */
export function deathWords(xp: number, levels: number, drops: InventorySlot[]): string {
  const parts = [`You lost ${xp} XP${levels ? ` and ${levels === 1 ? 'a level' : `${levels} levels`}` : ''}.`];
  if (drops.length) parts.push('What you dropped lies where you fell for an hour. Go back for it before someone else finds it.');
  return parts.join(' ');
}

/** What falling would cost right now, for the bag's "If you fall here" line (inventory refactor, step 7). */
export interface DeathRisk {
  /** In a safe area, where no one can hurt you. */
  safe: boolean;
  /** All the gold carried goes. */
  gold: number;
  /** XP lost (never more than there is at level 1). */
  xp: number;
  /** Worn pieces that could drop, each with `chance`. */
  worn: number;
  /** The chance for each worn piece, and for the bag with all in it. */
  chance: number;
}

/** What a death would cost `c` now, from the same numbers die() uses; `safe` when standing in a safe area. */
export function deathRisk(c: Character, safe: boolean): DeathRisk {
  const xp = deathXpFor(c);
  const worn = EQUIP_SLOTS.filter((s) => c.equipment[s] && !staysWithOwner(c.equipment[s]!)).length;
  return { safe, gold: goldOf(c), xp, worn, chance: DEATH_DROP_CHANCE };
}

/** The risk in one plain line: what falling here costs, or that this place is safe. */
export function deathRiskWords(r: DeathRisk): string {
  if (r.safe) return 'Safe here: no one can hurt you.';
  const pct = `${Math.round(r.chance * 100)}%`;
  const lose = [`${r.xp} XP`, ...(r.gold > 0 ? [`all ${r.gold} gold`] : [])].join(' and ');
  const drops = [...(r.worn ? [`each worn piece ${pct}`] : []), `the bag with all in it ${pct}`].join(', ');
  return `If you fall here: you lose ${lose}. Chance to drop: ${drops}.`;
}
