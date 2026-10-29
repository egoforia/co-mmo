// The Ranger's five core skills (docs/classes/ranger.md, Core skills): the
// numbers are the page's table. Aimed Shot is a finisher that spends Focus
// (its pips also raise its crit, region/gauges.ts critBonus).

import type { AbilityDef } from '../rpg/abilities.ts';

/** Learned at levels 1, 2, 4, 6 and 8. */
export const RANGER_SKILLS: Record<string, AbilityDef> = {
  'aimed-shot': {
    name: 'Aimed Shot',
    description: 'A careful shot at a creature up to 7 steps away. It spends all your Focus, 15% stronger for each pip.',
    effect: 'bolt', energy: 6, cooldown: 5, range: 7, base: 5, stat: 'agility', factor: 1.2,
    finisher: true, perPip: 0.15, weapon: true,
  },
  tumble: {
    name: 'Tumble',
    description: 'Roll 4 steps back, away from the creature. You keep your Focus.',
    effect: 'blink', energy: 5, cooldown: 10, range: 4, base: 0, stat: 'agility', factor: 0,
    away: 'back',
  },
  'snare-trap': {
    name: 'Snare Trap',
    description: 'Set a snare at your feet. The first creature to step on it is hurt and Rooted for 2.5 seconds. Two can be set at once, for 30 seconds.',
    effect: 'trap', energy: 8, cooldown: 15, range: 0, base: 3, stat: 'agility', factor: 0.5,
    status: 'rooted',
  },
  volley: {
    name: 'Volley',
    description: 'Arrows rain within 2 steps of a creature up to 6 steps away (or around you), hitting everything there.',
    effect: 'area', energy: 12, cooldown: 12, range: 6, base: 6, stat: 'agility', factor: 1.5,
    radius: 2, weapon: true,
  },
  'hawk-mark': {
    name: 'Hawk Mark',
    description: 'Mark a creature up to 8 steps away for 10 seconds: you and your party deal it more damage.',
    effect: 'debuff', energy: 6, cooldown: 15, range: 8, base: 0, stat: 'agility', factor: 0,
    status: 'marked', duration: 10,
  },
};
