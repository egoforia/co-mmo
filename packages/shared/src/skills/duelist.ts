// The Duelist's five core skills (docs/classes/duelist.md, Core skills): the
// numbers are the page's table. Riposte's counter, Sidestep's dodge and the
// Momentum they add are in the server's region/skills/duelist.ts.

import type { AbilityDef } from '../rpg/abilities.ts';

/** Learned at levels 1, 2, 4, 6 and 8. */
export const DUELIST_SKILLS: Record<string, AbilityDef> = {
  lunge: {
    name: 'Lunge',
    description: 'Dash up to 4 steps to a creature and strike it as you land. The hit builds Momentum.',
    effect: 'dash', energy: 6, cooldown: 6, range: 4, base: 4, stat: 'might', factor: 1,
  },
  riposte: {
    name: 'Riposte',
    description: 'Wait for it: for 1.5 seconds the next blow up close does nothing to you, and you strike back. Gives 2 Momentum.',
    effect: 'buff', energy: 6, cooldown: 8, range: 0, base: 6, stat: 'might', factor: 1.2,
    status: 'poised', duration: 1.5, gain: 2, weapon: true,
  },
  whirl: {
    name: 'Whirl',
    description: 'Spin with your blade and hit everything within 2 steps. It spends all your Momentum, a quarter stronger for each pip.',
    effect: 'area', energy: 10, cooldown: 6, range: 0, base: 3, stat: 'might', factor: 0.6,
    radius: 2, finisher: true, perPip: 0.25, weapon: true,
  },
  rend: {
    name: 'Rend',
    description: 'A deep cut that keeps Bleeding for 6 seconds, straight through armour. Agility makes it worse.',
    effect: 'strike', energy: 8, cooldown: 8, range: 1.8, base: 2, stat: 'agility', factor: 0.6,
    status: 'bleeding', duration: 6, dotShare: 0.5,
  },
  sidestep: {
    name: 'Sidestep',
    description: 'Step 3 steps aside: for 2 seconds you dodge far more often. Gives 1 Momentum.',
    effect: 'blink', energy: 5, cooldown: 10, range: 3, base: 0, stat: 'agility', factor: 0,
    status: 'evasive', duration: 2, gain: 1, away: 'aside',
  },
};
