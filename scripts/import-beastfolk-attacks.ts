import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CHARACTER_HEIGHT, ISO_WAYS, type IsoWay } from '../packages/shared/src/walk.ts';
import {
  buildCompositeSpritesheet,
  extractVideoFrames,
  processFrame,
  saveAnimationOutputs,
  type StripResult,
} from './import-animation-utils.ts';

// Imports the 5 beastfolk basic attack animations into co-mmo's model-agnostic art pipeline.

interface CharacterSpec {
  id: string;
  name: string;
}

const ASSETS_DIR = resolve(import.meta.dirname, '../assets/beastfolk');

const CHARACTERS: CharacterSpec[] = [
  { id: 'bramble-ursine', name: 'Bramble-Ursine' },
  { id: 'tide-lutran', name: 'Tide-Lutran' },
  { id: 'zephyr-falcon', name: 'Zephyr-Falcon' },
  { id: 'dune-scorpid', name: 'Dune-Scorpid' },
  { id: 'sylvan-cervid', name: 'Sylvan-Cervid' },
];

const DATA_ATTACKS_DIR = resolve('data/art/attacks');

// Cell bounds inside each 1280x720 4-column video.
// Columns: Col 0: FL, Col 1: BR, Col 2: BL, Col 3: FR
const WAY_TO_BOX: Record<IsoWay, { left: number; top: number; width: number; height: number }> = {
  'front-left': { left: 0, top: 0, width: 320, height: 720 },
  'front-right': { left: 960, top: 0, width: 320, height: 720 },
  'back-left': { left: 640, top: 0, width: 320, height: 720 },
  'back-right': { left: 320, top: 0, width: 320, height: 720 },
};

async function main() {
  console.log('=== Starting Beastfolk Basic Attack Animation Import into co-mmo ===');

  await mkdir(DATA_ATTACKS_DIR, { recursive: true });

  const manifestPath = resolve(DATA_ATTACKS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));

  const clientArtDir = resolve('packages/client/public/art');
  const clientManifestPath = resolve(clientArtDir, 'manifest.json');
  const clientManifest = JSON.parse(await readFile(clientManifestPath, 'utf8').catch(() => '{}'));

  // 12-frame single-hand strike with organic recovery back to neutral idle
  const frameIndices = [6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50];
  console.log(`Using ${frameIndices.length} frames per attack cycle: [${frameIndices.join(', ')}]`);

  const allStrips: StripResult[] = [];

  for (const char of CHARACTERS) {
    console.log(`\nProcessing attack animations for ${char.name} (${char.id})...`);

    const charRawFramesDir = resolve(DATA_ATTACKS_DIR, `${char.id}_raw_frames`);
    const charVideoPath = resolve(ASSETS_DIR, `individual_${char.id}_attack_raw.mp4`);

    await extractVideoFrames({ videoPath: charVideoPath, framesDir: charRawFramesDir, pattern: 'frame_%03d.png' });

    // Extract attack frames for all 4 isometric ways in canonical ISO_WAYS order
    const directionsFrames: Buffer[][] = [];

    for (let wayIdx = 0; wayIdx < ISO_WAYS.length; wayIdx++) {
      const way = ISO_WAYS[wayIdx]!;
      const box = WAY_TO_BOX[way];
      const wayFrames: Buffer[] = [];

      for (const fIdx of frameIndices) {
        const frameFileName = `frame_${String(fIdx).padStart(3, '0')}.png`;
        const framePath = resolve(charRawFramesDir, frameFileName);
        const clean = await processFrame(framePath, box, { isolate: true });
        wayFrames.push(clean);
      }
      directionsFrames.push(wayFrames);
    }

    console.log(`  Normalizing attack strips to canonical height (${CHARACTER_HEIGHT}px)...`);
    const { normalized, strips } = await saveAnimationOutputs({
      charId: char.id,
      kind: 'attack',
      directionsFrames,
      ways: ISO_WAYS,
      bodyHeight: CHARACTER_HEIGHT,
      cycleSeconds: 0.8,
      dataDir: DATA_ATTACKS_DIR,
      clientArtDir,
      manifest,
      clientManifest,
    });
    console.log(`  Normalized: frame size = ${normalized.frameWidth}x${normalized.frameHeight}, scale = ${normalized.scale.toFixed(3)}`);
    allStrips.push(...strips);
  }

  // Save updated manifest.json files
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(clientManifestPath, JSON.stringify(clientManifest, null, 2));

  // Build composite master spritesheet grid
  console.log('\nAssembling composite attack master spritesheet...');
  const masterSheetPath = resolve(ASSETS_DIR, 'attack-spritesheet-all-characters.png');
  await buildCompositeSpritesheet(allStrips, masterSheetPath);
  console.log(`  ✓ Wrote composite attack spritesheet: ${masterSheetPath}`);

  console.log('\n=== Beastfolk Basic Attack Import Completed Successfully! ===');
  console.log(`Total attack strips written: ${allStrips.length}`);
}

main().catch((err) => {
  console.error('Fatal error during attack import:', err);
  process.exit(1);
});
