// The Warden's five core skills (docs/classes/warden.md, Core skills): the
// numbers are the page's table. What the effect kit cannot say as data
// (Shield Bash without a shield, Challenge's Resolve, Hold the Line) is in
// the server's region/skills/warden.ts.

import type { AbilityDef } from '../rpg/abilities.ts';

/** Learned at levels 1, 2, 4, 6 and 8. */
export const WARDEN_SKILLS: Record<string, AbilityDef> = {
  'shield-bash': {
    name: 'Shield Bash',
    description: 'Slam a creature with your shield: it is Stunned for a moment (half as long without a shield) and wants you three times as much.',
    effect: 'strike', energy: 8, cooldown: 6, range: 1.8, base: 4, stat: 'might', factor: 1,
    status: 'stunned', duration: 1, threat: 3,
  },
  challenge: {
    name: 'Challenge',
    description: 'Shout a challenge: every creature within 3 steps fights you for 4 seconds. Each one turned gives you Resolve, up to 3.',
    effect: 'taunt', energy: 10, cooldown: 12, range: 0, base: 0, stat: 'vigor', factor: 0,
    radius: 3, duration: 4, gain: 3,
  },
  bulwark: {
    name: 'Bulwark',
    description: 'Brace behind a shield of will that soaks up damage for 6 seconds. It spends all your Resolve, and each pip makes it half again as strong.',
    effect: 'shield', energy: 6, cooldown: 10, range: 0, base: 10, stat: 'vigor', factor: 1.5,
    duration: 6, finisher: true, perPip: 0.5,
  },
  earthbreak: {
    name: 'Earthbreak',
    description: 'Crack the ground around you: everything within 2.5 steps is hurt and Slowed for 3 seconds, and wants you twice as much.',
    effect: 'area', energy: 12, cooldown: 10, range: 0, base: 6, stat: 'might', factor: 1.2,
    radius: 2.5, status: 'slowed', duration: 3, threat: 2, weapon: true,
  },
  'hold-the-line': {
    name: 'Hold the Line',
    description: 'Plant your feet: for 6 seconds you and your friends within 4 steps take a fifth less damage, and every blow they take gives you Resolve.',
    effect: 'buff', energy: 15, cooldown: 30, range: 0, base: 0, stat: 'vigor', factor: 0,
    radius: 4, status: 'guarded', duration: 6,
  },
};
