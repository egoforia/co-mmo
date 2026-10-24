import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CHARACTER_HEIGHT, ISO_WAYS, TURNTABLE_WAYS, type IsoWay } from '../packages/shared/src/walk.ts';
import {
  extractTurnaroundViews,
  extractVideoFrames,
  processFrame,
  saveAnimationOutputs,
} from './import-animation-utils.ts';

// Imports the 5 beastfolk walk animations into co-mmo's model-agnostic art pipeline.

interface CharacterSpec {
  id: string;
  name: string;
  rowIndex: number;
  standSheet: string;
}

const ASSETS_DIR = resolve(import.meta.dirname, '../assets/beastfolk');

const CHARACTERS: CharacterSpec[] = [
  { id: 'bramble-ursine', name: 'Bramble-Ursine', rowIndex: 0, standSheet: resolve(ASSETS_DIR, 'bramble-ursine-turnaround.png') },
  { id: 'tide-lutran', name: 'Tide-Lutran', rowIndex: 1, standSheet: resolve(ASSETS_DIR, 'tide-lutran-turnaround.png') },
  { id: 'zephyr-falcon', name: 'Zephyr-Falcon', rowIndex: 2, standSheet: resolve(ASSETS_DIR, 'zephyr-falcon-turnaround.png') },
  { id: 'dune-scorpid', name: 'Dune-Scorpid', rowIndex: 3, standSheet: resolve(ASSETS_DIR, 'dune-scorpid-turnaround.png') },
  { id: 'sylvan-cervid', name: 'Sylvan-Cervid', rowIndex: 4, standSheet: resolve(ASSETS_DIR, 'sylvan-cervid-turnaround.png') },
];

const VIDEO_PATH = resolve(ASSETS_DIR, 'walk-loop-16fps.mp4');
const DATA_WALKS_DIR = resolve('data/art/walks');
const FRAMES_DIR = resolve(DATA_WALKS_DIR, 'raw_frames');
const VIEWS_DIR = resolve(DATA_WALKS_DIR, 'views');

// Cell bounds inside the 1080x1920 video grid
function getCellBox(r: number, c: number) {
  const left = Math.round(136.8 + c * 201.6);
  const width = Math.round(201.6);
  const top = r * 384;
  const height = 384;
  return { left, top, width, height };
}

// Turntable turnaround sheets order positions 3 and 4 as back-right and back-left
const waysForChar = (charId: string): readonly IsoWay[] =>
  charId === 'bramble-ursine' ? TURNTABLE_WAYS : ISO_WAYS;

async function main() {
  console.log('=== Starting Beastfolk Walk Animation Import into co-mmo ===');

  await mkdir(DATA_WALKS_DIR, { recursive: true });
  await mkdir(VIEWS_DIR, { recursive: true });

  const frameFiles = await extractVideoFrames({ videoPath: VIDEO_PATH, framesDir: FRAMES_DIR, pattern: 'frame_%03d.png' });
  console.log(`Video frames ready: ${frameFiles.length} frames in ${FRAMES_DIR}`);

  const manifestPath = resolve(DATA_WALKS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));

  const looksPath = resolve(DATA_WALKS_DIR, 'looks.json');
  const looks = JSON.parse(await readFile(looksPath, 'utf8').catch(() => '{}'));

  const clientArtDir = resolve('packages/client/public/art');
  const clientManifestPath = resolve(clientArtDir, 'manifest.json');
  const clientManifest = JSON.parse(await readFile(clientManifestPath, 'utf8').catch(() => '{}'));

  // 12-frame walk cycle spanning 2 strides [21..48)
  const frameIndices = [21, 23, 26, 28, 30, 32, 35, 37, 39, 41, 44, 46];
  console.log(`Using ${frameIndices.length} frames per walk cycle: [${frameIndices.join(', ')}]`);

  for (const char of CHARACTERS) {
    console.log(`\nProcessing ${char.name} (${char.id})...`);
    const ways = waysForChar(char.id);

    // 1. Process standing views from turnaround sheet
    if (existsSync(char.standSheet)) {
      console.log(`  Extracting standing views from ${char.standSheet}...`);
      const standingViews = await extractTurnaroundViews(char.standSheet, ways);
      for (const [way, buf] of Object.entries(standingViews)) {
        await writeFile(resolve(VIEWS_DIR, `${char.id}-${way}.png`), buf);
      }
    }

    // 2. Extract walk frames for all 4 isometric ways
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

    // 3. Normalize walk strips and save outputs
    console.log(`  Normalizing walk strips to canonical height (${CHARACTER_HEIGHT}px)...`);
    const { normalized } = await saveAnimationOutputs({
      charId: char.id,
      kind: 'walk',
      directionsFrames,
      ways,
      bodyHeight: CHARACTER_HEIGHT,
      cycleSeconds: 0.9,
      dataDir: DATA_WALKS_DIR,
      clientArtDir,
      manifest,
      clientManifest,
    });
    console.log(`  Normalized: frame size = ${normalized.frameWidth}x${normalized.frameHeight}, scale = ${normalized.scale.toFixed(3)}`);

    // Record look id hash in looks.json
    looks[char.id] = Buffer.from(char.id).toString('hex').slice(0, 12);
  }

  // 4. Save updated manifest.json and looks.json
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(looksPath, JSON.stringify(looks, null, 2));
  await writeFile(clientManifestPath, JSON.stringify(clientManifest, null, 2));

  console.log('\n=== Beastfolk Walk Import Completed Successfully! ===');
  console.log(`Total active walk entries in manifest: ${Object.keys(manifest).length}`);
}

main().catch((err) => {
  console.error('Fatal error during walk import:', err);
  process.exit(1);
});
