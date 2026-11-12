import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { removeKeyBackground, removeKeySpill } from '../packages/server/src/assets/postprocess.ts';

const WORKTREE_DIR = '/home/egoforia/dev/co-mmo/.claude/worktrees/feat-biome-stairs-redesign';
const RAW_DIR = resolve(WORKTREE_DIR, 'assets/buildings/raw');
const ART_DIR = resolve(WORKTREE_DIR, 'packages/client/public/art');
const MANIFEST_PATH = resolve(ART_DIR, 'manifest.json');

interface StairSpec {
  id: string;
  sourceFile: string;
  tint?: (r: number, g: number, b: number) => [number, number, number];
}

const STAIR_SPECS: StairSpec[] = [
  // Sanctum
  { id: 'stairs-sanctum-up', sourceFile: 'stairs-sanctum-up.jpg' },
  { id: 'stairs-sanctum-down', sourceFile: 'stairs-sanctum-down.jpg' },
  // Whispering Woods
  { id: 'stairs-whispering-woods-up', sourceFile: 'stairs-whispering-woods-up.jpg' },
  { id: 'stairs-whispering-woods-down', sourceFile: 'stairs-whispering-woods-down.jpg' },
  // Sunlit Shore
  { id: 'stairs-sunlit-shore-up', sourceFile: 'stairs-sunlit-shore-up.jpg' },
  { id: 'stairs-sunlit-shore-down', sourceFile: 'stairs-sunlit-shore-down.jpg' },
  // Frostpeak
  { id: 'stairs-frostpeak-up', sourceFile: 'stairs-frostpeak-up.jpg' },
  { id: 'stairs-frostpeak-down', sourceFile: 'stairs-frostpeak-down.jpg' },
  // Mirage Desert
  { id: 'stairs-mirage-desert-up', sourceFile: 'stairs-mirage-desert-up.jpg' },
  { id: 'stairs-mirage-desert-down', sourceFile: 'stairs-mirage-desert-down.jpg' },
  // Verdant Meadows
  { id: 'stairs-verdant-meadows-up', sourceFile: 'stairs-verdant-meadows-up.jpg' },
  { id: 'stairs-verdant-meadows-down', sourceFile: 'stairs-verdant-meadows-down.jpg' },
  // Mushroom Hollow
  { id: 'stairs-mushroom-hollow-up', sourceFile: 'stairs-mushroom-hollow-up.jpg' },
  {
    id: 'stairs-mushroom-hollow-down',
    sourceFile: 'stairs-whispering-woods-down.jpg',
    tint: (r, g, b) => {
      // Shift toward rich violet, plum, and cyan bioluminescence
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const nr = Math.min(255, Math.round(lum * 180 + 35));
      const ng = Math.min(255, Math.round(lum * 130 + 20));
      const nb = Math.min(255, Math.round(lum * 220 + 55));
      return [nr, ng, nb];
    },
  },
  // Ember Wastes
  {
    id: 'stairs-ember-wastes-up',
    sourceFile: 'stairs-sanctum-up.jpg',
    tint: (r, g, b) => {
      // Charcoal basalt with glowing ember orange fissures
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (lum > 0.75) {
        // glowing ember highlight
        return [255, Math.round(lum * 170), Math.round(lum * 40)];
      }
      const nr = Math.min(255, Math.round(lum * 90 + 35));
      const ng = Math.min(255, Math.round(lum * 60 + 25));
      const nb = Math.min(255, Math.round(lum * 65 + 30));
      return [nr, ng, nb];
    },
  },
  {
    id: 'stairs-ember-wastes-down',
    sourceFile: 'stairs-sanctum-down.jpg',
    tint: (r, g, b) => {
      // Dark volcanic basalt with molten ember stairwell
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (lum > 0.65) {
        return [245, Math.round(lum * 150), Math.round(lum * 35)];
      }
      const nr = Math.min(255, Math.round(lum * 85 + 30));
      const ng = Math.min(255, Math.round(lum * 55 + 20));
      const nb = Math.min(255, Math.round(lum * 60 + 25));
      return [nr, ng, nb];
    },
  },
  // Murkmire Swamp
  {
    id: 'stairs-murkmire-swamp-up',
    sourceFile: 'stairs-whispering-woods-up.jpg',
    tint: (r, g, b) => {
      // Muddy olive, dark waterlogged wood, mossy green
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const nr = Math.min(255, Math.round(lum * 110 + 25));
      const ng = Math.min(255, Math.round(lum * 140 + 35));
      const nb = Math.min(255, Math.round(lum * 85 + 20));
      return [nr, ng, nb];
    },
  },
  {
    id: 'stairs-murkmire-swamp-down',
    sourceFile: 'stairs-whispering-woods-down.jpg',
    tint: (r, g, b) => {
      // Muddy olive timber and dark mossy swamp opening
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const nr = Math.min(255, Math.round(lum * 105 + 20));
      const ng = Math.min(255, Math.round(lum * 135 + 30));
      const nb = Math.min(255, Math.round(lum * 80 + 15));
      return [nr, ng, nb];
    },
  },
  // Sky Ruins
  {
    id: 'stairs-sky-ruins-up',
    sourceFile: 'stairs-sanctum-up.jpg',
    tint: (r, g, b) => {
      // Celestial white marble with periwinkle shadow and gold trim
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const nr = Math.min(255, Math.round(lum * 215 + 40));
      const ng = Math.min(255, Math.round(lum * 225 + 35));
      const nb = Math.min(255, Math.round(lum * 255 + 50));
      return [nr, ng, nb];
    },
  },
  {
    id: 'stairs-sky-ruins-down',
    sourceFile: 'stairs-sanctum-down.jpg',
    tint: (r, g, b) => {
      // Celestial marble opening with azure / cloud depth
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const nr = Math.min(255, Math.round(lum * 200 + 35));
      const ng = Math.min(255, Math.round(lum * 215 + 30));
      const nb = Math.min(255, Math.round(lum * 250 + 55));
      return [nr, ng, nb];
    },
  },
];

async function run() {
  console.log(`Processing ${STAIR_SPECS.length} stair assets...`);

  const manifestRaw = await readFile(MANIFEST_PATH, 'utf-8');
  const manifest = JSON.parse(manifestRaw);

  for (const spec of STAIR_SPECS) {
    console.log(`Processing ${spec.id}...`);
    const srcPath = resolve(RAW_DIR, spec.sourceFile);
    let img = sharp(srcPath);

    // Apply tint if specified (preserving magenta #FF00FF background)
    if (spec.tint) {
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      const outBuf = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i += info.channels) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        // Check if pixel is background magenta (r high, g low, b high)
        const isMagenta = r > 210 && g < 45 && b > 210;
        if (isMagenta) {
          outBuf[i] = 255;
          outBuf[i + 1] = 0;
          outBuf[i + 2] = 255;
        } else {
          const [nr, ng, nb] = spec.tint(r, g, b);
          outBuf[i] = nr;
          outBuf[i + 1] = ng;
          outBuf[i + 2] = nb;
        }
        if (info.channels === 4) {
          outBuf[i + 3] = data[i + 3]!;
        }
      }
      img = sharp(outBuf, { raw: info });
    }

    const pngBuffer = await img.png().toBuffer();
    // Save raw PNG into RAW_DIR as well
    await writeFile(resolve(RAW_DIR, `${spec.id}.png`), pngBuffer);

    // Chroma-key removal
    const { png: keyed } = await removeKeyBackground(pngBuffer, undefined, { holes: true });
    const cleaned = await removeKeySpill(keyed);
    const trimmed = await sharp(cleaned).trim({ threshold: 10 }).png().toBuffer({ resolveWithObject: true });

    // Scale to fit within 256x256, bottom-centered
    const scale = Math.min(256 / trimmed.info.width, 256 / trimmed.info.height);
    const w = Math.round(trimmed.info.width * scale);
    const h = Math.round(trimmed.info.height * scale);
    const resized = await sharp(trimmed.data).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();

    const final = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: resized, left: Math.floor((256 - w) / 2), top: 256 - h }])
      .png()
      .toBuffer();

    const destFile = `${spec.id}.png`;
    await writeFile(resolve(ART_DIR, destFile), final);

    // Add / update manifest entry
    manifest[spec.id] = {
      file: `art/${destFile}`,
      kind: 'prop',
      width: 256,
      height: 256,
    };
  }

  // Also update default generic stairs-up and stairs-down if desired, or keep them as fallback
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Successfully processed all stair sprites and updated manifest.json!');
}

run().catch((err) => {
  console.error('Error processing stairs:', err);
  process.exit(1);
});
