// Every Calling's skills, gathered for ABILITIES (rpg.ts), and the common
// techniques a Calling skill takes the place of (docs/classes.md, Common
// techniques; Migration). One file per Calling; Path skills join them in
// build plan step 7b.

import type { CallingId } from '../classes.ts';
import type { AbilityDef } from '../rpg/abilities.ts';
import { BELLKEEPER_SKILLS } from './bellkeeper.ts';
import { DUELIST_SKILLS } from './duelist.ts';
import { RANGER_SKILLS } from './ranger.ts';
import { WARDEN_SKILLS } from './warden.ts';
import { WISHWEAVER_SKILLS } from './wishweaver.ts';

/** Each Calling's own skills, by Calling. */
export const SKILLS_BY_CALLING: Record<CallingId, Record<string, AbilityDef>> = {
  warden: WARDEN_SKILLS,
  duelist: DUELIST_SKILLS,
  ranger: RANGER_SKILLS,
  wishweaver: WISHWEAVER_SKILLS,
  bellkeeper: BELLKEEPER_SKILLS,
};

/** All Calling skills in one table. */
export const CALLING_SKILLS: Record<string, AbilityDef> = Object.assign({}, ...Object.values(SKILLS_BY_CALLING));

/**
 * A common technique a Calling skill replaces for that Calling: someone of
 * the Calling who knew it learns the skill in its place, on the same key.
 * Everyone else keeps the technique at its old numbers.
 */
export const REPLACES: Partial<Record<CallingId, Record<string, string>>> = {
  bellkeeper: { mend: 'bell-mend' },
  wishweaver: { firebolt: 'ember-bolt' },
};
