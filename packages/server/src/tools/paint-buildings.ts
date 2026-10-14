// Paints every building's art with the image model chosen in God's View:
// the outside, the inside's floor, wall and door tiles, and the furniture
// (BUILDING_STYLES in packages/shared/src/buildings.ts).
//
//   npm run building-art -- --dry-run          print prompts
//   npm run building-art -- --style bramble-cottage
//   npm run building-art -- --only bramble-cottage-floor --force
//   npm run building-art -- --process-only     redo post-processing, no generation
//   npm run building-art -- --model gemini-3.1-flash-image
//
// The model is the one saved in God's View (data/world.json), unless
// --model names another. The provider's images are kept in
// assets/buildings/raw with a recipe each; the game copies go to
// packages/client/public/art and its manifest. Needs GEMINI_API_KEY.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDING_STYLES, type ArtManifest } from '@co-mmo/shared';
import { buildingArtJobs, paintBuildingArt, processBuildingArt, type BuildingArtDirs } from '../assets/building-art.ts';
import { GeminiImageProvider } from '../assets/gemini.ts';
import { imageUsd } from '../assets/wish-art.ts';
import { savedImageModel } from './saved-model.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dirs: BuildingArtDirs = {
  anchorDir: resolve(root, 'assets/anchors'),
  rawDir: resolve(root, 'assets/buildings/raw'),
  outDir: resolve(root, 'packages/client/public/art'),
};
const manifestFile = resolve(dirs.outDir, 'manifest.json');

const styles = Object.values(BUILDING_STYLES).filter((s) => !value('style') || s.id === value('style'));
const jobs = styles.flatMap(buildingArtJobs).filter((j) => !value('only') || j.id === value('only'));
if (!jobs.length) {
  console.error('Nothing matches. Known:', Object.values(BUILDING_STYLES).flatMap(buildingArtJobs).map((j) => j.id).join(', '));
  process.exit(1);
}
if (flag('dry-run')) {
  for (const job of jobs) console.log(`\n--- ${job.id} (${job.kind}, refs: ${job.references.join(', ') || 'none'})\n${job.prompt}`);
  process.exit(0);
}

const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as ArtManifest;
const model = value('model') ?? (await savedImageModel(root)) ?? process.env.GEMINI_IMAGE_MODEL;
const provider = flag('process-only') ? undefined : new GeminiImageProvider(process.env.GEMINI_API_KEY ?? '', model);
let usd = 0;

for (const job of jobs) {
  const raw = await readFile(resolve(dirs.rawDir, `${job.id}.png`)).catch(() => undefined);
  if (!provider || (raw && !flag('force'))) {
    if (!raw) continue;
    manifest[job.id] = await processBuildingArt(job, raw, dirs.outDir);
    console.log(`processed ${job.id}`);
    continue;
  }
  try {
    const { image, entry } = await paintBuildingArt(job, provider, dirs);
    usd += imageUsd(provider.model, image);
    manifest[job.id] = entry;
    await writeFile(resolve(dirs.rawDir, `${job.id}.json`), `${JSON.stringify({
      id: job.id, kind: job.kind, prompt: job.prompt, references: job.references, provider: provider.id, model: provider.model, createdAt: new Date().toISOString(),
    }, null, 2)}\n`);
    console.log(`painted ${job.id}`);
  } catch (err) {
    console.error(`failed ${job.id}: ${(err as Error).message}`);
  }
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestFile, `${JSON.stringify(sorted, null, 2)}\n`);
if (provider) console.log(`Done with ${provider.model}, about $${usd.toFixed(2)}.`);

