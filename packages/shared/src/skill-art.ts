// The pictures skills show (build plan step 10): a burst on whoever a thread
// or bell strikes, what a skill leaves in the world (traps, Echoes, hallowed
// ground, the spirit hawk, the Sandstorm double) and an icon per status.
// Each is an anchor painted by the image model; until one is painted the
// game shows nothing in its place (a status shows its name instead).

import type { Thread } from './rpg/abilities.ts';
import { ABILITIES } from './rpg.ts';
import type { StatusId } from './rpg/statuses.ts';
import { BELLKEEPER_SKILLS } from './skills/bellkeeper.ts';
import { BELLKEEPER_PATHS } from './skills/bellkeeper-paths.ts';

/** The burst a Wishweaver's thread shows where it strikes. */
export const THREAD_ART: Record<Thread, string> = { ember: 'fx-ember', tide: 'fx-tide', gale: 'fx-gale' };

/** A bell's ring where a Bellkeeper's skill strikes or heals. */
export const BELL_ART = 'fx-bell';
/** An Echo waiting on a friend until a Toll rings it. */
export const ECHO_ART = 'fx-echo';
/** A trap set on the ground. */
export const TRAP_ART = 'fx-trap';
/** The mark hanging over a Marked creature. */
export const MARK_ART = 'fx-mark';
/** Hallowed ground, such as a Bellkeeper's Sanctuary. */
export const HALLOWED_ART = 'fx-hallowed-ground';

/** The Wildkin's spirit hawk (Call Companion), a small creature. */
export const SPIRIT_HAWK_ART = 'spirit-hawk';
/** The double of sand a Sandstorm Duelist's Mirage leaves behind, as tall as a player. */
export const SAND_DOUBLE_ART = 'sandstorm-double';

/** The skill whose helper is the spirit hawk. */
export const HAWK_SKILL = 'call-companion';

/** Every skill effect's art id, for painting and tests. */
export const EFFECT_ARTS: readonly string[] = [...Object.values(THREAD_ART), BELL_ART, ECHO_ART, TRAP_ART, MARK_ART, HALLOWED_ART];

/** A status's icon, shown over name tags and in the HUD. */
export function statusArt(id: StatusId): string {
  return `status-${id}`;
}

const BELLS = new Set([...Object.keys(BELLKEEPER_SKILLS), ...Object.keys(BELLKEEPER_PATHS)]);

/** The burst shown where this ability strikes or heals: its thread's, a bell's, or none. */
export function hitArt(ability: string | undefined): string | undefined {
  if (!ability) return undefined;
  const thread = ABILITIES[ability]?.thread;
  if (thread) return THREAD_ART[thread];
  return BELLS.has(ability) ? BELL_ART : undefined;
}
