// The Calling Wish (docs/classes.md, Calling Wishes): at levels 10 and 20 a
// player gets one free Minor wish that reshapes one of their skills, giving it
// a new name and a new look ("my Ember Bolt is a swarm of fireflies"). The
// world keeps every number, so a wish that asks for more damage, less cost or
// a shorter rest is refused. Granted at once and for free, like the look wish
// (`grantLook`); it changes only the wisher's character.

import { WishError, type SkillLookWish } from './content.ts';
import { callingWishesLeft, type SkillLook } from './rpg/paths.ts';
import { ABILITIES, type Character } from './rpg.ts';

/** Fields a wish might use to change a skill's numbers or what it does: a Calling Wish may set none of them. */
const NUMBER_FIELDS = [
  'effect', 'energy', 'cooldown', 'range', 'base', 'stat', 'factor', 'status', 'radius', 'duration', 'damageType', 'threat',
  'thread', 'finisher', 'perPip', 'amount', 'damage', 'power', 'heal', 'cost', 'level', 'numbers',
];

/** What a refused number change is answered with. */
export const SKILL_NUMBERS_KEPT = 'A Calling Wish gives a skill a new look and name only. How hard it hits, what it costs and how long it rests stay as the world set them.';

/**
 * Checks a Calling Wish against the character who makes it: they hold one,
 * they know the skill, and it asks only for a name, words and a look. Throws
 * a WishError in plain words otherwise.
 */
export function validateSkillLookWish(raw: unknown, c: Character): SkillLookWish {
  const d = (raw ?? {}) as Record<string, unknown>;
  if (NUMBER_FIELDS.some((k) => d[k] !== undefined && d[k] !== null)) throw new WishError(SKILL_NUMBERS_KEPT);
  if (callingWishesLeft(c) < 1) throw new WishError('You earn a Calling Wish at level 10 and another at level 20. Come back to me then.');
  const skill = typeof d.skill === 'string' ? d.skill : '';
  if (!ABILITIES[skill] || !c.abilities.includes(skill)) throw new WishError('Name one of the skills you know, and I will reshape it.');
  const name = text(d.name, 40);
  const description = text(d.description, 300);
  if (!name) throw new WishError('Give your skill its new name.');
  if (description.length < 3) throw new WishError('Tell me how your skill looks now.');
  const l = (d.look ?? {}) as Record<string, unknown>;
  const color = typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color.toLowerCase() : '#c8a2c8';
  return {
    kind: 'skill',
    skill,
    name,
    description,
    look: { hook: text(l.hook, 120) || description.slice(0, 120), body: text(l.body, 200) || 'a burst of light', color, mood: text(l.mood, 60) || 'wondrous' },
  };
}

/** Gives the skill its new look and name and spends a Calling Wish; false (changing nothing) when none is left. */
export function applySkillLook(c: Character, def: Pick<SkillLookWish, 'skill' | 'name' | 'description'>, wish: string): boolean {
  if (callingWishesLeft(c) < 1 || !c.abilities.includes(def.skill)) return false;
  const look: SkillLook = { name: def.name, description: def.description, wish };
  c.skillLooks = { ...c.skillLooks, [def.skill]: look };
  c.callingWishesUsed = (c.callingWishesUsed ?? 0) + 1;
  return true;
}

/** A skill's name as this character has it: their Calling Wish's name, else the world's. */
export function skillName(c: Pick<Character, 'skillLooks'>, id: string): string {
  return c.skillLooks?.[id]?.name ?? ABILITIES[id]?.name ?? id;
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
