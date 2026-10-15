import { BIOMES, type BiomeId } from '@co-mmo/shared';

// The Style Bible's base prompt and negative prompt, versioned so every
// asset's recipe records which rules it was made under.
export const STYLE_VERSION = 2;

export const BASE_PROMPT = [
  'Hand-painted 2D game art in the style of a 1999 storybook RPG.',
  'Soft watercolour and gouache shading with visible brush texture and 3 to 5 value steps per colour.',
  'Warm golden key light from the upper left, blue-violet shadows.',
  'Selective coloured outlines, rounded organic shapes, whimsical fairy-tale mood. Softened saturation.',
  'No writing anywhere: labels, signs and covers are blank or carry simple symbols.',
].join('\n');

/** The flat colour sprites are painted on; the pipeline turns it transparent. */
export const KEY_COLOR = { r: 255, g: 0, b: 255, hex: '#FF00FF' };

export const SPRITE_FRAMING = [
  'A single game sprite in three-quarter top-down view, centred, with empty margin all around it.',
  `Background: one flat solid pure magenta (${KEY_COLOR.hex}) filling everything behind the subject,`,
  'with no floor, scenery, gradient, glow, vignette or shadow on it. No magenta anywhere in the subject.',
].join('\n');

export const TILE_FRAMING = [
  'A ground texture tile: flat ground seen from directly above, filling the entire square frame edge to edge.',
  'Not a block, diamond, island or platform: no sides, thickness, border, frame or horizon.',
  'Even lighting and low contrast across the whole tile; small details spread evenly with no clumps, patches or single large feature, so it repeats seamlessly on all four edges.',
].join('\n');

export const NEGATIVE_PROMPT = [
  'photorealistic', '3D render', 'anime cel shading', 'vector art', 'flat design', 'thick black outlines',
  'pure black', 'pure white', 'harsh contrast', 'neon', 'lens flare', 'blur', 'noise',
  'text', 'letters', 'words', 'labels with writing', 'watermark', 'signature', 'frame', 'border', 'vignette',
];
const SPRITE_NEGATIVE = ['background scenery', 'floor', 'ground shadow', 'cast shadow', 'gradient background'];
const TILE_NEGATIVE = ['isometric block', 'diamond shape', 'floating island', 'tile sides', 'drop shadow', 'perspective horizon'];

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
