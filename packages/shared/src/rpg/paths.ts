// Choosing a Path and learning its skills (docs/classes.md, Progression;
// build plan step 7b). At level 10 the Calling's Sanctum mentor sends the
// player on a trial; once it is handed in to the Path mentor they choose one
// of the Calling's two Paths, and learn its skills at 10, 15 and 20. The
// Calling Wish at 10 and 20 is counted here too. Re-exported from rpg.ts.

import { CALLINGS, pathOf, type CallingId } from '../classes.ts';
import { ABILITIES, learnAbility, type Character } from '../rpg.ts';
import { PATH_SKILLS, PATH_SKILLS_BY_CALLING } from '../skills/paths.ts';

/** A skill's new look and name from a Calling Wish (content.ts SkillLookWish): only how it looks and is called. */
export interface SkillLook {
  name: string;
  description: string;
  /** The granted wish, whose picture is the skill's new look. */
  wish: string;
}

/** The level a Path's trial opens and its first skill comes. */
export const PATH_LEVEL = 10;

/** Levels that each bring one Calling Wish (docs/classes.md, Calling Wishes). */
export const CALLING_WISH_LEVELS: readonly number[] = [10, 20];

/** Changing to the other Path later costs this much gold per level, paid at the Path mentor. */
export const PATH_CHANGE_GOLD = 50;

/** Each Calling's trial quest (its words and goal are in trials.ts). */
export const TRIAL_QUESTS: Record<CallingId, string> = {
  warden: 'trial-gate-holds',
  duelist: 'trial-sun-and-sand',
  ranger: 'trial-last-tower',
  wishweaver: 'trial-threads-in-the-tide',
  bellkeeper: 'trial-silent-bell',
};

/** Who gives each Calling's trial in the Sanctum (their NPC ids, world.ts). */
export const SANCTUM_MENTORS: Record<CallingId, string> = {
  warden: 'bramble-ursine-npc',
  duelist: 'dune-scorpid-npc',
  ranger: 'zephyr-falcon-npc',
  wishweaver: 'tide-lutran-npc',
  bellkeeper: 'sylvan-cervid-npc',
};

/**
 * Who waits at the end of each trial and lets the player choose a Path (their
 * NPC ids, lands.ts). The Windkeeper waits for the Sky Ruins to be wished
 * into being; until then Zephyr Falcon stands in.
 */
export const PATH_MENTORS: Record<CallingId, string> = {
  warden: 'sir-alder',
  duelist: 'sultana-zahra',
  ranger: 'zephyr-falcon-npc',
  wishweaver: 'queen-nerissa',
  bellkeeper: 'brother-tolle',
};

/** True once the character has handed in their Calling's trial. */
export function trialPassed(c: Character): boolean {
  return !!c.calling && c.quests.some((q) => q.id === TRIAL_QUESTS[c.calling!] && q.done);
}

/** Gold it costs to choose this Path now: nothing the first time, 50 × level to change. */
export function pathCost(c: Character, path: string): number {
  return c.path && c.path !== path ? PATH_CHANGE_GOLD * c.level : 0;
}

/** Why this character cannot choose this Path now, in words; undefined when they can. */
export function pathProblem(c: Character, path: string): string | undefined {
  const calling = c.calling;
  if (!calling) return 'Choose your Calling first.';
  const def = pathOf(calling, path);
  if (!def) return `That is not a Path of the ${CALLINGS[calling].name}s.`;
  if (c.level < PATH_LEVEL) return `Paths open at level ${PATH_LEVEL}. Come back when you are stronger.`;
  if (!trialPassed(c)) return 'Finish your trial first. Your mentor in the Sanctum will send you on it.';
  if (c.path === path) return `You already walk the ${def.name} Path.`;
  const cost = pathCost(c, path);
  if (c.gold < cost) return `Changing Path costs ${cost} gold, and you have ${c.gold}.`;
  return undefined;
}

/**
 * Chooses a Path (and pays to change one): the other Path's skills are
 * forgotten and this one's are learned up to the character's level.
 * Returns why not, or undefined when done.
 */
export function choosePath(c: Character, path: string): string | undefined {
  const why = pathProblem(c, path);
  if (why) return why;
  c.gold -= pathCost(c, path);
  c.path = path;
  settlePathSkills(c);
  return undefined;
}

/** The Path skills (actives and passives) a Path has by this level, in the order they come. */
export function pathSkillsFor(calling: CallingId, path: string | undefined, level: number): string[] {
  return (pathOf(calling, path)?.skills ?? []).filter((s) => s.level <= level).map((s) => s.skill);
}

/** Whether the character has this passive: it is their Path's and they are of its level. */
export function knowsPassive(c: Pick<Character, 'calling' | 'path' | 'level'>, id: string): boolean {
  return !!c.calling && !!PATH_SKILLS[id]?.passive && pathSkillsFor(c.calling, c.path, c.level).includes(id);
}

/**
 * Brings a character's Path skills in line with their Path and level: Path
 * skills that are not theirs (another Path, another Calling) are forgotten,
 * and their own active skills up to their level are learned. Passives need
 * no learning (knowsPassive). Returns the actives newly learned.
 */
export function settlePathSkills(c: Character): string[] {
  const own = c.calling ? pathSkillsFor(c.calling, c.path, c.level) : [];
  c.abilities = c.abilities.filter((a) => !PATH_SKILLS[a] || own.includes(a));
  return own.filter((id) => PATH_SKILLS[id]!.ability && ABILITIES[id] && learnAbility(c, id));
}

/** The Path skills (actives and passives) that come at exactly this level. */
export function pathSkillsAt(c: Pick<Character, 'calling' | 'path'>, level: number): string[] {
  return (c.calling && pathOf(c.calling, c.path)?.skills.filter((s) => s.level === level).map((s) => s.skill)) || [];
}

/** The Path skills of a Calling, by id, for checking a skill belongs to it. */
export function pathSkillOf(calling: CallingId, id: string): boolean {
  return Object.hasOwn(PATH_SKILLS_BY_CALLING[calling], id);
}

/** Calling Wishes the character has earned (one at 10, one at 20) and not yet used. */
export function callingWishesLeft(c: Pick<Character, 'calling' | 'level' | 'callingWishesUsed'>): number {
  if (!c.calling) return 0;
  return Math.max(0, CALLING_WISH_LEVELS.filter((l) => c.level >= l).length - (c.callingWishesUsed ?? 0));
}

/** Calling Wishes earned on reaching exactly the levels from `from` (exclusive) to `to`. */
export function callingWishesBetween(from: number, to: number): number {
  return CALLING_WISH_LEVELS.filter((l) => l > from && l <= to).length;
}
