import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { BiomeId, WishDefinition } from '@co-mmo/shared';
import { removeKeyBackground } from './postprocess.ts';
import type { GeneratedImage, ImageProvider } from './provider.ts';
import { buildPrompt, type AssetDescription, type AssetKind } from './style.ts';

/** Price of one Gemini image (gemini-2.5-flash-image), US dollars. */
export const IMAGE_USD = 0.039;

/** Approved anchors sent as style references, per kind of wished thing. */
const REFERENCES: Record<WishDefinition['kind'], string[]> = {
  item: ['item-tonic', 'item-goat-horn'],
  creature: ['woods-mushroom', 'shore-crab-knight'],
  npc: ['sanctum-pilgrim', 'woods-herbalist'],
};

const KIND: Record<WishDefinition['kind'], AssetKind> = { item: 'item', creature: 'monster', npc: 'npc' };

/** Box the art is fitted into, feet at the bottom centre (as build-game-art). */
const BOX: Record<WishDefinition['kind'], { width: number; height: number }> = {
  item: { width: 128, height: 128 },
  creature: { width: 128, height: 128 },
  npc: { width: 128, height: 192 },
};

export function describeWish(def: WishDefinition, biome: BiomeId): AssetDescription {
  return {
    name: def.name,
    kind: KIND[def.kind],
    biome: def.kind === 'item' ? 'any' : biome,
    silhouetteHook: def.look.hook,
    body: def.look.body,
    colors: { main: def.look.color },
    details: [def.description],
    mood: def.look.mood,
  };
}

/**
 * Paints a wished thing with the image provider, in the style of the anchors,
 * and writes the game-sized PNG into `artDir` as `<id>.png`.
 */
export async function paintWish(
  id: string,
  def: WishDefinition,
  biome: BiomeId,
  provider: ImageProvider,
  anchorDir: string,
  artDir: string,
): Promise<void> {
  const references: GeneratedImage[] = [];
  for (const ref of REFERENCES[def.kind]) {
    try {
      references.push({ mimeType: 'image/png', data: await readFile(resolve(anchorDir, `${ref}.png`)) });
    } catch {
      // A missing reference only weakens the style match.
    }
  }
  const raw = await provider.generate({ prompt: buildPrompt(describeWish(def, biome)), references });
  const { png } = await removeKeyBackground(await sharp(raw.data).png().toBuffer());
  const fitted = await fitToBox(png, BOX[def.kind]);
  await mkdir(artDir, { recursive: true });
  await writeFile(resolve(artDir, `${id}.png`), fitted);
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
