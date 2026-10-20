// Every granted wish is a mod (design doc, Wishes as mods): a Steward can
// switch it off and on again, or undo it for good. Switching off takes the
// wish's things out of the world without losing anything anyone holds: what
// is in a bag or spellbook sleeps until the wish is switched back on.
// An Engine wish's code checks `modOn` with its mod id and stands aside
// while its wish is off.

import type { ContentEntry } from './content.ts';

/** Who switched a wish off, and when. */
export interface ModSwitch {
  by: string;
  at: number;
}

/** Mod ids of Engine wishes switched off now. */
const OFF = new Set<string>();

/** Abilities whose wish is switched off: kept in spellbooks, not usable. */
export const SLEEPING_ABILITIES = new Set<string>();

/** The mod id an Engine wish's code checks: one per wish issue on GitHub. */
export function engineModId(issue: number): string {
  return `wish-${issue}`;
}

/**
 * True unless the Engine wish with this mod id is switched off. Code a
 * wish added runs only while this is true, so one click turns it off.
 */
export function modOn(id: string): boolean {
  return !OFF.has(id);
}

/** The mod ids switched off now, sorted, so a land laid out with a wish on is not reused with it off. */
export function modsOff(): string {
  return [...OFF].sort().join(',');
}

/** Switches an Engine wish's code on or off here (server, region server or browser). */
export function switchMod(id: string, on: boolean): void {
  if (on) OFF.delete(id);
  else OFF.add(id);
}

/** True when a wish is in the world now: granted and not switched off. */
export function standing(entry: Pick<ContentEntry, 'status' | 'off'>): boolean {
  return entry.status === 'granted' && !entry.off;
}
