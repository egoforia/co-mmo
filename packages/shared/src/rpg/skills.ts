// Learning Calling skills and arranging the hotbar (docs/classes.md,
// Progression and Migration). Core skills come by themselves at levels 1,
// 2, 4, 6 and 8; the player chooses what sits on keys 1 to 6 from their
// spellbook, and the server checks it. Re-exported from rpg.ts.

import { CALLINGS, type CallingId } from '../classes.ts';
import { SLEEPING_ABILITIES } from '../mods.ts';
import { ABILITIES, type Character } from '../rpg.ts';
import { REPLACES, SKILLS_BY_CALLING } from '../skills/index.ts';

/** Keys on the hotbar: 1 to 6. */
export const HOTBAR_SIZE = 6;

/** The core skills a Calling has learned by this level, in the order they come. */
export function coreSkillsFor(calling: CallingId, level: number): string[] {
  return CALLINGS[calling].core.filter((s) => s.level <= level).map((s) => s.skill);
}

/** The core skills a Calling learns at exactly this level (none between the skill levels). */
export function coreSkillsAt(calling: CallingId, level: number): string[] {
  return CALLINGS[calling].core.filter((s) => s.level === level).map((s) => s.skill);
}

/** Whether an ability belongs to a Calling other than this one (its core and Path skills). */
function otherCallings(id: string, calling: CallingId): boolean {
  return Object.entries(SKILLS_BY_CALLING).some(([other, skills]) => other !== calling && Object.hasOwn(skills, id));
}

/**
 * Puts a known ability on the first free key, unless it is on one already.
 * Returns its key (1 to 6), or undefined when every key is taken.
 */
export function slotSkill(c: Character, id: string): number | undefined {
  const on = c.hotbar.indexOf(id);
  if (on >= 0) return on + 1;
  const at = c.hotbar.findIndex((s) => !s);
  if (at < 0) return undefined;
  c.hotbar[at] = id;
  return at + 1;
}

/**
 * Brings a character's skills in line with their Calling and level: skills
 * of another Calling go (after a Calling change), a common technique the
 * Calling replaces becomes its skill on the same key (Mend for Bellkeepers,
 * Firebolt for Wishweavers), and every core skill up to their level is
 * learned and slotted. Returns the skills newly learned. Without a Calling,
 * nothing changes.
 */
export function settleSkills(c: Character): string[] {
  const calling = c.calling;
  if (!calling) return [];
  c.abilities = c.abilities.filter((a) => !otherCallings(a, calling));
  c.hotbar = c.hotbar.map((a) => (a && c.abilities.includes(a) ? a : ''));
  for (const [old, skill] of Object.entries(REPLACES[calling] ?? {})) {
    const at = c.abilities.indexOf(old);
    if (at < 0) continue;
    c.abilities.splice(at, 1);
    if (!c.abilities.includes(skill)) c.abilities.splice(at, 0, skill);
    c.hotbar = c.hotbar.map((a) => (a === old ? skill : a));
  }
  const learned: string[] = [];
  for (const id of coreSkillsFor(calling, c.level)) {
    if (!ABILITIES[id] || c.abilities.includes(id)) continue;
    c.abilities.push(id);
    learned.push(id);
  }
  // A skill learned now takes the first free key.
  for (const id of learned) slotSkill(c, id);
  return learned;
}

/**
 * A character saved before the hotbar had their first abilities on keys 1
 * to 4 in the order learned; they keep them there. Keys whose ability is
 * forgotten are emptied.
 */
export function upgradeHotbar(c: Character, saved: Partial<Character>): void {
  const bar: unknown[] = Array.isArray(saved.hotbar) ? saved.hotbar : c.abilities.filter((a) => ABILITIES[a]).slice(0, 4);
  c.hotbar = Array.from({ length: HOTBAR_SIZE }, (_, i) => {
    const a = bar[i];
    return typeof a === 'string' && c.abilities.includes(a) ? a : '';
  });
}

/**
 * Arranges keys 1 to 6 from the spellbook: each key holds a known ability
 * or nothing, and no ability sits on two keys. Returns why not, in words,
 * or undefined when done.
 */
export function setHotbar(c: Character, slots: readonly string[]): string | undefined {
  if (slots.length > HOTBAR_SIZE) return `Only ${HOTBAR_SIZE} keys fit on your hotbar.`;
  const placed = slots.filter((s) => s);
  if (new Set(placed).size !== placed.length) return 'Each ability can sit on one key only.';
  const unknown = placed.find((s) => !c.abilities.includes(s) || !(ABILITIES[s] || SLEEPING_ABILITIES.has(s)));
  if (unknown) return 'You can only put abilities you know on your hotbar.';
  c.hotbar = Array.from({ length: HOTBAR_SIZE }, (_, i) => slots[i] ?? '');
  return undefined;
}

/** Words for where a newly learned ability went: "It is on the 3 key." or how to place it. */
export function keyWords(c: Character, id: string): string {
  const key = c.hotbar.indexOf(id) + 1;
  return key ? `It is on the ${key} key.` : 'Open your spellbook (K) to put it on a key.';
}

/**
 * Why a character need not learn a common technique their Calling replaces
 * (a Bellkeeper and the old Mend, a Wishweaver and Firebolt), in words.
 */
export function replacedWords(c: Character, ability: string): string | undefined {
  const skill = c.calling && REPLACES[c.calling]?.[ability];
  if (!skill || !ABILITIES[skill]) return undefined;
  return `As a ${CALLINGS[c.calling!].name}, your own ${ABILITIES[skill].name} takes the place of ${ABILITIES[ability]?.name ?? 'that'}.`;
}
