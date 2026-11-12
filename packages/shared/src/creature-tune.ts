import { BEHAVIOR_NOTICE, type Behavior, type CreatureDef } from './rpg.ts';
import type { Active } from './sky.ts';
import { creatureDefence } from './weapons.ts';

// Monsters the world editor changed: a spawn may live at another level than
// its kind, keep another behaviour or other hours, and walk a patrol path of
// its own. The land carries the changes on each monster's home
// (CreatureSpawn); the server makes its live monster from the kind as tuned.

/** What the world editor may change about a spawn's monsters. */
export interface CreatureTune {
  level?: number;
  behavior?: Behavior;
  active?: Active;
  /** Where a patrol walks, tile middles in order, round and round. */
  route?: { x: number; y: number }[];
}

/** Lowest and highest level a monster may be set to. */
export const TUNE_LEVELS = { min: 1, max: 60 };

/** Health, harm, experience and gold scale with level as a levelled creature's do (lands.ts), from where its kind stands. */
const hpAt = (l: number) => 14 + l * 9;
const damageAt = (l: number) => 2 + l * 1.6;
const xpAt = (l: number) => 5 + l * 5;

/** A monster kind as a spawn's changes make it; the kind itself when nothing changed. */
export function tunedCreature(def: CreatureDef, tune: CreatureTune | undefined): CreatureDef {
  if (!tune || (tune.level === undefined && tune.behavior === undefined && tune.active === undefined)) return def;
  const out: CreatureDef = { ...def };
  const level = tune.level;
  if (level !== undefined && level !== def.level) {
    const from = Math.max(1, def.level);
    out.level = level;
    out.hp = Math.max(1, Math.round((def.hp * hpAt(level)) / hpAt(from)));
    out.damage = Math.max(1, Math.round((def.damage * damageAt(level)) / damageAt(from)));
    out.xp = Math.max(1, Math.round((def.xp * xpAt(level)) / xpAt(from)));
    out.gold = [level, level * 3];
    // Defence moves by what the level adds or takes away.
    const before = creatureDefence(from);
    const after = creatureDefence(level);
    out.armor = Math.max(0, (def.armor ?? 0) + after.armor! - before.armor!);
    out.ward = Math.max(0, (def.ward ?? 0) + after.ward! - before.ward!);
  }
  if (tune.behavior) {
    out.behavior = tune.behavior;
    // One that never noticed anyone needs eyes for its new ways.
    if (out.notice <= 0) out.notice = BEHAVIOR_NOTICE[tune.behavior];
  }
  if (tune.active) out.active = tune.active;
  return out;
}
