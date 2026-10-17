// Generates the Style Bible's reference images and the biome kit.
//
//   npm run anchors -- --dry-run        print prompts and estimated cost
//   npm run anchors -- --only woods-mushroom
//   npm run anchors -- --limit 5
//   npm run anchors -- --process-only   redo post-processing, no generation
//   npm run anchors -- --model gemini-3.1-flash-image   (default: the model chosen in God's View)
//   npm run anchors -- --only player-mara --edit "empty hands, no staff"
//       paints an existing anchor again from its own picture with one change
//
// The provider's image is kept in raw/; the game copy next to it has the key
// background removed (sprites) or is made seamless (tiles, with a 4x4 preview
// in previews/).
// Needs GEMINI_API_KEY. Each image is saved with a recipe (prompt, model,
// style version, time), so the set can be regenerated with a better model.
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORS } from '../assets/anchors.ts';
import { BIOME_KIT, type KitAsset } from '../assets/kit.ts';
import { GeminiImageProvider } from '../assets/gemini.ts';
import { makeSeamless, removeKeyBackground, tileGrid } from '../assets/postprocess.ts';
import { BASE_PROMPT, SPRITE_FRAMING, STYLE_VERSION, buildPrompt } from '../assets/style.ts';
import { savedImageModel } from './saved-model.ts';
import sharp from 'sharp';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const dryRun = flag('dry-run');
const force = flag('force');
const processOnly = flag('process-only');
const only = value('only');
// One change to an existing anchor, keeping everything else about it.
const edit = value('edit');
const limit = Number(value('limit') ?? Infinity);
// Approximate price per image; confirm against the provider's price page.
const pricePerImage = Number(process.env.IMAGE_PRICE_USD ?? 0.04);
const outDir = resolve(fileURLToPath(new URL('../../../../assets/anchors/', import.meta.url)));

const ALL: KitAsset[] = [...ANCHORS, ...BIOME_KIT];
const selected = ALL.filter((a) => !only || a.id === only).slice(0, limit);
if (selected.length === 0) {
  console.error(`No anchor matches ${only}. Known: ${ALL.map((a) => a.id).join(', ')}`);
  process.exit(1);
}

console.log(`${selected.length} anchors, about $${(selected.length * pricePerImage).toFixed(2)} at $${pricePerImage}/image.`);
if (dryRun) {
  for (const a of selected) console.log(`\n--- ${a.id}\n${buildPrompt(a)}`);
  process.exit(0);
}

const rawDir = resolve(outDir, 'raw');
const previewDir = resolve(outDir, 'previews');
await mkdir(rawDir, { recursive: true });
await mkdir(previewDir, { recursive: true });

// The model chosen in God's View, unless --model names another.
const model = value('model') ?? (await savedImageModel(resolve(outDir, '../..'))) ?? process.env.GEMINI_IMAGE_MODEL;
const provider = new GeminiImageProvider(process.env.GEMINI_API_KEY ?? '', model);

if (processOnly) {
  for (const anchor of selected) {
    const raw = resolve(rawDir, `${anchor.id}.png`);
    if (await exists(raw)) await processAnchor(anchor, await readFile(raw));
  }
  process.exit(0);
}

let made = 0;
for (const anchor of selected) {
  const raw = resolve(rawDir, `${anchor.id}.png`);
  if (!force && !edit && (await exists(raw))) {
    console.log(`skip ${anchor.id} (exists; --force to redo)`);
    continue;
  }
  const prompt = edit ? editPrompt(edit) : buildPrompt(anchor);
  try {
    // Kit items are painted beside their biome's approved anchors (the raw
    // provider images, magenta background included) so the style matches.
    // An edit is painted from the anchor's own picture instead.
    const references = edit
      ? [{ mimeType: 'image/png', data: await readFile(raw) }]
      : await Promise.all((anchor.references ?? []).map(async (ref) => ({
        mimeType: 'image/png', data: await readFile(resolve(rawDir, `${ref}.png`)),
      })));
    const image = await provider.generate({ prompt, references, ...(edit ? { edit: true } : {}) });
    await writeFile(raw, image.data);
    await writeFile(resolve(outDir, `${anchor.id}.json`), JSON.stringify({
      id: anchor.id,
      description: anchor,
      prompt,
      references: edit ? [`${anchor.id} (before)`] : anchor.references,
      ...(edit ? { edit } : {}),
      provider: provider.id,
      model: provider.model,
      styleVersion: STYLE_VERSION,
      mimeType: image.mimeType,
      createdAt: new Date().toISOString(),
    }, null, 2));
    await processAnchor(anchor, image.data);
    made++;
    console.log(`made ${anchor.id}`);
  } catch (err) {
    console.error(`failed ${anchor.id}: ${(err as Error).message}`);
  }
}
console.log(`Done: ${made} new images in ${outDir}`);

async function processAnchor(anchor: (typeof ALL)[number], raw: Buffer): Promise<void> {
  const out = resolve(outDir, `${anchor.id}.png`);
  if (anchor.kind === 'tile') {
    const tile = await makeSeamless(anchor.centerCrop ? await cropCenter(raw, anchor.centerCrop) : raw);
    await writeFile(out, tile);
    await writeFile(resolve(previewDir, `${anchor.id}-grid.png`), await tileGrid(tile));
    return;
  }
  const { png, clean } = await removeKeyBackground(raw, undefined, { holes: anchor.holes ?? (anchor.kind === 'prop' || anchor.kind === 'effect') });
  await writeFile(out, png);
  if (!clean) console.warn(`warning ${anchor.id}: background is not one flat colour; check it or regenerate`);
}

/** Paints the picture given again, the same in every way but one. */
function editPrompt(change: string): string {
  return [
    BASE_PROMPT,
    SPRITE_FRAMING,
    'Paint the character in the reference picture again, exactly the same: face, hair, clothes, colours, proportions, pose, size and framing.',
    `Change only this: ${change}.`,
  ].join('\n');
}

async function cropCenter(png: Buffer, share: number): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const w = Math.round(width * share);
  const h = Math.round(height * share);
  return sharp(png)
    .extract({ left: Math.round((width - w) / 2), top: Math.round((height - h) / 2), width: w, height: h })
    .resize(width, height, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
