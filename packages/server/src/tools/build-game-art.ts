// Turns the approved reference images and biome kit (assets/anchors, 1024 px) into the
// sizes the game draws (Style Bible, Global rules: Size), and writes a
// manifest the client loads.
//
//   npm run game-art
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { ArtManifest, ArtEntry } from '@co-mmo/shared';
import { fitCharacter } from '../assets/wish-art.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const anchorDir = resolve(root, 'assets/anchors');
const outDir = resolve(root, 'packages/client/public/art');

/** Box each kind is fitted into, feet at the bottom centre. */
const BOX: Record<string, { width: number; height: number }> = {
  tile: { width: 128, height: 128 },
  player: { width: 128, height: 192 },
  npc: { width: 128, height: 192 },
  monster: { width: 128, height: 128 },
  item: { width: 128, height: 128 },
  'set-piece': { width: 512, height: 512 },
  // Trees, palms and cacti; rocks use ROCK_BOX.
  prop: { width: 192, height: 256 },
  effect: { width: 128, height: 128 },
};
const ROCK_BOX = { width: 128, height: 128 };

/**
 * Pieces drawn at their own size: set pieces smaller than the 512 px box, the
 * launch lands' great wonders bigger (about a tile wider than their
 * footprint), and the biggest monsters.
 */
const SET_PIECE_BOX: Record<string, { width: number; height: number }> = {
  'sanctum-shrine': { width: 256, height: 256 },
  'sanctum-standing-stones': { width: 640, height: 512 },
  'sanctum-fountain': { width: 384, height: 320 },
  'sanctum-bell-tower': { width: 384, height: 768 },
  'woods-fairy-ring': { width: 512, height: 320 },
  'woods-fallen-giant': { width: 896, height: 512 },
  'woods-castle-gate': { width: 640, height: 640 },
  'shore-shipwreck': { width: 896, height: 640 },
  'shore-giant-shell': { width: 512, height: 448 },
  'shore-tide-shrine': { width: 320, height: 448 },
  'desert-pyramid': { width: 1024, height: 768 },
  'desert-obelisk': { width: 192, height: 704 },
  'desert-wyrm-bones': { width: 896, height: 512 },
  'woods-bark-golem': { width: 192, height: 192 },
  'desert-sand-wyrm': { width: 256, height: 224 },
};

await mkdir(outDir, { recursive: true });
// Building art (npm run building-art) shares the manifest; keep its entries.
const manifest: ArtManifest = JSON.parse(await readFile(resolve(outDir, 'manifest.json'), 'utf8').catch(() => '{}'));

for (const file of (await readdir(anchorDir)).filter((f) => f.endsWith('.json')).sort()) {
  const recipe = JSON.parse(await readFile(resolve(anchorDir, file), 'utf8'));
  const id: string = recipe.id;
  const kind: string = recipe.description.kind;
  const png = await readFile(resolve(anchorDir, `${id}.png`));

  if (kind === 'tile') {
    await sharp(png).resize(128, 128, { fit: 'cover', kernel: 'lanczos3' }).png().toFile(resolve(outDir, `${id}.png`));
    manifest[id] = entry(id, kind, 128, 128);
    continue;
  }

  const box = SET_PIECE_BOX[id] ?? (kind === 'prop' && id.endsWith('-rock') ? ROCK_BOX : BOX[kind]) ?? BOX.item!;
  // People all stand the same height, as they do when they walk.
  if (kind === 'player' || kind === 'npc') {
    const fitted = await fitCharacter(png, box);
    await writeFile(resolve(outDir, `${id}.png`), fitted);
    const { width } = await sharp(fitted).metadata();
    manifest[id] = entry(id, kind, width!, box.height);
    continue;
  }
  // Trim the transparent margin so every sprite is scaled by its own size.
  const trimmed = await sharp(png).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  const scale = Math.min(box.width / trimmed.info.width, box.height / trimmed.info.height);
  const w = Math.max(1, Math.round(trimmed.info.width * scale));
  const h = Math.max(1, Math.round(trimmed.info.height * scale));
  const resized = await sharp(trimmed.data).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  // Pad to the full box with the feet on the bottom row, centred.
  const left = Math.floor((box.width - w) / 2);
  await sharp({ create: { width: box.width, height: box.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, left, top: box.height - h }])
    .png()
    .toFile(resolve(outDir, `${id}.png`));
  manifest[id] = entry(id, kind, box.width, box.height);

  if (kind === 'item') {
    await sharp(resolve(outDir, `${id}.png`)).resize(64, 64).png().toFile(resolve(outDir, `${id}-icon.png`));
  }
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(resolve(outDir, 'manifest.json'), `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`Wrote ${Object.keys(manifest).length} assets to ${outDir}`);

function entry(id: string, kind: string, width: number, height: number): ArtEntry {
  return { file: `art/${id}.png`, kind, width, height };
}
