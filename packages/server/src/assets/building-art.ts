import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  BIOMES,
  PIXEL_ART_SCALE,
  TILE_PIXELS,
  buildingArt,
  furnitureArt,
  type ArtEntry,
  type BuildingStyle,
} from '@co-mmo/shared';
import { makeSeamless, pixelate, removeKeyBackground, removeKeySpill, trimRows } from './postprocess.ts';
import type { GeneratedImage, ImageProvider, ImageRequest } from './provider.ts';
import { BASE_PROMPT, KEY_COLOR, NEGATIVE_PROMPT } from './style.ts';

// Paints every picture a building needs with the image model chosen in God's
// View (see BUILDING_STYLES in packages/shared/src/buildings.ts for how the
// pieces fit together). The outside is painted like the rest of the world;
// the inside is pixel art in the outside's colours.

/** One picture to paint for a building style. */
export interface BuildingArtJob {
  id: string;
  kind: 'exterior' | 'tile' | 'furniture';
  prompt: string;
  /** Art ids sent along as references: approved anchors, or this style's outside. */
  references: string[];
  aspectRatio: string;
  size: ImageRequest['size'];
  /** Furniture: how wide it is drawn, in tiles. */
  width?: number;
}

/** Widest the outside art is kept, in pixels: sharp at the closest camera zoom without huge downloads. */
const MAX_EXTERIOR_PIXELS = 2048;
/** Art pixels across one tile. */
const TILE_ART_PIXELS = TILE_PIXELS / PIXEL_ART_SCALE;

const PIXEL_STYLE = [
  'Pixel art game graphics in the style of a 16-bit SNES / PS1 Legend of Mana RPG interior.',
  'Every art pixel is a crisp, hard-edged square block: no anti-aliasing, no smooth gradients, no blur.',
  'A limited palette of about 16 colours taken from the reference painting, warm light from the upper left. No writing anywhere.',
].join('\n');

const TILE_FRAMING = [
  'A texture tile seen from directly above, filling the entire square frame edge to edge, drawn as if 32 by 32 pixels scaled up.',
  'Even lighting and low contrast, small details spread evenly with no single big feature, no moss clumps, mushrooms or objects,',
  'so it repeats seamlessly on all four edges. No border, frame, perspective, wall face or shadow at the edges.',
].join('\n');

const SPRITE_FRAMING = [
  'A single sprite in three-quarter top-down view, centred, with empty margin all around it, with a darker coloured outline.',
  `Background: one flat solid pure magenta (${KEY_COLOR.hex}) filling everything behind the subject, with no floor, gradient, glow or shadow on it. No magenta anywhere in the subject.`,
  'Fire and light have no glow or halo spilling outside the object.',
].join('\n');

/** The pictures a building style needs, outside first: the inside is painted to match it. */
export function buildingArtJobs(style: BuildingStyle): BuildingArtJob[] {
  const exterior = buildingArt(style.id, 'exterior');
  const biome = style.biome === 'any' ? '' : `Biome: ${BIOMES[style.biome].name}; its light and mood.`;
  const jobs: BuildingArtJob[] = [{
    id: exterior,
    kind: 'exterior',
    references: style.references ?? [],
    aspectRatio: '4:5',
    size: '2K',
    prompt: [
      BASE_PROMPT,
      'The first image is a layout sketch: a dark door arch on a magenta background. Paint finished, richly detailed game art over it:',
      'the front door of the building is exactly where the dark arch is, at the middle of the bottom edge,',
      'the same size as the arch. Paint the whole building around that door, filling the frame from side to side and top to bottom, with its natural outline.',
      'with a few short steps or a threshold leading down from the door to the bottom edge. Nothing else stands in front of the door.',
      style.references?.length ? 'The other images show the approved art style and, where it is the same place, how it looked before: keep its character.' : '',
      biome,
      `Subject: ${style.name}, the whole building seen from outside, three-quarter top-down view. ${style.exterior}.`,
      `Background: one flat solid pure magenta (${KEY_COLOR.hex}) filling everything behind the building, with no ground, scenery, gradient, glow or shadow on it. No magenta anywhere in the building. Lanterns and windows have no glow or halo spilling onto the background.`,
      `Avoid: ${[...NEGATIVE_PROMPT, 'background scenery', 'cast shadow on the background'].join(', ')}.`,
    ].filter(Boolean).join('\n'),
  }];
  for (const part of ['floor', 'wall', 'door'] as const) {
    jobs.push({
      id: buildingArt(style.id, part),
      kind: 'tile',
      references: [exterior],
      aspectRatio: '1:1',
      size: '1K',
      prompt: [PIXEL_STYLE, TILE_FRAMING, `Subject: inside ${style.name}, ${style[part]}.`, 'Colours: match the reference painting of the same building from outside.'].join('\n'),
    });
  }
  for (const [key, piece] of Object.entries(style.furniture)) {
    jobs.push({
      id: furnitureArt(style.id, key),
      kind: 'furniture',
      references: [exterior],
      aspectRatio: '1:1',
      size: '1K',
      width: piece.width,
      prompt: [PIXEL_STYLE, SPRITE_FRAMING, `Subject: the ${piece.name} inside ${style.name}: ${piece.look}.`, 'Colours: match the reference painting of the same building from outside.'].join('\n'),
    });
  }
  return jobs;
}

/** Where building art is read from and written to. */
export interface BuildingArtDirs {
  /** Approved anchors (assets/anchors), for references. */
  anchorDir: string;
  /** The provider's untouched images, kept to reprocess for free and as references. */
  rawDir: string;
  /** Game-ready PNGs. */
  outDir: string;
}

/** Paints one picture: asks the provider, keeps the raw image, writes the game copy. */
export async function paintBuildingArt(
  job: BuildingArtJob,
  provider: ImageProvider,
  dirs: BuildingArtDirs,
): Promise<{ image: GeneratedImage; entry: ArtEntry }> {
  const references: GeneratedImage[] = [];
  if (job.kind === 'exterior') references.push({ mimeType: 'image/png', data: await layoutSketch() });
  for (const ref of job.references) {
    for (const path of [resolve(dirs.rawDir, `${ref}.png`), resolve(dirs.anchorDir, 'raw', `${ref}.png`), resolve(dirs.anchorDir, `${ref}.png`)]) {
      const data = await readFile(path).catch(() => undefined);
      if (!data) continue;
      references.push({ mimeType: 'image/png', data });
      break;
    }
  }
  const image = await provider.generate({ prompt: job.prompt, references, aspectRatio: job.aspectRatio, size: job.size });
  await mkdir(dirs.rawDir, { recursive: true });
  await writeFile(resolve(dirs.rawDir, `${job.id}.png`), await sharp(image.data).png().toBuffer());
  return { image, entry: await processBuildingArt(job, image.data, dirs.outDir) };
}

/** Turns a provider image into the game copy, and says how big it is. */
export async function processBuildingArt(job: BuildingArtJob, raw: Buffer, outDir: string): Promise<ArtEntry> {
  const png = await sharp(raw).png().toBuffer();
  let out: Buffer;
  if (job.kind === 'tile') {
    // The middle of the picture, made to wrap, then turned into pixel art.
    const { width = 0, height = 0 } = await sharp(png).metadata();
    const crop = await sharp(png)
      .extract({ left: Math.round(width / 4), top: Math.round(height / 4), width: Math.round(width / 2), height: Math.round(height / 2) })
      .png()
      .toBuffer();
    out = await pixelate(await makeSeamless(crop), TILE_ART_PIXELS, TILE_ART_PIXELS, PIXEL_ART_SCALE, 16);
  } else if (job.kind === 'furniture') {
    const { png: keyed } = await removeKeyBackground(png, undefined, { holes: true });
    const trimmed = await sharp(await removeKeySpill(keyed)).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
    const w = Math.round((job.width ?? 1) * TILE_ART_PIXELS);
    const h = Math.max(1, Math.round((w * trimmed.info.height) / trimmed.info.width));
    out = await pixelate(trimmed.data, w, h, PIXEL_ART_SCALE, 24);
  } else {
    // Keep the full width: the door is painted at the middle of it.
    const { png: keyed } = await removeKeyBackground(png, undefined, { holes: true });
    const rows = await trimRows(await removeKeySpill(keyed));
    const { width = 0 } = await sharp(rows).metadata();
    // WebP keeps this big picture to a sensible download.
    out = await sharp(rows).resize({ width: Math.min(width, MAX_EXTERIOR_PIXELS), kernel: 'lanczos3' }).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
  }
  const file = `${job.id}.${artExtension(job)}`;
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, file), out);
  const { width = 0, height = 0 } = await sharp(out).metadata();
  return { file: `art/${file}`, kind: job.kind === 'exterior' ? 'building' : job.kind, width, height };
}

/** The game copy's file type: WebP for a building's big outside, PNG for crisp pixel art. */
export function artExtension(job: BuildingArtJob): 'webp' | 'png' {
  return job.kind === 'exterior' ? 'webp' : 'png';
}

/**
 * The layout sketch sent with every building's outside: the door arch at the
 * middle of the bottom edge, on the key colour. The model paints the building
 * around it, which is what puts the door where the doorway is; anything more
 * in the sketch gets copied as it is.
 */
export async function layoutSketch(): Promise<Buffer> {
  const w = 800;
  const h = 1000;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<rect width="100%" height="100%" fill="${KEY_COLOR.hex}"/>
<path d="M ${w * 0.44} ${h * 0.97} L ${w * 0.44} ${h * 0.85} A ${w * 0.06} ${w * 0.06} 0 0 1 ${w * 0.56} ${h * 0.85} L ${w * 0.56} ${h * 0.97} Z" fill="#3a2418"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
