import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { CHARACTER_HEIGHT, ISO_WAYS, type IsoWay } from '../packages/shared/src/walk.ts';
import { removeKeyBackground, removeKeySpill } from '../packages/server/src/assets/postprocess.ts';
import { normalizeWalk } from '../packages/server/src/assets/walk-frames.ts';

// Imports the 5 beastfolk basic attack animations extracted from the Wan 3.0 video
// into co-mmo's art pipeline and generates master spritesheets and previews.

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

const VIDEO_PATH = resolve(ASSETS_DIR, 'attack-loop-raw.mp4');
const DATA_ATTACKS_DIR = resolve('data/art/attacks');
const FRAMES_DIR = resolve(DATA_ATTACKS_DIR, 'raw_frames');
const FRAMES_OUT_DIR = resolve(DATA_ATTACKS_DIR, 'frames');

// Cell bounds inside the 720x1280 video:
// 5 rows (256px each), 4 columns (134.4px each with 91.2px left margin)
function getCellBox(r: number, c: number) {
  const left = Math.round(91.2 + c * 134.4);
  const width = Math.round(134.4);
  const top = r * 256;
  const height = 256;
  return { left, top, width, height };
}

async function main() {
  console.log('=== Starting Beastfolk Basic Attack Animation Import into co-mmo ===');

  await mkdir(DATA_ATTACKS_DIR, { recursive: true });
  await mkdir(FRAMES_OUT_DIR, { recursive: true });

  if (!existsSync(FRAMES_DIR)) {
    await mkdir(FRAMES_DIR, { recursive: true });
    console.log(`Extracting raw video frames from ${VIDEO_PATH} to ${FRAMES_DIR}...`);
    execSync(`ffmpeg -y -i "${VIDEO_PATH}" -vsync 0 "${FRAMES_DIR}/frame_%03d.png"`, { stdio: 'inherit' });
  }

  const manifestPath = resolve(DATA_ATTACKS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));

  const clientArtDir = resolve('packages/client/public/art');
  const clientManifestPath = resolve(clientArtDir, 'manifest.json');
  const clientManifest = JSON.parse(await readFile(clientManifestPath, 'utf8').catch(() => '{}'));

  // 12-frame single attack cycle: Neutral (6) -> Anticipation (8-12) -> Impact (14-15) -> Follow-through (17-21) -> Recovery to Neutral (24-30)
  // 24 video frames at 30 fps = 0.8s duration
  const frameIndices = [6, 8, 10, 12, 14, 15, 17, 19, 21, 24, 27, 30];
  console.log(`Using ${frameIndices.length} frames per attack cycle: [${frameIndices.join(', ')}]`);

  const allNormalizedStrips: { charId: string; way: IsoWay; stripBuf: Buffer; width: number; height: number }[] = [];

  for (const char of CHARACTERS) {
    console.log(`\nProcessing attack animations for ${char.name} (${char.id})...`);

    // Extract attack frames for all 4 isometric ways:
    // c=0: front-left, c=1: front-right, c=2: back-left, c=3: back-right
    const directionsFrames: Buffer[][] = [];

    for (let c = 0; c < 4; c++) {
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

    // Normalize attack strips to CHARACTER_HEIGHT (168px) and align baselines
    console.log(`  Normalizing attack strips to CHARACTER_HEIGHT (${CHARACTER_HEIGHT}px)...`);
    const normalized = await normalizeWalk(directionsFrames, { bodyHeight: CHARACTER_HEIGHT });
    console.log(`  Normalized: frame size = ${normalized.frameWidth}x${normalized.frameHeight}, scale = ${normalized.scale.toFixed(3)}`);

    // Save attack strips, individual frames, and update manifest
    for (let c = 0; c < 4; c++) {
      const way = ISO_WAYS[c]!;
      const attackId = `${char.id}-attack-${way}`;
      const stripBuf = normalized.strips[c]!;
      const wayFrames = directionsFrames[c]!;

      allNormalizedStrips.push({
        charId: char.id,
        way,
        stripBuf,
        width: normalized.frameWidth * wayFrames.length,
        height: normalized.frameHeight,
      });

      // Save strip PNG in data/art/attacks and client art
      const stripPath = resolve(DATA_ATTACKS_DIR, `${attackId}.png`);
      await writeFile(stripPath, stripBuf);
      const clientStripPath = resolve(clientArtDir, `${attackId}.png`);
      await writeFile(clientStripPath, stripBuf);

      // Save individual frames and json index
      const frameNames: string[] = [];
      for (let i = 0; i < wayFrames.length; i++) {
        const frameName = `${attackId}-${String(i + 1).padStart(2, '0')}.png`;
        frameNames.push(frameName);
        await writeFile(resolve(FRAMES_OUT_DIR, frameName), wayFrames[i]!);
      }
      await writeFile(resolve(FRAMES_OUT_DIR, `${attackId}.json`), JSON.stringify(frameNames, null, 2));

      // Manifest entries
      const now = Date.now();
      const stripEntry = {
        file: `wished-art/attacks/${attackId}.png?v=${now.toString(36)}`,
        kind: 'attack' as const,
        width: normalized.frameWidth * wayFrames.length,
        height: normalized.frameHeight,
        frames: wayFrames.length,
        cycleSeconds: 0.8,
        redone: now,
      };
      manifest[attackId] = stripEntry;

      clientManifest[attackId] = {
        file: `art/${attackId}.png`,
        kind: 'walk', // 'walk' kind allows Phaser and CSS to auto-load and animate it
        width: normalized.frameWidth * wayFrames.length,
        height: normalized.frameHeight,
        frames: wayFrames.length,
        cycleSeconds: 0.8,
      };
      console.log(`  ✓ Wrote ${attackId}.png (${normalized.frameWidth * wayFrames.length}x${normalized.frameHeight})`);
    }
  }

  // Save updated manifest.json files
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(clientManifestPath, JSON.stringify(clientManifest, null, 2));

  // Build composite master spritesheet grid containing all 20 attack strips (5 characters x 4 directions)
  console.log('\nAssembling composite attack master spritesheet and preview...');
  const maxStripWidth = Math.max(...allNormalizedStrips.map((s) => s.width));
  const maxStripHeight = Math.max(...allNormalizedStrips.map((s) => s.height));

  const compositeCanvas = sharp({
    create: {
      width: maxStripWidth,
      height: maxStripHeight * 20,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  const compositeInputs = allNormalizedStrips.map((s, idx) => ({
    input: s.stripBuf,
    top: idx * maxStripHeight,
    left: 0,
  }));

  const compositeBuf = await compositeCanvas.composite(compositeInputs).png().toBuffer();
  const masterSheetPath = resolve(ASSETS_DIR, 'attack-spritesheet-all-characters.png');
  await writeFile(masterSheetPath, compositeBuf);
  console.log(`  ✓ Wrote composite attack spritesheet: ${masterSheetPath} (${maxStripWidth}x${maxStripHeight * 20})`);

  console.log('\n=== Beastfolk Basic Attack Import Completed Successfully! ===');
  console.log(`Total attack strips written: ${allNormalizedStrips.length}`);
}

main().catch((err) => {
  console.error('Fatal error during attack import:', err);
  process.exit(1);
});
