import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { CHARACTER_HEIGHT, RACES, familyArt, isoSpan, itemFromWish, type BiomeId, type Footprint, type PicturedWish, type RaceId } from '@co-mmo/shared';
import { pictureName } from './names.ts';
import { removeKeyBackground } from './postprocess.ts';
import type { GeneratedImage, ImageProvider } from './provider.ts';
import { buildPrompt, type AssetDescription, type AssetKind } from './style.ts';

/** Price of one Gemini image (gemini-2.5-flash-image), US dollars: Google's list price for a 1024px image (1290 output tokens at $30 per million). */
export const IMAGE_USD = 0.039;

/**
 * US dollars per million image tokens, by model. Gemini 3 Pro Image is
 * Google's list price; Gemini 3.1 Flash Image is an ESTIMATE until checked.
 */
const IMAGE_USD_PER_MILLION: Record<string, number> = {
  'gemini-2.5-flash-image': 30,
  'gemini-3-pro-image': 120,
  'gemini-3-pro-image-preview': 120,
  'gemini-3.1-flash-image': 60,
  'gemini-3.1-flash-image-preview': 60,
};

/** What one generated image cost: from the tokens billed when known, else the 1024 px price. */
export function imageUsd(model: string, image: GeneratedImage): number {
  const rate = IMAGE_USD_PER_MILLION[model];
  if (!rate || !image.outputTokens) return IMAGE_USD;
  return (image.outputTokens * rate) / 1e6;
}

/** Image models with a known price, for God's View to offer. */
export function knownImageModels(): string[] {
  return Object.keys(IMAGE_USD_PER_MILLION).filter((m) => !m.endsWith('-preview'));
}

/** Image tokens Gemini bills for a 1024 px picture, used to guess a price before painting. */
const TOKENS_1K = 1290;

/** About what one 1K picture from this model costs, before it is painted (for previews). */
export function estimateImageUsd(model: string): number {
  const rate = IMAGE_USD_PER_MILLION[model];
  return rate ? (TOKENS_1K * rate) / 1e6 : IMAGE_USD;
}

/** Approved anchors sent as style references, per kind of wished thing. */
const REFERENCES: Record<PicturedWish['kind'], string[]> = {
  item: ['item-tonic', 'item-goat-horn'],
  ability: ['item-scroll', 'item-tonic'],
  creature: ['woods-mushroom', 'shore-crab-knight'],
  npc: ['sanctum-pilgrim', 'woods-herbalist'],
  player: ['player-mara', 'player-ilya'],
};

/**
 * A launch biome's own creature and person, sent first so a wished creature
 * or person matches the place it lives in; other biomes have none yet.
 */
const BIOME_REFERENCES: Partial<Record<BiomeId, { creature?: string; npc: string }>> = {
  sanctum: { npc: 'sanctum-pilgrim' },
  'whispering-woods': { creature: 'woods-mushroom', npc: 'woods-herbalist' },
  'sunlit-shore': { creature: 'shore-crab-knight', npc: 'shore-trader' },
  'mirage-desert': { creature: 'desert-scarab', npc: 'desert-cactus-folk' },
};

/**
 * The anchors sent with a wished thing's picture: two, its biome's own
 * first; a player's look sends their people's body first, so an Ursine
 * stays a bear whatever they wear (docs/races.md).
 */
export function referencesFor(kind: PicturedWish['kind'], biome: BiomeId, race?: RaceId): string[] {
  const own = kind === 'creature' || kind === 'npc' ? BIOME_REFERENCES[biome]?.[kind] : kind === 'player' && race ? RACES[race].body : undefined;
  return own ? [own, ...REFERENCES[kind].filter((r) => r !== own)].slice(0, 2) : REFERENCES[kind];
}

const KIND: Record<PicturedWish['kind'], AssetKind> = { item: 'item', ability: 'item', creature: 'monster', npc: 'npc', player: 'player' };

/** Box the art is fitted into, feet at the bottom centre (as build-game-art). */
const BOX: Record<PicturedWish['kind'], { width: number; height: number }> = {
  item: { width: 128, height: 128 },
  ability: { width: 128, height: 128 },
  creature: { width: 128, height: 128 },
  npc: { width: 128, height: 192 },
  player: { width: 128, height: 192 },
};

export function describeWish(def: PicturedWish, biome: BiomeId): AssetDescription {
  return {
    name: def.kind === 'ability' ? `Scroll of ${def.name}` : def.name,
    kind: KIND[def.kind],
    biome: def.kind === 'creature' || def.kind === 'npc' ? biome : 'any',
    silhouetteHook: def.kind === 'ability' ? `a rolled spell scroll with a seal showing ${def.look.hook}` : def.look.hook,
    body: def.look.body,
    colors: { main: def.look.color },
    // The people decides the body; the player's words decide the rest (docs/races.md).
    details: def.kind === 'player' && def.race ? [`one of the ${RACES[def.race].name}, ${RACES[def.race].animal}folk`, def.description] : [def.description],
    mood: def.look.mood,
  };
}

/** Everything sent to the image model for one wished picture, worked out before anything is painted. */
export interface ArtRequest {
  prompt: string;
  /** Anchor ids sent as style references. */
  references: string[];
  /** The box the painted sprite is fitted into. */
  box: { width: number; height: number };
}

/**
 * What painting a wished thing will ask of the image model. Painting and
 * previews both use this, so a preview shows exactly what will be sent.
 */
export function artRequest(def: PicturedWish, biome: BiomeId): ArtRequest {
  const references = referencesFor(def.kind, biome, def.kind === 'player' ? def.race : undefined);
  return { prompt: buildPrompt(describeWish(def, biome)), references: withFamily(def, references), box: BOX[def.kind] };
}

/** A wished weapon or off-hand item sends its family's own picture first, so a wished bow is drawn as a bow. */
function withFamily(def: PicturedWish, references: string[]): string[] {
  if (def.kind !== 'item') return references;
  const gear = itemFromWish('', def);
  const family = gear.weapon ?? gear.offhand;
  return family ? [familyArt(family), references[0]!] : references;
}

/**
 * Paints a wished thing with the image provider, in the style of the anchors,
 * and writes the game-sized PNG into `artDir` as `<id>.png`. Returns what
 * was sent (only the references that were found) and the provider's image.
 */
export async function paintWish(
  id: string,
  def: PicturedWish,
  biome: BiomeId,
  provider: ImageProvider,
  anchorDir: string,
  artDir: string,
  /** A Steward's or the Owner's own wording, in place of the built prompt. */
  prompt?: string,
): Promise<PaintedWish> {
  const built = artRequest(def, biome);
  const request = prompt ? { ...built, prompt } : built;
  const references: GeneratedImage[] = [];
  const sent: string[] = [];
  for (const ref of request.references) {
    try {
      references.push({ mimeType: 'image/png', data: await readFile(resolve(anchorDir, `${ref}.png`)) });
      sent.push(ref);
    } catch {
      // A missing reference only weakens the style match.
    }
  }
  const raw = await provider.generate({ prompt: request.prompt, references, labels: sent.map(pictureName) });
  const { png, clean } = await removeKeyBackground(await sharp(raw.data).png().toBuffer());
  // People stand the same height as everyone else; things fit their box.
  const fitted = def.kind === 'player' || def.kind === 'npc' ? await fitCharacter(png, request.box) : await fitToBox(png, request.box);
  await mkdir(artDir, { recursive: true });
  await writeFile(resolve(artDir, `${id}.png`), fitted);
  return { request: { ...request, references: sent }, image: raw, cutOut: png, plainBackground: clean, fitted, referenceImages: references.map((r) => r.data) };
}

/** A painted wish picture, with what the style check looks at. */
export interface PaintedWish {
  /** What was sent, with only the references that were found. */
  request: ArtRequest;
  /** The provider's image as it came. */
  image: GeneratedImage;
  /** At full size with the background cut away, before fitting. */
  cutOut: Buffer;
  /** Whether the background was one plain key colour. */
  plainBackground: boolean;
  /** The game-sized picture written to disk. */
  fitted: Buffer;
  /** The anchors that were sent. */
  referenceImages: Buffer[];
}

/**
 * Trims the transparent margin and scales a person so the figure is
 * CHARACTER_HEIGHT tall, feet on the bottom row of a box as tall as `box`;
 * a figure wider than the box widens it rather than shrinking.
 */
export async function fitCharacter(png: Buffer, box: { width: number; height: number }): Promise<Buffer> {
  const trimmed = await sharp(png).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  const scale = CHARACTER_HEIGHT / trimmed.info.height;
  const w = Math.max(1, Math.round(trimmed.info.width * scale));
  const width = Math.max(box.width, Math.ceil(w / 2) * 2);
  const resized = await sharp(trimmed.data).resize(w, CHARACTER_HEIGHT, { kernel: 'lanczos3' }).png().toBuffer();
  return sharp({ create: { width, height: box.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.floor((width - w) / 2), top: box.height - CHARACTER_HEIGHT }])
    .png()
    .toBuffer();
}

/** Trims the transparent margin, scales to fit and pads with the feet on the bottom row. */
export async function fitToBox(png: Buffer, box: { width: number; height: number }): Promise<Buffer> {
  const trimmed = await sharp(png).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  const scale = Math.min(box.width / trimmed.info.width, box.height / trimmed.info.height);
  const w = Math.max(1, Math.round(trimmed.info.width * scale));
  const h = Math.max(1, Math.round(trimmed.info.height * scale));
  const resized = await sharp(trimmed.data).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  return sharp({ create: { width: box.width, height: box.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left: Math.floor((box.width - w) / 2), top: box.height - h }])
    .png()
    .toBuffer();
}

/**
 * Trims the transparent margin and scales a thing painted standing on its
 * footprint to the width of that footprint's diamond in the isometric
 * camera, its height following.
 */
export async function fitToFootprint(png: Buffer, footprint: Footprint): Promise<Buffer> {
  const trimmed = await sharp(png).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  const width = Math.round(isoSpan(footprint.width, footprint.height));
  const height = Math.max(1, Math.round((width * trimmed.info.height) / trimmed.info.width));
  return sharp(trimmed.data).resize(width, height, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
}
