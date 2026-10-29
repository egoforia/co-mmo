// The Bellkeeper's five core skills (docs/classes/bellkeeper.md, Core
// skills): the numbers are the page's table. Heals leave Echoes and Toll
// rings them (region/gauges.ts); Chime, Sanctuary and Peal of Waking are in
// the server's region/skills/bellkeeper.ts.

import type { AbilityDef } from '../rpg/abilities.ts';

/**
 * Learned at levels 1, 2, 4, 6 and 8. The Bellkeeper's Mend is its own
 * skill: the older Mend (`mend` in ABILITIES) stays a common technique.
 */
export const BELLKEEPER_SKILLS: Record<string, AbilityDef> = {
  'bell-mend': {
    name: 'Mend',
    description: 'A clear bell note that heals you or a friend up to 5 steps away and leaves an Echo on them. Spirit makes it stronger.',
    effect: 'heal', energy: 10, cooldown: 8, range: 5, base: 8, stat: 'spirit', factor: 2.5,
  },
  chime: {
    name: 'Chime',
    description: 'Ring out around you: friends within 2.5 steps are healed and keep an Echo, and creatures there are hurt.',
    effect: 'area', energy: 8, cooldown: 5, range: 0, base: 3, stat: 'spirit', factor: 0.8,
    radius: 2.5, damageType: 'arcane',
  },
  toll: {
    name: 'Toll',
    description: 'Toll the great bell: every Echo within 8 steps rings, healing its friend for half the heal that left it, then fades.',
    effect: 'heal', energy: 6, cooldown: 10, range: 8, base: 0, stat: 'spirit', factor: 0,
    finisher: true,
  },
  sanctuary: {
    name: 'Sanctuary',
    description: 'Hallow the ground within 3 steps of a friend or creature up to 5 steps away (or of you) for 6 seconds: friends inside heal each second and take less damage.',
    effect: 'area', energy: 15, cooldown: 20, range: 5, base: 2, stat: 'spirit', factor: 0.5,
    radius: 3, duration: 6,
  },
  'peal-of-waking': {
    name: 'Peal of Waking',
    description: 'A waking peal: friends within 5 steps lose their ailments and are Hallowed for 2 seconds, and one fallen friend nearby rises with a quarter of their health.',
    effect: 'cleanse', energy: 12, cooldown: 20, range: 0, base: 0, stat: 'spirit', factor: 0,
    radius: 5, status: 'hallowed', duration: 2,
  },
};
