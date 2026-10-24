import { BIOMES, artFootprint, type BiomeId, type Footprint } from '@co-mmo/shared';

import { STYLE } from './style-profile.ts';

// The active art style's words under the names the prompt builders and tools
// use (style-profile.ts holds the words themselves).
export const STYLE_VERSION = STYLE.version;
export const BASE_PROMPT = STYLE.base;
/** The flat colour sprites are painted on; the pipeline turns it transparent. */
export const KEY_COLOR = STYLE.keyColor;
export const SPRITE_FRAMING = STYLE.sprite.framing;
export const TILE_FRAMING = STYLE.tile.framing;
export const NEGATIVE_PROMPT = STYLE.negatives;
const SPRITE_NEGATIVE = STYLE.sprite.negatives;
const TILE_NEGATIVE = STYLE.tile.negatives;

/** A prop is scenery the biome is built from: trees, palms, cacti, rocks. An effect is a flash of action, such as a sword slash. */
export type AssetKind = 'player' | 'npc' | 'monster' | 'item' | 'set-piece' | 'prop' | 'tile' | 'effect';

/** Pixel size of each kind at full resolution (Style Bible, Global rules). */
export const ASSET_SIZES: Record<AssetKind, { width: number; height: number }> = {
  player: { width: 128, height: 192 },
  npc: { width: 128, height: 192 },
  monster: { width: 128, height: 128 },
  item: { width: 128, height: 128 },
  'set-piece': { width: 512, height: 512 },
  prop: { width: 192, height: 256 },
  tile: { width: 128, height: 128 },
  effect: { width: 128, height: 128 },
};

/** The structured description the wish compiler fills in (Style Bible, Describing assets). */
export interface AssetDescription {
  name: string;
  kind: AssetKind;
  biome: BiomeId | 'any';
  silhouetteHook: string;
  body: string;
  materials?: string[];
  colors: { main: string; secondary?: string; accent?: string };
  details?: string[];
  mood: string;
  /** Kind-specific extras, e.g. role for NPCs or threat for monsters. */
  extra?: Record<string, string>;
  /** Words on how it is seen and framed, in place of its kind's (a wall face seen from the front, not ground from above). */
  framing?: string;
}

/**
 * The tiles a picture is painted standing on: in an isometric style, the
 * footprint of a set piece, prop or piece of furniture that has one; never in
 * a top-down style, whose pictures are not fitted to their tiles.
 */
export function paintedFootprint(id: string, kind = 'set-piece'): Footprint | undefined {
  if (STYLE.camera !== 'isometric' || kind === 'tile' || kind === 'effect') return undefined;
  return artFootprint(id);
}

/** How a thing is painted standing on its footprint, so the game can stand it on those tiles. */
export function footprintWords(fp: Footprint): string {
  const tiles = (n: number) => (n === 1 ? 'one tile' : `${n} tiles`);
  const sides = fp.width === fp.height ? `${tiles(fp.width)} along each side` : `${tiles(fp.width)} from the left corner down to the front corner, and ${tiles(fp.height)} from the front corner up to the right corner`;
  return `Footprint: it stands on a diamond-shaped patch of ground ${sides}. Its base fills that patch exactly, from the patch's left corner to its right corner, and nothing on the ground reaches past it.`;
}

/** Builds the full text prompt: base style, biome signatures, subject, the tiles it stands on, things to avoid. */
export function buildPrompt(d: AssetDescription, footprint?: Footprint): string {
  const tile = d.kind === 'tile';
  const lines = [BASE_PROMPT, d.framing ?? (tile ? TILE_FRAMING : SPRITE_FRAMING)];
  if (d.biome !== 'any') {
    const b = BIOMES[d.biome];
    lines.push(`Biome: ${b.name}. Palette leans on its key colours; light tint and mood of ${b.name}.`);
  }
  const subject = [
    `${d.name} (${d.kind}).`,
    `Most recognisable feature: ${d.silhouetteHook}.`,
    `Body and shape: ${d.body}.`,
    d.materials?.length ? `Materials: ${d.materials.join(', ')}.` : '',
    `Colours: main ${d.colors.main}${d.colors.secondary ? `, secondary ${d.colors.secondary}` : ''}${d.colors.accent ? `, small accent of ${d.colors.accent}` : ''}.`,
    // Details are often whole sentences; their own full stops would double the one that ends the list.
    d.details?.length ? `Details: ${d.details.slice(0, 3).map((x) => x.trim().replace(/[.!?]+$/, '')).join('; ')}.` : '',
    d.extra ? Object.entries(d.extra).map(([k, v]) => `${k}: ${v}.`).join(' ') : '',
    `Mood: ${d.mood}.`,
  ].filter(Boolean);
  lines.push(`Subject: ${subject.join(' ')}`);
  if (footprint) lines.push(footprintWords(footprint));
  lines.push(`Avoid: ${[...NEGATIVE_PROMPT, ...(tile ? TILE_NEGATIVE : SPRITE_NEGATIVE)].join(', ')}.`);
  return lines.join('\n');
}
