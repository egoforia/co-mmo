import { BELLKEEPER_RULES } from './bellkeeper.ts';
import type { SkillRule } from './types.ts';
import { WARDEN_RULES } from './warden.ts';
import { WISHWEAVER_RULES } from './wishweaver.ts';

export { tendSanctuaries } from './bellkeeper.ts';
export type { SkillRule } from './types.ts';

/**
 * Calling skills that do more than their effect's data says, by ability id
 * (build plan step 7). Duelist and Ranger core skills are data alone; their
 * Riposte and Sidestep are answered where creatures strike (region/minds.ts).
 */
export const SKILL_RULES: Record<string, SkillRule> = { ...WARDEN_RULES, ...WISHWEAVER_RULES, ...BELLKEEPER_RULES };
