// Path skills (docs/classes/*.md, Paths; build plan step 7b): for each
// Calling's two Paths, an active skill at level 10, a passive at 15 and a
// great skill at 20. Actives join ABILITIES like every skill; passives work
// by themselves and take no key. Numbers the effect kit has no field for are
// in `numbers`, and the server's region/paths/ reads them. One file per Calling.

import type { CallingId } from '../classes.ts';
import type { AbilityDef } from '../rpg/abilities.ts';
import { BELLKEEPER_PATHS } from './bellkeeper-paths.ts';
import { DUELIST_PATHS } from './duelist-paths.ts';
import { RANGER_PATHS } from './ranger-paths.ts';
import { WARDEN_PATHS } from './warden-paths.ts';
import { WISHWEAVER_PATHS } from './wishweaver-paths.ts';

/** A Path skill's numbers beyond its AbilityDef, named for what they do in the Paths tables. */
export interface PathNumbers {
  /** A share of max health (Barkskin each second, Last Knight's heal, Thirsting Blade per pip, the hawk's health, Overtone's cap, Knell's heal) or of a hit (Blazing Edge's burn). */
  share?: number;
  /** A chance (Retaliate). */
  chance?: number;
  /** Attribute × this (Retaliate's Might, Iron Psalm's Vigor). */
  factor?: number;
  /** How much more damage is dealt or taken (Pack Instinct, Loose Ends, Knell). */
  more?: number;
  /** How much less a creature deals (Knell). */
  less?: number;
  /** Separate hits in all (Sunfall Dance's strikes, Starfall's stars). */
  hits?: number;
  /** Seconds it runs or waits (Sunfall Dance, Dune Tempest, Firestorm, Starfall, Skyfall's draw, Steady Breath, Rewrite's look back, Blazing Edge's burn, Overtone's shield). */
  seconds?: number;
  /** Seconds between its hits or heals (Dune Tempest, Call Companion). */
  every?: number;
  /** Your weapon's hit × this (Sunfall Dance, Dune Tempest, Call Companion). */
  weapon?: number;
  /** Execute: against a creature under this share of its health, its damage is × `times`. */
  below?: number;
  times?: number;
  /** Seconds you stay Hidden (Mirage). */
  hidden?: number;
  /** Tiles a creature is knocked back (Stampede). */
  push?: number;
  /** How much longer your slows last (Loose Ends). */
  longer?: number;
  /** Weave left after it (Starfall). */
  weave?: number;
  /** Extra damage per Echo rung (Final Knell). */
  perEcho?: number;
  /** Share of health a raised ally gets (Great Bell of Waking). */
  raise?: number;
}

/** A passive: always on from its level, with no key and no cost. */
export interface PassiveDef {
  name: string;
  description: string;
}

/** One Path skill: an active (`ability`) or a passive. */
export interface PathSkill {
  level: 10 | 15 | 20;
  ability?: AbilityDef;
  passive?: PassiveDef;
  numbers?: PathNumbers;
}

/** Each Calling's Path skills, by skill id. */
export const PATH_SKILLS_BY_CALLING: Record<CallingId, Record<string, PathSkill>> = {
  warden: WARDEN_PATHS,
  duelist: DUELIST_PATHS,
  ranger: RANGER_PATHS,
  wishweaver: WISHWEAVER_PATHS,
  bellkeeper: BELLKEEPER_PATHS,
};

/** Every Path skill in one table. */
export const PATH_SKILLS: Record<string, PathSkill> = Object.assign({}, ...Object.values(PATH_SKILLS_BY_CALLING));

/** The active Path skills, for ABILITIES (rpg.ts). */
export const PATH_ABILITIES: Record<string, AbilityDef> = Object.fromEntries(
  Object.entries(PATH_SKILLS).flatMap(([id, s]) => (s.ability ? [[id, s.ability]] : [])),
);

/** A Path skill's extra numbers (none when it has none). */
export function pathNumbers(id: string): PathNumbers {
  return PATH_SKILLS[id]?.numbers ?? {};
}

/** A Path skill's name, active or passive. */
export function pathSkillName(id: string): string {
  const s = PATH_SKILLS[id];
  return s?.ability?.name ?? s?.passive?.name ?? id;
}
