import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { biomeLook, hasShippedKit, type ArtEntry, type ArtManifest, type BiomeId } from '@co-mmo/shared';
import type { KitAsset } from './kit.ts';
import { makeSeamless, removeKeyBackground } from './postprocess.ts';
import type { GeneratedImage, ImageProvider } from './provider.ts';
import { buildPrompt } from './style.ts';
import { fitToBox } from './wish-art.ts';

// The biome kit for biomes no launch region uses: the ground, water, trees
// and rocks a wished region is built from. Each biome's kit is painted once,
// by the image model chosen in God's View, the first time a region of that
// biome is wished, and every later region of the biome reuses it.

const OPEN_WATER = 'flat open surface seen from directly above, as if cut from the middle of a large lake: no shore, bank, rim, border, ripple rings, swirl or whirlpool, no centre point; small marks scattered evenly';

/** What each kit piece looks like, per biome (Style Bible, biome signatures). */
interface KitLook {
  ground: Pick<KitAsset, 'silhouetteHook' | 'body' | 'materials' | 'colors' | 'details' | 'mood'>;
  water: Pick<KitAsset, 'name' | 'silhouetteHook' | 'colors' | 'details' | 'mood'>;
  trees: [Pick<KitAsset, 'name' | 'silhouetteHook' | 'body' | 'materials' | 'colors' | 'details' | 'mood'>, Pick<KitAsset, 'name' | 'silhouetteHook' | 'body' | 'materials' | 'colors' | 'details' | 'mood'>];
  rock: Pick<KitAsset, 'name' | 'silhouetteHook' | 'body' | 'materials' | 'colors' | 'details' | 'mood'>;
}

const LOOKS: Partial<Record<BiomeId, KitLook>> = {
  'verdant-meadows': {
    ground: {
      silhouetteHook: 'rolling short meadow grass in soft brushy clumps with tiny daisies', body: 'flat lawn, clumps spread evenly',
      materials: ['grass', 'clover'], colors: { main: 'fresh spring green', secondary: 'deeper grass green', accent: 'white and butter-yellow daisy specks' },
      details: ['tiny daisies', 'clover leaves'], mood: 'sunny, open',
    },
    water: { name: 'Meadow pond water', silhouetteHook: 'clear sky-blue pond water with soft painted ripples', colors: { main: 'sky blue', secondary: 'deeper blue', accent: 'white glints' }, details: ['short soft ripple strokes spread evenly'], mood: 'calm' },
    trees: [
      { name: 'Great oak', silhouetteHook: 'a lone oversized oak with a huge round leafy crown', body: 'thick short trunk, crown much wider than it is tall', materials: ['bark', 'leaves'], colors: { main: 'leaf green', secondary: 'warm brown trunk', accent: 'butter yellow' }, details: ['a few acorns'], mood: 'sunny, generous' },
      { name: 'Flowering bush', silhouetteHook: 'a round puffy bush dotted with white and yellow blossoms', body: 'low round shrub, wider than tall', materials: ['leaves', 'blossoms'], colors: { main: 'bright green', secondary: 'moss green', accent: 'white blossoms' }, details: ['a bee'], mood: 'cheerful' },
    ],
    rock: { name: 'Field stone', silhouetteHook: 'a rounded grey field stone with grass tufts at its base', body: 'low wide boulder', materials: ['stone', 'grass'], colors: { main: 'warm grey', secondary: 'lavender shadow', accent: 'grass green' }, details: ['a small daisy'], mood: 'calm' },
  },
  'mushroom-hollow': {
    ground: {
      silhouetteHook: 'spongy violet soil covered in soft spore mats and tiny glowing specks', body: 'flat soft ground, mats spread evenly',
      materials: ['soil', 'spores'], colors: { main: 'dusky violet', secondary: 'deep plum', accent: 'tiny cyan glowing specks' },
      details: ['tiny spore puffs', 'thread-like mycelium'], mood: 'dreamy, strange',
    },
    water: { name: 'Hollow pool water', silhouetteHook: 'still deep indigo water with faint cyan glimmers', colors: { main: 'deep indigo', secondary: 'plum', accent: 'cyan glimmers' }, details: ['short soft ripple strokes spread evenly'], mood: 'mysterious' },
    trees: [
      { name: 'Giant capped mushroom', silhouetteHook: 'a giant mushroom with a wide spotted magenta-pink cap on a pale stalk', body: 'tall pale stalk, broad domed cap', materials: ['mushroom flesh'], colors: { main: 'rose magenta cap', secondary: 'cream stalk', accent: 'cyan spots' }, details: ['gills under the cap'], mood: 'whimsical' },
      { name: 'Mushroom cluster', silhouetteHook: 'a cluster of three violet mushrooms of different heights with spiral caps', body: 'low cluster, wider than tall', materials: ['mushroom flesh'], colors: { main: 'lilac', secondary: 'deep violet', accent: 'cyan glow' }, details: ['spiral patterns on the caps'], mood: 'dreamy' },
    ],
    rock: { name: 'Spore stone', silhouetteHook: 'a round dark stone crusted with tiny violet toadstools', body: 'low wide boulder', materials: ['stone', 'fungus'], colors: { main: 'slate violet', secondary: 'plum', accent: 'cyan specks' }, details: ['tiny toadstools'], mood: 'strange' },
  },
  frostpeak: {
    ground: {
      silhouetteHook: 'soft snow drifts with blue shading and faint wind ripples', body: 'flat snowy ground, drifts spread evenly',
      materials: ['snow'], colors: { main: 'pale icy blue-white', secondary: 'lavender-blue shadow', accent: 'tiny sparkles' },
      details: ['tiny frost sparkles', 'soft wind ripples'], mood: 'crisp, quiet',
    },
    water: { name: 'Icy lake water', silhouetteHook: 'cold slate-blue water with floating slivers of thin ice', colors: { main: 'slate blue', secondary: 'deep teal', accent: 'white ice slivers' }, details: ['short soft ripple strokes spread evenly'], mood: 'cold, still' },
    trees: [
      { name: 'Frosted pine', silhouetteHook: 'a tall pointed pine tree heavy with snow on every bough', body: 'slim triangular evergreen', materials: ['pine needles', 'snow'], colors: { main: 'dark pine green', secondary: 'snow white', accent: 'pale blue shadow' }, details: ['icicles on the lowest bough'], mood: 'crisp, quiet' },
      { name: 'Ice crystal spire', silhouetteHook: 'a cluster of tall pale blue ice crystals jutting from a snow mound', body: 'tall jagged crystals, softened by snow caps', materials: ['ice', 'snow'], colors: { main: 'pale ice blue', secondary: 'lavender', accent: 'white glints' }, details: ['snow cap on the tallest crystal'], mood: 'magical, cold' },
    ],
    rock: { name: 'Snow-capped boulder', silhouetteHook: 'a round grey boulder with a thick cap of snow', body: 'low wide boulder', materials: ['stone', 'snow'], colors: { main: 'blue grey', secondary: 'snow white', accent: 'pine green moss' }, details: ['a little moss'], mood: 'quiet' },
  },
  'ember-wastes': {
    ground: {
      silhouetteHook: 'cracked dark rock with grey ash and thin faintly glowing orange fissures', body: 'flat broken ground, cracks spread evenly',
      materials: ['basalt', 'ash'], colors: { main: 'charcoal plum', secondary: 'ash grey', accent: 'thin ember orange glow in the cracks' },
      details: ['small pebbles', 'thin glowing cracks'], mood: 'hot, harsh',
    },
    water: { name: 'Lava', silhouetteHook: 'slow molten lava with a dark crust breaking into glowing orange patches', colors: { main: 'molten orange', secondary: 'deep red', accent: 'gold highlights' }, details: ['dark crust plates spread evenly'], mood: 'dangerous' },
    trees: [
      { name: 'Basalt column', silhouetteHook: 'a cluster of tall hexagonal dark basalt columns', body: 'columns of different heights, taller than wide', materials: ['basalt'], colors: { main: 'charcoal', secondary: 'dark plum', accent: 'ember orange edges' }, details: ['a wisp of smoke'], mood: 'harsh' },
      { name: 'Burnt tree', silhouetteHook: 'a blackened dead tree with twisting bare branches and glowing embers in its bark', body: 'gnarled trunk, bare branches', materials: ['charred wood'], colors: { main: 'charcoal', secondary: 'ash grey', accent: 'ember orange' }, details: ['drifting embers'], mood: 'eerie' },
    ],
    rock: { name: 'Smoking vent', silhouetteHook: 'a low dark rock mound with a small vent puffing grey smoke', body: 'low wide mound', materials: ['basalt'], colors: { main: 'charcoal', secondary: 'rust brown', accent: 'ember orange' }, details: ['a puff of smoke'], mood: 'hot' },
  },
  'murkmire-swamp': {
    ground: {
      silhouetteHook: 'dark olive mud with patches of reeds and soggy moss', body: 'flat wet ground, patches spread evenly',
      materials: ['mud', 'moss', 'reeds'], colors: { main: 'muddy olive', secondary: 'deep brown', accent: 'lime moss specks' },
      details: ['small puddles', 'short reeds'], mood: 'murky, damp',
    },
    water: { name: 'Swamp water', silhouetteHook: 'murky green-brown water dotted with small lily pads', colors: { main: 'murky teal-green', secondary: 'brown', accent: 'lime lily pads' }, details: ['small lily pads spread evenly', 'a few bubbles'], mood: 'murky' },
    trees: [
      { name: 'Hanging moss tree', silhouetteHook: 'a crooked swamp tree draped in long hanging grey-green moss', body: 'twisted trunk on spreading roots', materials: ['bark', 'moss'], colors: { main: 'olive green', secondary: 'dark brown', accent: 'lime' }, details: ['moss curtains'], mood: 'gloomy' },
      { name: 'Dead snag', silhouetteHook: 'a bare dead tree with a split trunk and a few drooping vines', body: 'thin crooked trunk', materials: ['grey wood', 'vines'], colors: { main: 'grey brown', secondary: 'dark teal', accent: 'lime vine leaves' }, details: ['a perched frog'], mood: 'eerie' },
    ],
    rock: { name: 'Mossy stump', silhouetteHook: 'a squat rotten tree stump covered in moss and tiny mushrooms', body: 'low wide stump', materials: ['rotten wood', 'moss'], colors: { main: 'dark brown', secondary: 'olive moss', accent: 'pale mushrooms' }, details: ['tiny mushrooms'], mood: 'damp' },
  },
  'sky-ruins': {
    ground: {
      silhouetteHook: 'pale cracked marble floor slabs with ivy creeping along the joints', body: 'flat stone floor, slabs spread evenly',
      materials: ['marble', 'ivy'], colors: { main: 'warm white marble', secondary: 'periwinkle shadow', accent: 'soft green ivy' },
      details: ['fine cracks', 'tiny feathers'], mood: 'airy, ancient',
    },
    water: { name: 'Cloud sea', silhouetteHook: 'a sea of soft fluffy white and periwinkle clouds seen from above', colors: { main: 'white cloud', secondary: 'periwinkle', accent: 'pale gold sunlight' }, details: ['soft cloud puffs spread evenly'], mood: 'airy, vast' },
    trees: [
      { name: 'Broken column', silhouetteHook: 'a tall broken marble column wrapped in ivy', body: 'fluted column, snapped at the top', materials: ['marble', 'ivy'], colors: { main: 'warm white', secondary: 'periwinkle', accent: 'gold trim' }, details: ['a feather resting on top'], mood: 'ancient' },
      { name: 'Sky bell arch', silhouetteHook: 'a small marble arch with a large old bronze bell hanging inside', body: 'narrow arch, taller than wide', materials: ['marble', 'bronze'], colors: { main: 'warm white', secondary: 'bronze gold', accent: 'ivy green' }, details: ['ivy on one side'], mood: 'serene' },
    ],
    rock: { name: 'Fallen statue head', silhouetteHook: 'a large toppled marble statue head lying on its side, overgrown with ivy', body: 'low wide carved stone', materials: ['marble', 'ivy'], colors: { main: 'warm white', secondary: 'periwinkle', accent: 'ivy green' }, details: ['a serene closed-eyed face'], mood: 'ancient' },
  },
};

/** Approved launch-kit art sent along so the new kit matches the old. */
const PROP_REFERENCES = ['woods-tree-a', 'sanctum-blossom-tree-a'];
const ROCK_REFERENCES = ['woods-rock', 'desert-rock'];

/** Pictures a biome needs before its regions can be drawn in their own art. */
export function wildKit(biome: BiomeId): KitAsset[] {
  const look = LOOKS[biome];
  if (!look || hasShippedKit(biome)) return [];
  const ids = biomeLook(biome);
  return [
    { id: ids.ground, name: `${biome} ground`, kind: 'tile', biome, ...look.ground },
    { id: ids.water, kind: 'tile', biome, body: OPEN_WATER, centerCrop: 0.5, ...look.water },
    ...look.trees.map((tree, i) => ({ id: ids.trees[i]!, kind: 'prop' as const, biome, references: PROP_REFERENCES, ...tree })),
    { id: ids.rocks[0]!, kind: 'prop', biome, references: ROCK_REFERENCES, ...look.rock },
  ];
}

/** Box a kit sprite is fitted into, base at the bottom centre (as the launch kit). */
function box(asset: KitAsset): { width: number; height: number } {
  return asset.id.endsWith('-rock') ? { width: 128, height: 128 } : { width: 192, height: 256 };
}

/**
 * Paints one kit picture: a tile is cut from the middle when asked and made
 * to repeat without seams; a sprite has its key background removed and is
 * fitted to its box. Writes `<id>.png` into `outDir`.
 */
export async function paintKitAsset(
  asset: KitAsset,
  provider: ImageProvider,
  anchorDir: string,
  outDir: string,
): Promise<{ image: GeneratedImage; entry: ArtEntry }> {
  const references: GeneratedImage[] = [];
  for (const ref of asset.references ?? []) {
    for (const path of [resolve(anchorDir, 'raw', `${ref}.png`), resolve(anchorDir, `${ref}.png`)]) {
      const data = await readFile(path).catch(() => undefined);
      if (!data) continue;
      references.push({ mimeType: 'image/png', data });
      break;
    }
  }
  const image = await provider.generate({ prompt: buildPrompt(asset), references });
  // The untouched picture is kept, so it can be processed again for free.
  await mkdir(resolve(outDir, 'raw'), { recursive: true });
  await writeFile(resolve(outDir, 'raw', `${asset.id}.png`), await sharp(image.data).png().toBuffer());
  const entry = await processKitAsset(asset, image.data, outDir);
  return { image, entry };
}

/** Turns a provider image into the game copy of a kit piece. */
export async function processKitAsset(asset: KitAsset, raw: Buffer, outDir: string): Promise<ArtEntry> {
  const png = await sharp(raw).png().toBuffer();
  let out: Buffer;
  let size: { width: number; height: number };
  if (asset.kind === 'tile') {
    const cropped = asset.centerCrop ? await cropCenter(png, asset.centerCrop) : png;
    out = await sharp(await makeSeamless(cropped)).resize(128, 128, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();
    size = { width: 128, height: 128 };
  } else {
    const { png: keyed } = await removeKeyBackground(png, undefined, { holes: true });
    size = box(asset);
    out = await fitToBox(keyed, size);
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, `${asset.id}.png`), out);
  return { file: `${asset.id}.png`, kind: asset.kind, ...size };
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

/** Where painted biome kits are kept and served from, under the wished-art directory. */
export const KIT_ART_PATH = 'wished-art/biomes';

/** Reads the manifest of kit art painted so far. */
export async function readKitManifest(dir: string): Promise<ArtManifest> {
  return JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8').catch(() => '{}')) as ArtManifest;
}
