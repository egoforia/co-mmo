import { BIOMES, type BiomeId } from '@co-mmo/shared';

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
}

/** Builds the full text prompt: base style, biome signatures, subject, things to avoid. */
export function buildPrompt(d: AssetDescription): string {
  const tile = d.kind === 'tile';
  const lines = [BASE_PROMPT, tile ? TILE_FRAMING : SPRITE_FRAMING];
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
  lines.push(`Avoid: ${[...NEGATIVE_PROMPT, ...(tile ? TILE_NEGATIVE : SPRITE_NEGATIVE)].join(', ')}.`);
  return lines.join('\n');
}
