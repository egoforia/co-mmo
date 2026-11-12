import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const BIOMES = [
  'sanctum',
  'whispering-woods',
  'sunlit-shore',
  'frostpeak',
  'mirage-desert',
  'verdant-meadows',
  'mushroom-hollow',
  'ember-wastes',
  'murkmire-swamp',
  'sky-ruins',
];

const HEADINGS = ['north', 'south', 'east', 'west'] as const;
const DIRS = ['up', 'down'] as const;

const PUBLIC_ART = path.resolve('packages/client/public/art');
const RAW_DIR = path.resolve('assets/buildings/raw');
const MANIFEST_PATH = path.resolve('packages/client/public/art/manifest.json');

async function processStairSet(prefix: string, isGeneric: boolean = false) {
  const upFile = path.join(PUBLIC_ART, `${prefix}-up.png`);
  const downFile = path.join(PUBLIC_ART, `${prefix}-down.png`);

  if (!fs.existsSync(upFile) || !fs.existsSync(downFile)) {
    throw new Error(`Missing base files for ${prefix}: ${upFile} or ${downFile}`);
  }

  const northUp = sharp(upFile);
  const northDown = sharp(downFile);

  // 1. North
  const northUpPath = path.join(PUBLIC_ART, `${prefix}-north-up.png`);
  const northDownPath = path.join(PUBLIC_ART, `${prefix}-north-down.png`);
  await northUp.clone().toFile(northUpPath);
  await northDown.clone().toFile(northDownPath);

  // 2. West (horizontal reflection of North)
  const westUpPath = path.join(PUBLIC_ART, `${prefix}-west-up.png`);
  const westDownPath = path.join(PUBLIC_ART, `${prefix}-west-down.png`);
  await northUp.clone().flop().toFile(westUpPath);
  await northDown.clone().flop().toFile(westDownPath);

  // 3. South (front-facing ambient illumination on Axis 1)
  const southUpPath = path.join(PUBLIC_ART, `${prefix}-south-up.png`);
  const southDownPath = path.join(PUBLIC_ART, `${prefix}-south-down.png`);
  await northUp.clone().modulate({ brightness: 1.04, saturation: 1.05 }).toFile(southUpPath);
  await northDown.clone().modulate({ brightness: 1.03, saturation: 1.06 }).toFile(southDownPath);

  // 4. East (horizontal reflection of South on Axis 2)
  const eastUpPath = path.join(PUBLIC_ART, `${prefix}-east-up.png`);
  const eastDownPath = path.join(PUBLIC_ART, `${prefix}-east-down.png`);
  await sharp(southUpPath).flop().toFile(eastUpPath);
  await sharp(southDownPath).flop().toFile(eastDownPath);

  // Also save to assets/buildings/raw/ with json
  for (const heading of HEADINGS) {
    for (const dir of DIRS) {
      const artId = `${prefix}-${heading}-${dir}`;
      const srcPng = path.join(PUBLIC_ART, `${artId}.png`);
      const rawPng = path.join(RAW_DIR, `${artId}.png`);
      const rawJson = path.join(RAW_DIR, `${artId}.json`);
      fs.copyFileSync(srcPng, rawPng);

      const meta = {
        id: artId,
        kind: 'prop',
        heading,
        direction: dir,
        biome: isGeneric ? undefined : prefix.replace('stairs-', ''),
        name: `${heading.toUpperCase()} ${dir === 'up' ? 'Ascending' : 'Descending'} stairs (${isGeneric ? 'Generic' : prefix.replace('stairs-', '')})`,
        file: `art/${artId}.png`,
        width: 256,
        height: 256,
      };
      fs.writeFileSync(rawJson, JSON.stringify(meta, null, 2) + '\n');
    }
  }
}

async function main() {
  console.log('Generating 4-sided up and down stairs...');

  // 1. Process 10 biomes
  for (const biome of BIOMES) {
    console.log(`Processing biome: ${biome}`);
    await processStairSet(`stairs-${biome}`);
  }

  // 2. Process generic stairs
  console.log('Processing generic stairs: stairs');
  await processStairSet('stairs', true);

  // 3. Update manifest.json
  console.log('Updating manifest.json...');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  // Add all generated art keys
  const prefixes = [...BIOMES.map((b) => `stairs-${b}`), 'stairs'];
  for (const prefix of prefixes) {
    for (const heading of HEADINGS) {
      for (const dir of DIRS) {
        const id = `${prefix}-${heading}-${dir}`;
        manifest[id] = {
          file: `art/${id}.png`,
          kind: 'prop',
          width: 256,
          height: 256,
        };
      }
    }
  }

  // Sort keys in manifest
  const sortedManifest: Record<string, any> = {};
  for (const key of Object.keys(manifest).sort()) {
    sortedManifest[key] = manifest[key];
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(sortedManifest, null, 2) + '\n');
  console.log('Finished successfully!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
