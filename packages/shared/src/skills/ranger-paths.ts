// The Ranger's Paths (docs/classes/ranger.md, Paths): Windeye, the one shot
// that matters, and Wildkin, the hunter with a friend. The spirit hawk is a
// summon; its picture is painted in build plan step 10 and never drawn in
// code. What data cannot say is in the server's region/paths/ranger.ts.

import type { PathSkill } from './paths.ts';

/** Windeye: Piercing Arrow, Steady Breath, Skyfall Arrow. Wildkin: Call Companion, Pack Instinct, Stampede. */
export const RANGER_PATHS: Record<string, PathSkill> = {
  'piercing-arrow': {
    level: 10,
    ability: {
      name: 'Piercing Arrow',
      description: 'An arrow that does not stop: it hits every creature in a line up to 8 steps ahead.',
      effect: 'line', energy: 10, cooldown: 10, range: 8, base: 8, stat: 'agility', factor: 1.4, damageType: 'physical',
    },
  },
  'steady-breath': {
    level: 15,
    passive: { name: 'Steady Breath', description: 'The first hit you take every 5 seconds does not break your Focus.' },
    numbers: { seconds: 5 },
  },
  'skyfall-arrow': {
    level: 20,
    ability: {
      name: 'Skyfall Arrow',
      description: 'Draw for 1.5 seconds, then a great arrow falls on a creature up to 9 steps away, hitting everything within 3 steps of it. It spends your Focus, a quarter stronger for each pip.',
      effect: 'area', energy: 25, cooldown: 60, range: 9, base: 20, stat: 'agility', factor: 3,
      radius: 3, damageType: 'physical', finisher: true, perPip: 0.25,
    },
    numbers: { seconds: 1.5 },
  },
  'call-companion': {
    level: 10,
    ability: {
      name: 'Call Companion',
      description: 'A spirit hawk comes to fight beside you, striking every 1.2 seconds for a third of your weapon\'s hit, until you send it home. Use it again to send it home.',
      effect: 'summon', energy: 20, cooldown: 30, range: 0, base: 0, stat: 'agility', factor: 0,
      radius: 6, damageType: 'physical',
    },
    numbers: { weapon: 0.35, every: 1.2, share: 0.4 },
  },
  'pack-instinct': {
    level: 15,
    passive: { name: 'Pack Instinct', description: 'Your hawk Marks what it attacks, and you and your hawk deal 10% more to Marked creatures.' },
    numbers: { more: 0.1 },
  },
  stampede: {
    level: 20,
    ability: {
      name: 'Stampede',
      description: 'A herd of spirit beasts runs down a line up to 8 steps ahead, knocking creatures back and Slowing them for 3 seconds.',
      effect: 'line', energy: 25, cooldown: 60, range: 8, base: 12, stat: 'agility', factor: 1.5,
      status: 'slowed', duration: 3, damageType: 'physical',
    },
    numbers: { push: 2 },
  },
};
