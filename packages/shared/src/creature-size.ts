// How big each kind of monster stands. A kind's own size (CreatureDef.size)
// is where it starts; God's View can choose another for every monster of
// that kind at once, so similar monsters stay one size wherever they live.
// The size is the height its picture is shown at (walk.ts tiers) and how wide
// its body is and how far it reaches (hit-boxes.ts). Every choice is a content
// entry like a loot change (loot.ts): saved, shared with every region server
// and browser, and undone like any wish. The newest choice that stands wins.

import { CREATURES } from './rpg.ts';
import { CREATURE_HEIGHTS, type CreatureSizeTier } from './walk.ts';

/** The sizes, smallest first, as God's View offers them. */
export const SIZE_TIERS = Object.keys(CREATURE_HEIGHTS) as CreatureSizeTier[];

/** What each size is called where people read it. */
export const SIZE_WORDS: Record<CreatureSizeTier, string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium (a player’s height)',
  high: 'Tall',
  colossal: 'Colossal',
};

/** God's View choosing how big every monster of one kind stands. */
export interface SizeWish {
  kind: 'size';
  name: string;
  description: string;
  /** The creature kind's id. */
  creature: string;
  size: CreatureSizeTier;
}

/** True for one of the five sizes. */
export function isSizeTier(v: unknown): v is CreatureSizeTier {
  return typeof v === 'string' && v in CREATURE_HEIGHTS;
}

/** A size choice from God's View made clean, or what is wrong with it in words. */
export function validateSize(raw: unknown): SizeWish | string {
  const d = (raw ?? {}) as Record<string, unknown>;
  const creature = typeof d.creature === 'string' ? d.creature : '';
  const def = CREATURES[creature];
  if (!def) return 'That monster no longer lives in the world.';
  if (!isSizeTier(d.size)) return `Choose one of the sizes: ${SIZE_TIERS.map((t) => SIZE_WORDS[t].toLowerCase()).join(', ')}.`;
  return {
    kind: 'size',
    name: `${def.name} size`,
    description: `Every ${def.name} stands ${SIZE_WORDS[d.size].toLowerCase()}.`,
    creature,
    size: d.size,
  };
}

/** A size choice that stands, by content entry id. */
interface SizeChange {
  at: number;
  creature: string;
  size: CreatureSizeTier;
}

const CHANGES = new Map<string, SizeChange>();

/** Notes a granted size choice, replacing an earlier copy of the same entry. */
export function applySize(id: string, change: SizeChange): void {
  CHANGES.set(id, change);
}

/** Forgets a size choice that was undone or switched off. */
export function removeSize(id: string): void {
  CHANGES.delete(id);
}

/** How big a kind of creature stands now: the newest choice that stands, else its own size, else a player's (medium). */
export function creatureSize(kind: string): CreatureSizeTier {
  let newest: SizeChange | undefined;
  for (const c of CHANGES.values()) if (c.creature === kind && (!newest || c.at >= newest.at)) newest = c;
  return newest?.size ?? CREATURES[kind]?.size ?? 'medium';
}

/** How tall a kind of creature's figure is shown, in pixels (a player's is CHARACTER_HEIGHT). */
export function creatureHeight(kind: string): number {
  return CREATURE_HEIGHTS[creatureSize(kind)];
}
