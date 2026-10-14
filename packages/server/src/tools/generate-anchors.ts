// Generates the Style Bible's reference images.
//
//   npm run anchors -- --dry-run        print prompts and estimated cost
//   npm run anchors -- --only woods-mushroom
//   npm run anchors -- --limit 5
//
// Needs GEMINI_API_KEY. Each image is saved with a recipe (prompt, model,
// style version, time), so the set can be regenerated with a better model.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORS } from '../assets/anchors.ts';
import { GeminiImageProvider } from '../assets/gemini.ts';
import { STYLE_VERSION, buildPrompt } from '../assets/style.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const dryRun = flag('dry-run');
const force = flag('force');
const only = value('only');
const limit = Number(value('limit') ?? Infinity);
// Approximate price per image; confirm against the provider's price page.
const pricePerImage = Number(process.env.IMAGE_PRICE_USD ?? 0.04);
const outDir = resolve(fileURLToPath(new URL('../../../../assets/anchors/', import.meta.url)));

const selected = ANCHORS.filter((a) => !only || a.id === only).slice(0, limit);
if (selected.length === 0) {
  console.error(`No anchor matches ${only}. Known: ${ANCHORS.map((a) => a.id).join(', ')}`);
  process.exit(1);
}

console.log(`${selected.length} anchors, about $${(selected.length * pricePerImage).toFixed(2)} at $${pricePerImage}/image.`);
if (dryRun) {
  for (const a of selected) console.log(`\n--- ${a.id}\n${buildPrompt(a)}`);
  process.exit(0);
}

const provider = new GeminiImageProvider(process.env.GEMINI_API_KEY ?? '', process.env.GEMINI_IMAGE_MODEL);
await mkdir(outDir, { recursive: true });

let made = 0;
for (const anchor of selected) {
  const png = resolve(outDir, `${anchor.id}.png`);
  if (!force && (await exists(png))) {
    console.log(`skip ${anchor.id} (exists; --force to redo)`);
    continue;
  }
  const prompt = buildPrompt(anchor);
  try {
    const image = await provider.generate({ prompt });
    await writeFile(png, image.data);
    await writeFile(resolve(outDir, `${anchor.id}.json`), JSON.stringify({
      id: anchor.id,
      description: anchor,
      prompt,
      provider: provider.id,
      model: provider.model,
      styleVersion: STYLE_VERSION,
      mimeType: image.mimeType,
      createdAt: new Date().toISOString(),
    }, null, 2));
    made++;
    console.log(`made ${anchor.id}`);
  } catch (err) {
    console.error(`failed ${anchor.id}: ${(err as Error).message}`);
  }
}
console.log(`Done: ${made} new images in ${outDir}`);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
