// The Duelist's Paths (docs/classes/duelist.md, Paths): Sunblade, the burst
// of the noon sun, and Sandstorm, the blade you cannot catch. What data
// cannot say is in the server's region/paths/duelist.ts.

import type { PathSkill } from './paths.ts';

/** Sunblade: Execute, Blazing Edge, Sunfall Dance. Sandstorm: Mirage, Thirsting Blade, Dune Tempest. */
export const DUELIST_PATHS: Record<string, PathSkill> = {
  execute: {
    level: 10,
    ability: {
      name: 'Execute',
      description: 'A finishing blow. It spends all your Momentum, a fifth stronger for each pip, and does double damage to a creature under 30% health.',
      effect: 'strike', energy: 12, cooldown: 10, range: 1.8, base: 8, stat: 'might', factor: 1.5,
      finisher: true, perPip: 0.2,
    },
    numbers: { below: 0.3, times: 2 },
  },
  'blazing-edge': {
    level: 15,
    passive: { name: 'Blazing Edge', description: 'Your critical hits set the creature Burning for 3 seconds.' },
    numbers: { share: 0.3, seconds: 3 },
  },
  'sunfall-dance': {
    level: 20,
    ability: {
      name: 'Sunfall Dance',
      description: 'Five strikes in 2 seconds, each half again as hard as your weapon, leaping between creatures within 4 steps. Nothing can hit you while you dance.',
      effect: 'dash', energy: 25, cooldown: 60, range: 4, base: 0, stat: 'might', factor: 0,
    },
    numbers: { hits: 5, seconds: 2, weapon: 1.5 },
  },
  mirage: {
    level: 10,
    ability: {
      name: 'Mirage',
      description: 'Leave a double of sand behind: creatures close by turn from you to it, you are Hidden for 2 seconds, and your next hit from hiding is a critical hit.',
      effect: 'summon', energy: 10, cooldown: 20, range: 0, base: 0, stat: 'agility', factor: 0,
      radius: 5, duration: 4,
    },
    numbers: { hidden: 2 },
  },
  'thirsting-blade': {
    level: 15,
    passive: { name: 'Thirsting Blade', description: 'Your finishers heal you for 4% of your health for each Momentum pip they spend.' },
    numbers: { share: 0.04 },
  },
  'dune-tempest': {
    level: 20,
    ability: {
      name: 'Dune Tempest',
      description: 'Spin for 4 seconds as you move, hitting everything within 2 steps every half second for 60% of your weapon. Nothing can Slow or Root you while you spin.',
      effect: 'area', energy: 20, cooldown: 45, range: 0, base: 0, stat: 'might', factor: 0,
      radius: 2, damageType: 'physical',
    },
    numbers: { seconds: 4, every: 0.5, weapon: 0.6 },
  },
};
