import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { CHARACTER_HEIGHT, ISO_WAYS, type IsoWay } from '../packages/shared/src/walk.ts';
import { removeKeyBackground, removeKeySpill } from '../packages/server/src/assets/postprocess.ts';
import { normalizeWalk } from '../packages/server/src/assets/walk-frames.ts';

// Imports the 5 beastfolk walk animations extracted from the Wan 3.0 video
// into co-mmo's data-driven art pipeline without modifying any core game code.

interface CharacterSpec {
  id: string;
  name: string;
  rowIndex: number;
  standSheet: string;
}

const ASSETS_DIR = resolve(import.meta.dirname, '../assets/beastfolk');

const CHARACTERS: CharacterSpec[] = [
  {
    id: 'bramble-ursine',
    name: 'Bramble-Ursine',
    rowIndex: 0,
    standSheet: resolve(ASSETS_DIR, 'bramble-ursine-turnaround.png'),
  },
  {
    id: 'tide-lutran',
    name: 'Tide-Lutran',
    rowIndex: 1,
    standSheet: resolve(ASSETS_DIR, 'tide-lutran-turnaround.png'),
  },
  {
    id: 'zephyr-falcon',
    name: 'Zephyr-Falcon',
    rowIndex: 2,
    standSheet: resolve(ASSETS_DIR, 'zephyr-falcon-turnaround.png'),
  },
  {
    id: 'dune-scorpid',
    name: 'Dune-Scorpid',
    rowIndex: 3,
    standSheet: resolve(ASSETS_DIR, 'dune-scorpid-turnaround.png'),
  },
  {
    id: 'sylvan-cervid',
    name: 'Sylvan-Cervid',
    rowIndex: 4,
    standSheet: resolve(ASSETS_DIR, 'sylvan-cervid-turnaround.png'),
  },
];

const VIDEO_PATH = resolve(ASSETS_DIR, 'walk-loop-16fps.mp4');
const FRAMES_DIR = resolve('data/art/walks/raw_frames');
const DATA_WALKS_DIR = resolve('data/art/walks');
const VIEWS_DIR = resolve(DATA_WALKS_DIR, 'views');
const FRAMES_OUT_DIR = resolve(DATA_WALKS_DIR, 'frames');

// Cell bounds inside the 1080x1920 video
// Grid was scaled by 0.48 from 2250x4000 (left margin 136.8, cell_w 201.6, cell_h 384)
function getCellBox(r: number, c: number) {
  const left = Math.round(136.8 + c * 201.6);
  const width = Math.round(201.6);
  const top = r * 384;
  const height = 384;
  return { left, top, width, height };
}

// Extract standing figures from a 4-way turnaround sheet
async function extractStandingViews(sheetPath: string): Promise<Record<IsoWay, Buffer>> {
  const im = sharp(sheetPath);
  const meta = await im.metadata();
  const w = meta.width ?? 1680;
  const h = meta.height ?? 800;

  // Standalone sheet has 4 figures evenly distributed across 1680x800
  const segW = Math.round(w / 4);
  const views: Record<string, Buffer> = {};

  for (let c = 0; c < 4; c++) {
    const way = ISO_WAYS[c]!;
    const crop = await sharp(sheetPath)
      .extract({ left: c * segW, top: 0, width: segW, height: h })
      .png()
      .toBuffer();
    const { png } = await removeKeyBackground(crop, 80, { holes: true });
    const clean = await removeKeySpill(png);
    views[way] = await sharp(clean).trim().png().toBuffer();
  }
  return views as Record<IsoWay, Buffer>;
}

async function main() {
  console.log('=== Starting Beastfolk Walk Animation Import into co-mmo ===');

  await mkdir(DATA_WALKS_DIR, { recursive: true });
  await mkdir(VIEWS_DIR, { recursive: true });
  await mkdir(FRAMES_OUT_DIR, { recursive: true });

  if (!existsSync(FRAMES_DIR)) {
    await mkdir(FRAMES_DIR, { recursive: true });
    console.log(`Extracting raw video frames from ${VIDEO_PATH} to ${FRAMES_DIR}...`);
    execSync(`ffmpeg -y -i "${VIDEO_PATH}" -vsync 0 "${FRAMES_DIR}/frame_%03d.png"`, { stdio: 'inherit' });
  }

  const manifestPath = resolve(DATA_WALKS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));

  const looksPath = resolve(DATA_WALKS_DIR, 'looks.json');
  const looks = JSON.parse(await readFile(looksPath, 'utf8').catch(() => '{}'));

  const clientArtDir = resolve('packages/client/public/art');
  const clientManifestPath = resolve(clientArtDir, 'manifest.json');
  const clientManifest = JSON.parse(await readFile(clientManifestPath, 'utf8').catch(() => '{}'));

  // The seamless 14-frame walk cycle at 15 fps (0.93s period), skipping the static hold frames (1-11)
  const frameIndices = [18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44];
  console.log(`Using ${frameIndices.length} frames per walk cycle: [${frameIndices.join(', ')}]`);

  for (const char of CHARACTERS) {
    console.log(`\nProcessing ${char.name} (${char.id})...`);

    // 1. Process standing views
    console.log(`  Extracting standing views from ${char.standSheet}...`);
    const standingViews = await extractStandingViews(char.standSheet);
    for (const [way, buf] of Object.entries(standingViews)) {
      const viewFile = resolve(VIEWS_DIR, `${char.id}-${way}.png`);
      await writeFile(viewFile, buf);
    }

    // 2. Extract walk frames for all 4 isometric ways
    const directionsFrames: Buffer[][] = [];

    for (let c = 0; c < ISO_WAYS.length; c++) {
      const way = ISO_WAYS[c]!;
      const box = getCellBox(char.rowIndex, c);
      const wayFrames: Buffer[] = [];

      for (const fIdx of frameIndices) {
        const frameFileName = `frame_${String(fIdx).padStart(3, '0')}.png`;
        const framePath = resolve(FRAMES_DIR, frameFileName);

        const crop = await sharp(framePath).extract(box).png().toBuffer();
        const { png } = await removeKeyBackground(crop, 80, { holes: true });
        const clean = await removeKeySpill(png);
        wayFrames.push(clean);
      }
      directionsFrames.push(wayFrames);
    }

    // 3. Normalize walk strips to CHARACTER_HEIGHT (168px) and align baselines
    console.log(`  Normalizing walk strips to CHARACTER_HEIGHT (${CHARACTER_HEIGHT}px)...`);
    const normalized = await normalizeWalk(directionsFrames, { bodyHeight: CHARACTER_HEIGHT });
    console.log(`  Normalized: frame size = ${normalized.frameWidth}x${normalized.frameHeight}, scale = ${normalized.scale.toFixed(3)}`);

    // 4. Save walk strips, individual frames, and update manifest
    for (let c = 0; c < ISO_WAYS.length; c++) {
      const way = ISO_WAYS[c]!;
      const walkId = `${char.id}-walk-${way}`;
      const stripBuf = normalized.strips[c]!;
      const wayFrames = directionsFrames[c]!;

      // Save strip PNG in data/art/walks and client art
      const stripPath = resolve(DATA_WALKS_DIR, `${walkId}.png`);
      await writeFile(stripPath, stripBuf);
      const clientStripPath = resolve(clientArtDir, `${walkId}.png`);
      await writeFile(clientStripPath, stripBuf);

      // Save individual frames and json index
      const frameNames: string[] = [];
      for (let i = 0; i < wayFrames.length; i++) {
        const frameName = `${walkId}-${String(i + 1).padStart(2, '0')}.png`;
        frameNames.push(frameName);
        await writeFile(resolve(FRAMES_OUT_DIR, frameName), wayFrames[i]!);
      }
      await writeFile(resolve(FRAMES_OUT_DIR, `${walkId}.json`), JSON.stringify(frameNames, null, 2));

      // Manifest entries
      const now = Date.now();
      const stripEntry = {
        file: `wished-art/walks/${walkId}.png?v=${now.toString(36)}`,
        kind: 'walk' as const,
        width: normalized.frameWidth * wayFrames.length,
        height: normalized.frameHeight,
        frames: wayFrames.length,
        cycleSeconds: 0.9,
        redone: now,
      };
      manifest[walkId] = stripEntry;

      clientManifest[walkId] = {
        file: `art/${walkId}.png`,
        kind: 'walk',
        width: normalized.frameWidth * wayFrames.length,
        height: normalized.frameHeight,
        frames: wayFrames.length,
        cycleSeconds: 0.9,
      };
      console.log(`  ✓ Wrote ${walkId}.png (${normalized.frameWidth * wayFrames.length}x${normalized.frameHeight})`);
    }

    // Record look id hash in looks.json
    looks[char.id] = Buffer.from(char.id).toString('hex').slice(0, 12);
  }

  // 5. Save updated manifest.json and looks.json
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
