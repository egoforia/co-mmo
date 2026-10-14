import { BIOMES, type BiomeId } from '@co-mmo/shared';

// The Style Bible's base prompt and negative prompt, versioned so every
// asset's recipe records which rules it was made under.
export const STYLE_VERSION = 1;

export const BASE_PROMPT = [
  'Hand-painted 2D game sprite in the style of a 1999 storybook RPG.',
  'Three-quarter top-down view. Soft watercolour and gouache shading with visible brush texture',
  'and 3 to 5 value steps per colour. Warm golden key light from the upper left, blue-violet shadows.',
  'Selective coloured outlines, rounded organic shapes, whimsical fairy-tale mood.',
  'Softened saturation, plain flat background, centred, no ground shadow.',
].join('\n');

export const NEGATIVE_PROMPT = [
  'photorealistic', '3D render', 'anime cel shading', 'vector art', 'flat design', 'thick black outlines',
  'pure black', 'pure white', 'harsh contrast', 'neon', 'gradients', 'lens flare', 'blur', 'noise',
  'text', 'letters', 'watermark', 'signature', 'frame', 'border', 'background scenery', 'cast shadow',
];

export type AssetKind = 'player' | 'npc' | 'monster' | 'item' | 'set-piece' | 'tile';

/** Pixel size of each kind at full resolution (Style Bible, Global rules). */
export const ASSET_SIZES: Record<AssetKind, { width: number; height: number }> = {
  player: { width: 128, height: 192 },
  npc: { width: 128, height: 192 },
  monster: { width: 128, height: 128 },
  item: { width: 128, height: 128 },
  'set-piece': { width: 512, height: 512 },
  tile: { width: 128, height: 128 },
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
  const lines = [BASE_PROMPT];
  if (d.biome !== 'any') {
    const b = BIOMES[d.biome];
    lines.push(`Biome: ${b.name}. Palette leans on its key colours; light tint and mood of ${b.name}.`);
  }
  if (d.kind === 'tile') {
    // Tiles fill the frame edge to edge and must repeat seamlessly.
    lines.push('Seamless square ground texture seen from above at three-quarter view, filling the whole frame, tileable on all edges.');
  }
  const subject = [
    `${d.name} (${d.kind}).`,
    `Most recognisable feature: ${d.silhouetteHook}.`,
    `Body and shape: ${d.body}.`,
    d.materials?.length ? `Materials: ${d.materials.join(', ')}.` : '',
    `Colours: main ${d.colors.main}${d.colors.secondary ? `, secondary ${d.colors.secondary}` : ''}${d.colors.accent ? `, small accent of ${d.colors.accent}` : ''}.`,
    d.details?.length ? `Details: ${d.details.slice(0, 3).join('; ')}.` : '',
    d.extra ? Object.entries(d.extra).map(([k, v]) => `${k}: ${v}.`).join(' ') : '',
    `Mood: ${d.mood}.`,
  ].filter(Boolean);
  lines.push(`Subject: ${subject.join(' ')}`);
  lines.push(`Avoid: ${NEGATIVE_PROMPT.join(', ')}.`);
  return lines.join('\n');
}
