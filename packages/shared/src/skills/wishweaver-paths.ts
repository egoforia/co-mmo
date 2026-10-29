// The Wishweaver's Paths (docs/classes/wishweaver.md, Paths): Stormcaller,
// the storm in full, and Threadbinder, who rewrites the fight. All their
// damage is arcane. What data cannot say is in the server's region/paths/wishweaver.ts.

import type { PathSkill } from './paths.ts';

/** Stormcaller: Firestorm, Overflow, Starfall. Threadbinder: Unravel, Loose Ends, Rewrite. */
export const WISHWEAVER_PATHS: Record<string, PathSkill> = {
  firestorm: {
    level: 10,
    ability: {
      name: 'Firestorm',
      description: 'Fire rains for 5 seconds within 3 steps of a creature up to 6 steps away, hurting everything inside each second and setting it Burning.',
      effect: 'area', energy: 18, cooldown: 15, range: 6, base: 3, stat: 'wit', factor: 0.6,
      radius: 3, status: 'burning', thread: 'ember',
    },
    numbers: { seconds: 5 },
  },
  overflow: {
    level: 15,
    passive: { name: 'Overflow', description: 'A Woven spell gives back the Energy it cost.' },
  },
  starfall: {
    level: 20,
    ability: {
      name: 'Starfall',
      description: 'Six stars fall over 3 seconds within 4 steps of a creature up to 7 steps away. It is always Woven, all three threads at once, and leaves you with 3 Weave.',
      effect: 'area', energy: 30, cooldown: 60, range: 7, base: 10, stat: 'wit', factor: 1.5,
      radius: 4,
    },
    numbers: { hits: 6, seconds: 3, weave: 3 },
  },
  unravel: {
    level: 10,
    ability: {
      name: 'Unravel',
      description: 'Pull a creature\'s threads loose: it is hurt, loses its shields, and is Silenced for 3 seconds.',
      effect: 'debuff', energy: 10, cooldown: 12, range: 6, base: 4, stat: 'wit', factor: 1,
      status: 'silenced', duration: 3, thread: 'gale',
    },
  },
  'loose-ends': {
    level: 15,
    passive: { name: 'Loose Ends', description: 'You deal 15% more to Slowed, Rooted and Silenced creatures, and your slows last half again as long.' },
    numbers: { more: 0.15, longer: 0.5 },
  },
  rewrite: {
    level: 20,
    ability: {
      name: 'Rewrite',
      description: 'Undo the last 3 seconds. On a friend, every bit of damage they took then is healed and the ailments they gained are cleared. On a creature, it takes back all the damage it dealt then.',
      effect: 'heal', energy: 25, cooldown: 90, range: 6, base: 0, stat: 'wit', factor: 0,
      thread: 'tide',
    },
    numbers: { seconds: 3 },
  },
};
