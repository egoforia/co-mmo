// The Warden's Paths (docs/classes/warden.md, Paths): Oakheart, who does not
// fall, and Stonefist, who hits back. What data cannot say is in the
// server's region/paths/warden.ts.

import type { PathSkill } from './paths.ts';

/** Oakheart: Rooted Stand, Barkskin, Last Knight. Stonefist: Quake Leap, Retaliate, Mountainfall. */
export const WARDEN_PATHS: Record<string, PathSkill> = {
  'rooted-stand': {
    level: 10,
    ability: {
      name: 'Rooted Stand',
      description: 'Plant your feet like an old oak. While you hold it you move slower and gain Armor from your Vigor, and nothing can Stun or Root you. It costs 1 Energy each second; use it again to step out.',
      effect: 'stance', energy: 1, cooldown: 2, range: 0, base: 0, stat: 'vigor', factor: 0.5,
      status: 'slowed',
    },
  },
  barkskin: {
    level: 15,
    passive: { name: 'Barkskin', description: 'While your Resolve is full, you heal 1% of your health each second, even in a fight.' },
    numbers: { share: 0.01 },
  },
  'last-knight': {
    level: 20,
    ability: {
      name: 'Last Knight',
      description: 'For 8 seconds nothing can bring your health below 1. When it ends, you heal 30% of your health.',
      effect: 'buff', energy: 20, cooldown: 180, range: 0, base: 0, stat: 'vigor', factor: 0,
      status: 'unyielding', duration: 8,
    },
    numbers: { share: 0.3 },
  },
  'quake-leap': {
    level: 10,
    ability: {
      name: 'Quake Leap',
      description: 'Leap at a creature up to 5 steps away and land like a falling boulder: everything within 2 steps of where you land is hurt and Slowed for 2 seconds.',
      effect: 'dash', energy: 12, cooldown: 14, range: 5, base: 5, stat: 'might', factor: 1,
      radius: 2, status: 'slowed', duration: 2,
    },
  },
  retaliate: {
    level: 15,
    passive: { name: 'Retaliate', description: 'When a creature hits you up close, you have a 20% chance to strike straight back, and you always do while your Resolve is full.' },
    numbers: { chance: 0.2, factor: 0.8 },
  },
  mountainfall: {
    level: 20,
    ability: {
      name: 'Mountainfall',
      description: 'Bring the mountain down on everything within 3.5 steps. It spends all your Resolve, a quarter stronger for each pip, and Stuns what it hits for 1.5 seconds.',
      effect: 'area', energy: 20, cooldown: 45, range: 0, base: 12, stat: 'might', factor: 2,
      radius: 3.5, status: 'stunned', duration: 1.5, finisher: true, perPip: 0.25,
    },
  },
};
