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
// 5 rows (256px each), 4 spacious columns with ample padding:
// Col 0: [0, 180), Col 1: [180, 360), Col 2: [360, 528), Col 3: [528, 720)
const COL_BOXES = [
  { left: 0, width: 180 },
  { left: 180, width: 180 },
  { left: 360, width: 168 },
  { left: 528, width: 192 },
];

function getCellBox(r: number, c: number) {
  const col = COL_BOXES[c]!;
  return { left: col.left, top: r * 256, width: col.width, height: 256 };
}

/**
 * Connected-component segmentation to isolate the character and reject
 * any disconnected fragments or thin artifact whiskers touching the cell boundaries.
 */
async function isolateCharacterShape(pngBuf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const cleanData = Buffer.from(data);

  // Prune any thin artifact whiskers directly touching the lateral borders
  for (let y = 0; y < h; y++) {
    if ((cleanData[(y * w + 0) * 4 + 3] ?? 0) > 40) {
      for (let x = 0; x < 6; x++) {
        cleanData[(y * w + x) * 4 + 3] = 0;
      }
    }
    if ((cleanData[(y * w + (w - 1)) * 4 + 3] ?? 0) > 40) {
      for (let x = Math.max(0, w - 6); x < w; x++) {
        cleanData[(y * w + x) * 4 + 3] = 0;
      }
    }
  }

  const label = new Int32Array(w * h).fill(-1);
  const components: { pixels: number[]; touchesLeft: boolean; touchesRight: boolean }[] = [];

  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || (cleanData[start * 4 + 3] ?? 0) <= 40) continue;
    const pixels = [start];
    label[start] = components.length;
    let touchesLeft = (start % w) === 0;
    let touchesRight = (start % w) === w - 1;

    for (let k = 0; k < pixels.length; k++) {
      const idx = pixels[k]!;
      const x = idx % w, y = Math.floor(idx / w);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (label[n] !== -1 || (cleanData[n * 4 + 3] ?? 0) <= 40) continue;
          label[n] = components.length;
          pixels.push(n);
          if (nx === 0) touchesLeft = true;
          if (nx === w - 1) touchesRight = true;
        }
      }
    }
    components.push({ pixels, touchesLeft, touchesRight });
  }

  if (components.length <= 1) {
    return sharp(cleanData, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  }

  // Largest component is the main figure
  components.sort((a, b) => b.pixels.length - a.pixels.length);
  const mainSize = components[0]!.pixels.length;

  // Filter out any disconnected components touching borders or specks smaller than 35% of main body
  for (let i = 1; i < components.length; i++) {
    const comp = components[i]!;
    if ((comp.touchesLeft || comp.touchesRight) && comp.pixels.length < mainSize * 0.35) {
      for (const p of comp.pixels) {
        cleanData[p * 4 + 3] = 0;
      }
    }
  }

  return sharp(cleanData, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
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

  // 24-frame full 2-punch combo animation with seamless looping back to neutral idle:
  // Punch 1 (frames 6-22) -> Recoil & Punch 2 (frames 24-38) -> Smooth Return to Idle (frames 40-52 -> 6)
  // 48 raw video frames at 30 fps = 1.6s duration (15 fps uniform cadence)
  const frameIndices = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52];
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
        const cleanSpill = await removeKeySpill(png);
        const clean = await isolateCharacterShape(cleanSpill);
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
        cycleSeconds: 1.6,
        redone: now,
      };
      manifest[attackId] = stripEntry;

      clientManifest[attackId] = {
        file: `art/${attackId}.png`,
        kind: 'walk', // 'walk' kind allows Phaser and CSS to auto-load and animate it
        width: normalized.frameWidth * wayFrames.length,
        height: normalized.frameHeight,
        frames: wayFrames.length,
        cycleSeconds: 1.6,
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
