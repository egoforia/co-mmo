import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { CHARACTER_HEIGHT, ISO_WAYS, type IsoWay } from '../packages/shared/src/walk.ts';
import { removeKeyBackground, removeKeySpill } from '../packages/server/src/assets/postprocess.ts';
import { normalizeWalk } from '../packages/server/src/assets/walk-frames.ts';

// Imports the 5 beastfolk basic attack animations from the 20 single-facing Wan 3.0 videos
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

// Calibrated 12-frame strike cycle sampling for 5s (150-frame) Wan 3.0 videos:
// Captures Idle -> Windup -> Forward Drive -> Apex -> Recovery back to neutral Idle
const WAY_FRAMES: Record<IsoWay, number[]> = {
  'front-left':  [20, 36, 48, 54, 57, 59, 70, 85, 99, 105, 111, 117],
  'front-right': [20, 36, 46, 50, 52, 55, 70, 85, 97, 103, 111, 117],
  'back-left':   [20, 38, 48, 56, 62, 67, 75, 87, 95, 103, 111, 117],
  'back-right':  [20, 38, 48, 56, 64, 71, 79, 89, 97, 103, 109, 115]
};

async function main() {
  console.log('=== Starting Full Beastfolk Single-Facing Attack Import ===');

  await mkdir(DATA_ATTACKS_DIR, { recursive: true });
  await mkdir(FRAMES_OUT_DIR, { recursive: true });

  const manifestPath = resolve(DATA_ATTACKS_DIR, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));

  const clientArtDir = resolve('packages/client/public/art');
  const clientManifestPath = resolve(clientArtDir, 'manifest.json');
  const clientManifest = JSON.parse(await readFile(clientManifestPath, 'utf8').catch(() => '{}'));

  const allNormalizedStrips: { charId: string; way: IsoWay; stripBuf: Buffer; width: number; height: number }[] = [];

  for (const char of CHARACTERS) {
    console.log(`\nProcessing 4-way attack animations for ${char.name} (${char.id})...`);

    const charRawBase = resolve(DATA_ATTACKS_DIR, `${char.id}_single_frames`);
    await mkdir(charRawBase, { recursive: true });

    const directionsFrames: Buffer[][] = [];

    for (let wayIdx = 0; wayIdx < ISO_WAYS.length; wayIdx++) {
      const way = ISO_WAYS[wayIdx]!;
      const wayFramesDir = resolve(charRawBase, way);
      const videoPath = resolve(ASSETS_DIR, `single_${char.id}_${way}_raw.mp4`);

      if (!existsSync(videoPath)) {
        console.error(`  ERROR: Video file missing: ${videoPath}`);
        process.exit(1);
      }

      if (!existsSync(wayFramesDir)) {
        await mkdir(wayFramesDir, { recursive: true });
        console.log(`  Extracting raw frames for ${way} from ${videoPath}...`);
        execSync(`ffmpeg -y -i "${videoPath}" -vsync 0 "${wayFramesDir}/f_%03d.png"`, { stdio: 'pipe' });
      }

      const fIndices = WAY_FRAMES[way];
      const wayFrames: Buffer[] = [];

      for (const fIdx of fIndices) {
        const frameFileName = `f_${String(fIdx).padStart(3, '0')}.png`;
        const framePath = resolve(wayFramesDir, frameFileName);
        const rawBuf = await sharp(framePath).toBuffer();
        const { png } = await removeKeyBackground(rawBuf, 80, { holes: true });
        const cleanSpill = await removeKeySpill(png);
        wayFrames.push(cleanSpill);
      }
      directionsFrames.push(wayFrames);
    }

    console.log(`  Normalizing strips to CHARACTER_HEIGHT (${CHARACTER_HEIGHT}px)...`);
    const normalized = await normalizeWalk(directionsFrames, { bodyHeight: CHARACTER_HEIGHT });
    console.log(`  Normalized: frame size = ${normalized.frameWidth}x${normalized.frameHeight}, scale = ${normalized.scale.toFixed(3)}`);

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

      const stripPath = resolve(DATA_ATTACKS_DIR, `${attackId}.png`);
      await writeFile(stripPath, stripBuf);
      const clientStripPath = resolve(clientArtDir, `${attackId}.png`);
      await writeFile(clientStripPath, stripBuf);

      const frameNames: string[] = [];
      for (let i = 0; i < wayFrames.length; i++) {
        const frameName = `${attackId}-${String(i + 1).padStart(2, '0')}.png`;
        frameNames.push(frameName);
        await writeFile(resolve(FRAMES_OUT_DIR, frameName), wayFrames[i]!);
      }
      await writeFile(resolve(FRAMES_OUT_DIR, `${attackId}.json`), JSON.stringify(frameNames, null, 2));

      const now = Date.now();
      manifest[attackId] = {
        file: `wished-art/attacks/${attackId}.png?v=${now.toString(36)}`,
        kind: 'attack',
        width: normalized.frameWidth * wayFrames.length,
        height: normalized.frameHeight,
        frames: wayFrames.length,
        cycleSeconds: 0.8,
        redone: now,
      };

      clientManifest[attackId] = {
        file: `art/${attackId}.png`,
        kind: 'walk',
        width: normalized.frameWidth * wayFrames.length,
        height: normalized.frameHeight,
        frames: wayFrames.length,
        cycleSeconds: 0.8,
      };
      console.log(`  ✓ Wrote ${attackId}.png (${normalized.frameWidth * wayFrames.length}x${normalized.frameHeight})`);
    }
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(clientManifestPath, JSON.stringify(clientManifest, null, 2));

  console.log('\nAssembling composite attack master spritesheet...');
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

  console.log('\n=== All 20 Beastfolk Attack Strips Successfully Processed! ===');
}

main().catch((err) => {
  console.error('Fatal error during attack import:', err);
  process.exit(1);
});
