import { ABILITIES, CALLINGS, PATH_SKILLS, callingWishesBetween, pathOf, pathSkillName, pathSkillsAt, type Character } from '@co-mmo/shared';

// What players are told as their Path grows (docs/classes.md, Progression):
// a skill learned, a passive gained, a Calling Wish earned.

/** One line for a Path skill that just came: an active to use, or a passive that works by itself. */
export function learnedWords(id: string): string {
  const s = PATH_SKILLS[id];
  if (s?.passive) return `You learned ${s.passive.name}. It works by itself: ${s.passive.description}`;
  return `You learned ${ABILITIES[id]?.name ?? pathSkillName(id)}.`;
}

/** Lines for levels `from` (exclusive) to `to`: the Path skills of those levels and any Calling Wish earned. */
export function levelWords(c: Character, from: number, to: number): string[] {
  const lines: string[] = [];
  for (let l = from + 1; l <= to; l++) for (const id of pathSkillsAt(c, l)) lines.push(learnedWords(id));
  if (c.calling && callingWishesBetween(from, to) > 0) {
    lines.push('You earned a Calling Wish. Pray at any time and tell the God how one of your skills should look; its name and look are yours to choose.');
  }
  if (c.calling && !c.path && from < 10 && to >= 10) {
    lines.push(`Your Path is waiting. Talk to ${CALLINGS[c.calling].mentor} in the Sanctum to begin your trial.`);
  }
  return lines;
}

/** What a Path mentor says about the Path a player walks, or how to choose one. */
export function mentorWords(c: Character): string {
  const path = c.calling ? pathOf(c.calling, c.path) : undefined;
  if (!path) return 'Your trial is done. Choose your Path.';
  return `You walk the ${path.name} Path. If your heart has turned, I can teach you the other way, for a price.`;
}
