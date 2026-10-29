import type { Cast, Effect, EffectKit } from '../effects/index.ts';

/**
 * What a Calling skill does beyond its effect's data (build plan step 7):
 * a check that takes the effect's place, or a run that wraps it. Kept per
 * Calling, beside the skill data in packages/shared/src/skills/.
 */
export interface SkillRule {
  /** Checked before Energy is spent, instead of the effect's own check. */
  ready?(kit: EffectKit, cast: Cast, effect: Effect): string | undefined;
  /** Does the skill; `effect` is its kit effect, to run as part of it. */
  run?(kit: EffectKit, cast: Cast, effect: Effect): void;
}
