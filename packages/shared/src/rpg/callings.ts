// How a character's people and Calling shape their attributes
// (docs/attributes.md, How attributes grow; docs/classes.md, Migration and
// Changing Calling). The server runs these; the client shows the same numbers.

import { CALLINGS, CALLING_PRIMARY_START, CALLING_SECONDARY_START, type CallingId } from '../classes.ts';
import { RACES, type RaceId } from '../races.ts';
import { STARTING_STATS, newCharacter, type Character, type Stats } from '../rpg.ts';
import { maxEnergy, maxHp } from './attributes.ts';

const STAT_KEYS: readonly (keyof Stats)[] = ['might', 'agility', 'wit', 'spirit', 'vigor'];

/** Attribute names as players read them. */
export const STAT_NAMES: Record<keyof Stats, string> = { might: 'Might', agility: 'Agility', wit: 'Wit', spirit: 'Spirit', vigor: 'Vigor' };

/** Whether a value names one of the five attributes. */
export function isStat(v: unknown): v is keyof Stats {
  return typeof v === 'string' && (STAT_KEYS as readonly string[]).includes(v);
}

/**
 * The attributes a people and Calling give at a level, before any free
 * point is placed: 3 in each, the people's lift, +3 primary and +2
 * secondary, then +1 to each of the pair every level after the first.
 */
export function callingStats(race: RaceId, calling: CallingId, level: number): Stats {
  const stats = { ...STARTING_STATS };
  for (const k of STAT_KEYS) stats[k] += RACES[race].lift[k] ?? 0;
  const { primary, secondary } = CALLINGS[calling];
  stats[primary] += CALLING_PRIMARY_START + (level - 1);
  stats[secondary] += CALLING_SECONDARY_START + (level - 1);
  return stats;
}

/** A level-1 character of this people and Calling, as made at creation. */
export function startCharacter(race: RaceId, calling: CallingId): Character {
  const c = newCharacter();
  chooseCalling(c, race, calling);
  c.hp = maxHp(c);
  c.energy = maxEnergy(c);
  return c;
}

/**
 * Gives a character a people and Calling, rebuilding their attributes by
 * the rules for their level with every free point back to place. Used at
 * creation, when a character from before Callings chooses, and when a
 * Calling changes by wish (the Path is cleared: the new trial comes first).
 */
export function chooseCalling(c: Character, race: RaceId, calling: CallingId): void {
  c.race = race;
  c.calling = calling;
  delete c.path;
  c.stats = callingStats(race, calling, c.level);
  c.freePoints = c.level - 1;
  settle(c);
}

/**
 * Changes a character's people, moving the attribute lift while free points
 * stay where they were placed. Characters without a Calling choose both
 * instead (chooseCalling).
 */
export function changePeople(c: Character, race: RaceId): void {
  if (!c.calling || !c.race) return;
  const before = callingStats(c.race, c.calling, c.level);
  const after = callingStats(race, c.calling, c.level);
  for (const k of STAT_KEYS) c.stats[k] += after[k] - before[k];
  c.race = race;
  settle(c);
}

/**
 * Why a character cannot change to this people and/or Calling (a Moderate
 * wish), in words, or undefined when they can.
 */
export function callingChangeProblem(c: Character, race?: RaceId, calling?: CallingId): string | undefined {
  if (!race && !calling) return 'Choose a new people, a new Calling, or both.';
  if (!(race ?? c.race)) return 'Choose your people too.';
  if (!(calling ?? c.calling)) return 'Choose your Calling too.';
  if ((race ?? c.race) === c.race && (calling ?? c.calling) === c.calling) {
    return `You are already ${calling ? `a ${CALLINGS[calling].name}` : `one of the ${RACES[race!].name}`}.`;
  }
  return undefined;
}

/**
 * Changes people, Calling or both (docs/classes.md, Changing Calling). A new
 * Calling rebuilds the attributes with every free point back and clears the
 * Path; a new people alone moves only the lift. Returns why not, in words.
 */
export function changeCalling(c: Character, race?: RaceId, calling?: CallingId): string | undefined {
  const why = callingChangeProblem(c, race, calling);
  if (why) return why;
  if (calling && calling !== c.calling) chooseCalling(c, (race ?? c.race)!, calling);
  else if (race) changePeople(c, race);
  return undefined;
}

/** Places one free point; returns why not in words, or undefined when done. */
export function spendPoint(c: Character, stat: keyof Stats): string | undefined {
  if (!c.calling) return 'Choose your Calling first.';
  if (!(c.freePoints > 0)) return 'You have no free points to place. You get one each time you gain a level.';
  c.freePoints--;
  c.stats[stat]++;
  return undefined;
}

/** What a level-up adds: the Calling's pair and a free point, or +1 to all five without a Calling. */
export function levelUpStats(c: Character): void {
  if (!c.calling) {
    for (const k of STAT_KEYS) c.stats[k]++;
    return;
  }
  const { primary, secondary } = CALLINGS[c.calling];
  c.stats[primary]++;
  c.stats[secondary]++;
  c.freePoints = (c.freePoints ?? 0) + 1;
}

/**
 * Whether a saved character comes from before Callings and must choose a
 * people and Calling before they play. Characters saved since always carry
 * `freePoints`, so a character that has played without a Calling (a test
 * account) is not asked again.
 */
export function needsCalling(saved: Partial<Character> | undefined): boolean {
  return !!saved && !saved.calling && saved.freePoints === undefined;
}

/** Health and Energy stay within the new maximums after attributes move. */
function settle(c: Character): void {
  c.hp = Math.min(Math.max(1, c.hp), maxHp(c));
  c.energy = Math.min(Math.max(0, c.energy), maxEnergy(c));
}
