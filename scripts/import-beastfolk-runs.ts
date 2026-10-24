import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CHARACTER_HEIGHT, ISO_WAYS } from '../packages/shared/src/walk.ts';
import {
  buildCompositeSpritesheet,
  extractVideoFrames,
  processFrame,
  saveAnimationOutputs,
  type StripResult,
} from './import-animation-utils.ts';

// Imports the 5 beastfolk running animations into co-mmo's model-agnostic art pipeline.

interface CharacterSpec {
  id: string;
  name: string;
  rowIndex: number;
}

const ASSETS_DIR = resolve(import.meta.dirname, '../assets/beastfolk');

const CHARACTERS: CharacterSpec[] = [
  { id: 'bramble-ursine', name: 'Bramble-Ursine', rowIndex: 0 },
  { id: 'tide-lutran', name: 'Tide-Lutran', rowIndex: 1 },
  { id: 'zephyr-falcon', name: 'Zephyr-Falcon', rowIndex: 2 },
  { id: 'dune-scorpid', name: 'Dune-Scorpid', rowIndex: 3 },
  { id: 'sylvan-cervid', name: 'Sylvan-Cervid', rowIndex: 4 },
];

const VIDEO_PATH = resolve(ASSETS_DIR, 'run-loop-raw.mp4');
const DATA_RUNS_DIR = resolve('data/art/runs');
const FRAMES_DIR = resolve(DATA_RUNS_DIR, 'raw_frames');

// Cell bounds inside the 720x1280 video grid
function getCellBox(r: number, c: number) {
  const left = Math.round(91.2 + c * 134.4);
  const width = Math.round(134.4);
  const top = r * 256;
  const height = 256;
  return { left, top, width, height };
}

async function main() {
  console.log('=== Starting Beastfolk Running Animation Import into co-mmo ===');

  await mkdir(DATA_RUNS_DIR, { recursive: true });

  const frameFiles = await extractVideoFrames({ videoPath: VIDEO_PATH, framesDir: FRAMES_DIR, pattern: 'frame_%03d.png' });
  console.log(`Video frames ready: ${frameFiles.length} frames in ${FRAMES_DIR}`);

  const manifestPath = resolve(DATA_RUNS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));

  const clientArtDir = resolve('packages/client/public/art');
  const clientManifestPath = resolve(clientArtDir, 'manifest.json');
  const clientManifest = JSON.parse(await readFile(clientManifestPath, 'utf8').catch(() => '{}'));

  // 10-frame running cycle [20..40)
  const frameIndices = [20, 22, 24, 26, 28, 30, 32, 34, 36, 38];
  console.log(`Using ${frameIndices.length} frames per run cycle: [${frameIndices.join(', ')}]`);

  const allStrips: StripResult[] = [];

  for (const char of CHARACTERS) {
    console.log(`\nProcessing running animations for ${char.name} (${char.id})...`);

    const directionsFrames: Buffer[][] = [];
    for (let c = 0; c < 4; c++) {
      const box = getCellBox(char.rowIndex, c);
      const wayFrames: Buffer[] = [];

      for (const fIdx of frameIndices) {
        const frameFileName = `frame_${String(fIdx).padStart(3, '0')}.png`;
        const framePath = resolve(FRAMES_DIR, frameFileName);
        const clean = await processFrame(framePath, box, { isolate: true });
        wayFrames.push(clean);
      }
      directionsFrames.push(wayFrames);
    }

    console.log(`  Normalizing run strips to canonical height (${CHARACTER_HEIGHT}px)...`);
    const { normalized, strips } = await saveAnimationOutputs({
      charId: char.id,
      kind: 'run',
      directionsFrames,
      ways: ISO_WAYS,
      bodyHeight: CHARACTER_HEIGHT,
      cycleSeconds: 0.67,
      dataDir: DATA_RUNS_DIR,
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
  console.log('\nAssembling composite running master spritesheet...');
  const masterSheetPath = resolve(ASSETS_DIR, 'running-spritesheet-all-characters.png');
  await buildCompositeSpritesheet(allStrips, masterSheetPath);
  console.log(`  ✓ Wrote composite running spritesheet: ${masterSheetPath}`);

  console.log('\n=== Beastfolk Running Import Completed Successfully! ===');
  console.log(`Total run strips written: ${allStrips.length}`);
}

main().catch((err) => {
  console.error('Fatal error during run import:', err);
  process.exit(1);
});
