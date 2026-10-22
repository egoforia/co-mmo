import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { CHARACTER_HEIGHT, ISO_WAYS, type IsoWay } from '../packages/shared/src/walk.ts';
import { removeKeyBackground, removeKeySpill } from '../packages/server/src/assets/postprocess.ts';
import { normalizeWalk } from '../packages/server/src/assets/walk-frames.ts';

// Imports the 5 beastfolk basic attack animations extracted from the 5 individual Wan 3.0 videos
// into co-mmo's art pipeline and generates master spritesheets and previews.

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
const FRAMES_OUT_DIR = resolve(DATA_ATTACKS_DIR, 'frames');

// Cell bounds inside each 1280x720 individual video.
// Columns in video from left to right:
// Col 0: front-left
// Col 1: back-right
// Col 2: back-left
// Col 3: front-right
const WAY_TO_BOX: Record<IsoWay, { left: number; top: number; width: number; height: number }> = {
  'front-left': { left: 0, top: 0, width: 320, height: 720 },
  'front-right': { left: 960, top: 0, width: 320, height: 720 },
  'back-left': { left: 640, top: 0, width: 320, height: 720 },
  'back-right': { left: 320, top: 0, width: 320, height: 720 },
};

/**
 * Connected-component segmentation to isolate the character and reject
 * any disconnected fragments or thin artifact whiskers touching the cell boundaries.
 */
async function isolateCharacterShape(pngBuf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const cleanData = Buffer.from(data);

  // Prune any thin artifact whiskers directly touching the lateral borders (8px margin)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 8; x++) {
      cleanData[(y * w + x) * 4 + 3] = 0;
    }
    for (let x = Math.max(0, w - 8); x < w; x++) {
      cleanData[(y * w + x) * 4 + 3] = 0;
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

  // Filter out any disconnected components touching borders or specks smaller than 15% of main body
  for (let i = 1; i < components.length; i++) {
    const comp = components[i]!;
    if (comp.pixels.length < mainSize * 0.15 || comp.touchesLeft || comp.touchesRight) {
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

  const manifestPath = resolve(DATA_ATTACKS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));

  const clientArtDir = resolve('packages/client/public/art');
  const clientManifestPath = resolve(clientArtDir, 'manifest.json');
  const clientManifest = JSON.parse(await readFile(clientManifestPath, 'utf8').catch(() => '{}'));

  // 12-frame single-hand strike with organic recovery back to neutral idle:
  // Uniform +4 step cadence across 60 raw video frames:
  // [6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50]
  // 12 frames at 15 fps = 0.8s cycle duration (matching attackCooldown and walk frame counts)
  const frameIndices = [6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50];
  console.log(`Using ${frameIndices.length} frames per attack cycle: [${frameIndices.join(', ')}]`);

  const allNormalizedStrips: { charId: string; way: IsoWay; stripBuf: Buffer; width: number; height: number }[] = [];

  for (const char of CHARACTERS) {
    console.log(`\nProcessing attack animations for ${char.name} (${char.id})...`);

    const charRawFramesDir = resolve(DATA_ATTACKS_DIR, `${char.id}_raw_frames`);
    const charVideoPath = resolve(ASSETS_DIR, `individual_${char.id}_attack_raw.mp4`);

    if (!existsSync(charRawFramesDir)) {
      await mkdir(charRawFramesDir, { recursive: true });
      console.log(`  Extracting raw frames from ${charVideoPath}...`);
      execSync(`ffmpeg -y -i "${charVideoPath}" -vsync 0 "${charRawFramesDir}/frame_%03d.png"`, { stdio: 'inherit' });
    }

    // Extract attack frames for all 4 isometric ways in canonical ISO_WAYS order:
    // [ 'front-left', 'front-right', 'back-left', 'back-right' ]
    const directionsFrames: Buffer[][] = [];

    for (let wayIdx = 0; wayIdx < ISO_WAYS.length; wayIdx++) {
      const way = ISO_WAYS[wayIdx]!;
      const box = WAY_TO_BOX[way];
      const wayFrames: Buffer[] = [];

      for (const fIdx of frameIndices) {
        const frameFileName = `frame_${String(fIdx).padStart(3, '0')}.png`;
        const framePath = resolve(charRawFramesDir, frameFileName);

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
    for (let wayIdx = 0; wayIdx < ISO_WAYS.length; wayIdx++) {
      const way = ISO_WAYS[wayIdx]!;
      const attackId = `${char.id}-attack-${way}`;
      const stripBuf = normalized.strips[wayIdx]!;
      const wayFrames = directionsFrames[wayIdx]!;

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
