import type { MonsterSkill } from './monster-gear.ts';
import type { CreatureDef } from './rpg.ts';

// The land monsters' own skills (combat decisions, step 7): tougher kinds
// get one or two, built from the players' effects, so a fight is more than
// trading plain blows. A wished monster brings its own (`skills`).

/** Skills by monster kind, for kinds whose definition gives none. */
export const MONSTER_SKILLS: Record<string, MonsterSkill[]> = {
  'crab-knight': [{ name: 'Claw Sweep', effect: 'cone', power: 6, cooldown: 8, range: 1 }],
  'thorn-wolf': [{ name: 'Howl', effect: 'taunt', power: 0, cooldown: 25, range: 1, radius: 5 }],
  'bark-golem': [{ name: 'Ground Slam', effect: 'area', power: 10, cooldown: 10, range: 1, radius: 2, status: 'slowed' }],
  'drowned-deckhand': [{ name: 'Spear Lunge', effect: 'dash', power: 8, cooldown: 9, range: 4 }],
  'mummy-guard': [{ name: 'Binding Wraps', effect: 'trap', power: 6, cooldown: 12, range: 3, seconds: 2 }],
  'crypt-skeleton': [{ name: 'Bone Guard', effect: 'stance', power: 30, cooldown: 15, range: 1 }],
  'sand-wyrm': [
    { name: 'Sand Spit', effect: 'bolt', power: 12, cooldown: 7, range: 5, type: 'physical', status: 'slowed' },
    { name: 'Burrow Hide', effect: 'shield', power: 30, cooldown: 20, range: 1 },
  ],
  'chained-demon': [
    { name: 'Hellfire', effect: 'area', power: 14, cooldown: 9, range: 3, radius: 2, type: 'arcane', status: 'burning' },
    { name: 'Chain Lash', effect: 'line', power: 16, cooldown: 8, range: 4 },
  ],
  'ice-wisp': [
    { name: 'Frost Bolt', effect: 'bolt', power: 8, cooldown: 6, range: 5, status: 'slowed' },
    { name: 'Drift Away', effect: 'blink', power: 0, cooldown: 12, range: 3 },
  ],
  'rime-stalker': [{ name: 'Pounce', effect: 'dash', power: 12, cooldown: 9, range: 4 }],
  'deep-matriarch': [
    { name: 'Call the Brood', effect: 'summon', power: 0, cooldown: 25, range: 1, radius: 12 },
    { name: 'Deep Mending', effect: 'heal', power: 30, cooldown: 15, range: 4 },
  ],
  'hoarfrost-roc': [{ name: 'Gale Wings', effect: 'cone', power: 20, cooldown: 9, range: 3 }],
  'glowcap-beetle': [{ name: 'Shake Off', effect: 'cleanse', power: 0, cooldown: 15, range: 1 }],
  mycelid: [{ name: 'Spore Cloud', effect: 'debuff', power: 4, cooldown: 10, range: 3, status: 'poisoned' }],
  'rootless-king': [
    { name: 'Rot Bloom', effect: 'area', power: 22, cooldown: 10, range: 3, radius: 3, status: 'poisoned' },
    { name: 'Call the Spores', effect: 'summon', power: 0, cooldown: 25, range: 1, radius: 14 },
  ],
};

/** A monster's skills: its definition's own, else its kind's. */
export function skillsOf(kind: string, def: Pick<CreatureDef, 'skills'>): MonsterSkill[] {
  return def.skills ?? MONSTER_SKILLS[kind] ?? [];
}
