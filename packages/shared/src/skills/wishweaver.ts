// The Wishweaver's five core skills (docs/classes/wishweaver.md, Core
// skills): the numbers are the page's table. Each spell is one thread; the
// Weave gauge doubles every third (region/gauges.ts), and what else a Woven
// spell does is in the server's region/skills/wishweaver.ts.

import type { AbilityDef } from '../rpg/abilities.ts';

/** Learned at levels 1, 2, 4, 6 and 8. */
export const WISHWEAVER_SKILLS: Record<string, AbilityDef> = {
  'ember-bolt': {
    name: 'Ember Bolt',
    description: 'An Ember of wishstuff at a creature up to 6 steps away; it keeps Burning for 3 seconds. Woven, the burn spreads to one creature nearby.',
    effect: 'bolt', energy: 6, cooldown: 2.5, range: 6, base: 4, stat: 'wit', factor: 1.4,
    thread: 'ember', status: 'burning', duration: 3, dotShare: 0.1,
  },
  'tide-lash': {
    name: 'Tide Lash',
    description: 'A lash of Tide in front of you: creatures within 3 steps are knocked back and Slowed for 3 seconds. Woven, they are Rooted instead.',
    effect: 'cone', energy: 8, cooldown: 6, range: 3, base: 3, stat: 'wit', factor: 1,
    thread: 'tide', status: 'slowed', duration: 3, damageType: 'arcane',
  },
  'gale-step': {
    name: 'Gale Step',
    description: 'Ride a Gale up to 5 steps, leaving a gust that hits creatures where you stood. Woven, you blink twice.',
    effect: 'blink', energy: 8, cooldown: 10, range: 5, base: 2, stat: 'wit', factor: 0.5,
    thread: 'gale', radius: 1.5,
  },
  'chain-spark': {
    name: 'Chain Spark',
    description: 'A Gale spark that jumps between up to 3 creatures, a little weaker each jump. Woven, it jumps to 6.',
    effect: 'bolt', energy: 10, cooldown: 6, range: 6, base: 5, stat: 'wit', factor: 1.3,
    thread: 'gale', chain: 3,
  },
  'wish-ward': {
    name: 'Wish Ward',
    description: 'A Tide of wishstuff shields you or a friend up to 6 steps away for 8 seconds. Woven, it shields every friend near them.',
    effect: 'buff', energy: 12, cooldown: 15, range: 6, base: 10, stat: 'wit', factor: 2,
    thread: 'tide', status: 'shielded', duration: 8,
  },
};
