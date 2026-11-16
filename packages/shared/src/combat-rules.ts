// The Owner's combat rules (God's View, Combat page): choices about how
// fights play that are the Owner's to make rather than the code's. They are
// saved with the world and every region server follows the same ones.

/** How fights play, as the Owner set them. */
export interface CombatRules {
  /** Shots and spells stop at the first body in their line (another creature, a player, a person); off, they fly over everyone. */
  bodiesBlockShots: boolean;
}

/** The rules until the Owner changes them: shots fly over bodies, as they always have. */
export const DEFAULT_COMBAT_RULES: CombatRules = { bodiesBlockShots: false };

/** Saved rules with anything an older save lacks filled in. */
export function combatRules(saved?: Partial<CombatRules> | null): CombatRules {
  return { ...DEFAULT_COMBAT_RULES, ...(saved ?? {}), bodiesBlockShots: saved?.bodiesBlockShots === true };
}
