// The Bellkeeper's Paths (docs/classes/bellkeeper.md, Paths): Dawnbell, who
// keeps everyone standing, and Dirgebell, who rings for the end. What data
// cannot say is in the server's region/paths/bellkeeper.ts.

import type { PathSkill } from './paths.ts';

/** Dawnbell: Grace, Overtone, Great Bell of Waking. Dirgebell: Knell, Iron Psalm, Final Knell. */
export const BELLKEEPER_PATHS: Record<string, PathSkill> = {
  grace: {
    level: 10,
    ability: {
      name: 'Grace',
      description: 'A gentle heal on a friend up to 6 steps away, a little each second for 10 seconds. It leaves an Echo. One Grace at a time on each friend.',
      effect: 'heal', energy: 10, cooldown: 3, range: 6, base: 2, stat: 'spirit', factor: 0.6,
      status: 'graced', duration: 10,
    },
  },
  overtone: {
    level: 15,
    passive: { name: 'Overtone', description: 'Healing beyond full health becomes a shield for 6 seconds, up to a fifth of their health.' },
    numbers: { share: 0.2, seconds: 6 },
  },
  'great-bell-of-waking': {
    level: 20,
    ability: {
      name: 'Great Bell of Waking',
      description: 'Ring the great bell: every friend within 8 steps is healed, and every Fallen friend there rises at half health.',
      effect: 'heal', energy: 30, cooldown: 120, range: 0, base: 20, stat: 'spirit', factor: 3,
      radius: 8,
    },
    numbers: { raise: 0.5 },
  },
  knell: {
    level: 10,
    ability: {
      name: 'Knell',
      description: 'Toll for a creature up to 6 steps away. For 8 seconds it deals 15% less and takes 10% more, and every hit on it heals the one who struck for 2% of their health.',
      effect: 'debuff', energy: 8, cooldown: 12, range: 6, base: 0, stat: 'spirit', factor: 0,
      status: 'knelled', duration: 8,
    },
    numbers: { less: 0.15, more: 0.1, share: 0.02 },
  },
  'iron-psalm': {
    level: 15,
    passive: { name: 'Iron Psalm', description: 'Your heals add half your Vigor, and your bell-mace hits leave a small Echo on the friend they heal.' },
    numbers: { factor: 0.5 },
  },
  'final-knell': {
    level: 20,
    ability: {
      name: 'Final Knell',
      description: 'Every Echo within 6 steps rings first, healing its friend. Then the knell falls within 3 steps of a creature up to 6 steps away: arcane damage, a fifth more for each Echo rung.',
      effect: 'area', energy: 25, cooldown: 60, range: 6, base: 10, stat: 'spirit', factor: 1.5,
      radius: 3,
    },
    numbers: { perEcho: 0.2 },
  },
};
