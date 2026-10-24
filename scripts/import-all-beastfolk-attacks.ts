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

// Imports the 5 beastfolk basic attack animations from 20 single-facing videos
// into co-mmo's model-agnostic art pipeline.

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

// Calibrated 12-frame strike cycle sampling:
// Idle -> Windup -> Forward Drive -> Apex -> Recovery back to neutral Idle
const WAY_FRAMES: Record<IsoWay, number[]> = {
  'front-left':  [20, 36, 48, 54, 57, 59, 70, 85, 99, 105, 111, 117],
  'front-right': [20, 36, 46, 50, 52, 55, 70, 85, 97, 103, 111, 117],
  'back-left':   [20, 38, 48, 56, 62, 67, 75, 87, 95, 103, 111, 117],
  'back-right':  [20, 38, 48, 56, 64, 71, 79, 89, 97, 103, 109, 115],
};

async function main() {
  console.log('=== Starting Full Beastfolk Single-Facing Attack Import ===');

  await mkdir(DATA_ATTACKS_DIR, { recursive: true });

  const manifestPath = resolve(DATA_ATTACKS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));

  const clientArtDir = resolve('packages/client/public/art');
  const clientManifestPath = resolve(clientArtDir, 'manifest.json');
  const clientManifest = JSON.parse(await readFile(clientManifestPath, 'utf8').catch(() => '{}'));

  const allStrips: StripResult[] = [];

  for (const char of CHARACTERS) {
    console.log(`\nProcessing 4-way attack animations for ${char.name} (${char.id})...`);

    const charRawBase = resolve(DATA_ATTACKS_DIR, `${char.id}_single_frames`);
    await mkdir(charRawBase, { recursive: true });

    const directionsFrames: Buffer[][] = [];

    for (let wayIdx = 0; wayIdx < ISO_WAYS.length; wayIdx++) {
      const way = ISO_WAYS[wayIdx]!;
      const wayFramesDir = resolve(charRawBase, way);
      const videoPath = resolve(ASSETS_DIR, `single_${char.id}_${way}_raw.mp4`);

      await extractVideoFrames({ videoPath, framesDir: wayFramesDir, pattern: 'f_%03d.png' });

      const fIndices = WAY_FRAMES[way];
      const wayFrames: Buffer[] = [];

      for (const fIdx of fIndices) {
        const frameFileName = `f_${String(fIdx).padStart(3, '0')}.png`;
        const framePath = resolve(wayFramesDir, frameFileName);
        const clean = await processFrame(framePath, undefined, { isolate: true });
        wayFrames.push(clean);
      }
      directionsFrames.push(wayFrames);
    }

    console.log(`  Normalizing strips to canonical height (${CHARACTER_HEIGHT}px)...`);
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

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(clientManifestPath, JSON.stringify(clientManifest, null, 2));

  console.log('\nAssembling composite attack master spritesheet...');
  const masterSheetPath = resolve(ASSETS_DIR, 'attack-spritesheet-all-characters.png');
  await buildCompositeSpritesheet(allStrips, masterSheetPath);
  console.log(`  ✓ Wrote composite attack spritesheet: ${masterSheetPath}`);

  console.log('\n=== All 20 Beastfolk Attack Strips Successfully Processed! ===');
}

main().catch((err) => {
  console.error('Fatal error during attack import:', err);
  process.exit(1);
});
