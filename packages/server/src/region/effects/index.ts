import type { AbilityEffect } from '@co-mmo/shared';
import { area, cone, line } from './areas.ts';
import { debuff, taunt } from './marks.ts';
import { blink, dash } from './moves.ts';
import { stance } from './stance.ts';
import { bolt, strike } from './strike.ts';
import { summon } from './summon.ts';
import { buff, cleanse, heal, shield } from './support.ts';
import { trap } from './trap.ts';
import type { Effect } from './types.ts';

export { endStance, holdStances } from './stance.ts';
export { helpersAct } from './summon.ts';
export { springTraps } from './trap.ts';
export type { Blow, Cast, Effect, EffectKit } from './types.ts';

/** Every effect of the kit (rpg/abilities.ts), each in its own small file. */
export const EFFECTS: Record<AbilityEffect, Effect> = {
  strike, bolt, heal, area, cone, line, dash, blink, shield, buff, debuff, taunt, trap, summon, stance, cleanse,
};
