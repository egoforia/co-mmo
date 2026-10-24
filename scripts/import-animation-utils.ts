import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { CHARACTER_HEIGHT, ISO_WAYS, TURNTABLE_WAYS, type IsoWay } from '../packages/shared/src/walk.ts';
import { removeKeyBackground, removeKeySpill } from '../packages/server/src/assets/postprocess.ts';
import { isolateFigure, normalizeWalk, type NormalizedWalk } from '../packages/server/src/assets/walk-frames.ts';

// Shared, AI model and API-agnostic utilities for importing character and creature
// animation clips (walks, runs, attacks) and turnaround sheets into co-mmo's art pipeline.

export interface ExtractVideoOptions {
  /** Source video file path. */
  videoPath: string;
  /** Destination directory for extracted PNG frames. */
  framesDir: string;
  /** Pattern for frame names (default: 'f_%03d.png'). */
  pattern?: string;
}

/**
 * Extracts raw frames from a video file using ffmpeg if the frames directory is empty or missing.
 * Returns sorted file paths to all extracted PNG frames.
 */
export async function extractVideoFrames({ videoPath, framesDir, pattern = 'f_%03d.png' }: ExtractVideoOptions): Promise<string[]> {
  await mkdir(framesDir, { recursive: true });
  const existing = (await readdir(framesDir).catch(() => [])).filter((f) => f.endsWith('.png')).sort();
  if (!existing.length) {
    if (!existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);
    execSync(`ffmpeg -y -i "${videoPath}" -vsync 0 "${resolve(framesDir, pattern)}"`, { stdio: 'pipe' });
    const fresh = (await readdir(framesDir)).filter((f) => f.endsWith('.png')).sort();
    return fresh.map((f) => resolve(framesDir, f));
  }
  return existing.map((f) => resolve(framesDir, f));
}

export interface ProcessFrameOptions {
  /** Optional bounding box crop within the frame. */
  box?: { left: number; top: number; width: number; height: number };
  /** Chroma key tolerance (default 80). */
  tolerance?: number;
  /** Whether to isolate connected character components and filter specks (default true). */
  isolate?: boolean;
}

/**
 * Processes a single frame: crops to box (if given), removes flat magenta background,
 * strips rim spill, and isolates the connected character component.
 */
export async function processFrame(rawInput: Buffer | string, options: ProcessFrameOptions = {}): Promise<Buffer> {
  let img = typeof rawInput === 'string' ? sharp(rawInput) : sharp(rawInput);
  if (options.box) {
    img = img.extract(options.box);
  }
  const rawPng = await img.png().toBuffer();
  const { png } = await removeKeyBackground(rawPng, options.tolerance ?? 80, { holes: true });
  const cleanSpill = await removeKeySpill(png);
  if (options.isolate ?? true) {
    return isolateFigure(cleanSpill);
  }
  return cleanSpill;
}

/**
 * Extracts the 4 isometric standing views from a turnaround sheet in the specified order.
 * Defaults to clockwise turntable sequence (Col 0: FL, Col 1: FR, Col 2: BR, Col 3: BL).
 */
export async function extractTurnaroundViews(
  sheetPath: string,
  ways: readonly IsoWay[] = TURNTABLE_WAYS,
): Promise<Record<IsoWay, Buffer>> {
  const meta = await sharp(sheetPath).metadata();
  const w = meta.width ?? 1680;
  const h = meta.height ?? 800;
  const segW = Math.round(w / 4);

  const views: Partial<Record<IsoWay, Buffer>> = {};
  for (let c = 0; c < 4; c++) {
    const way = ways[c]!;
    const crop = await sharp(sheetPath)
      .extract({ left: c * segW, top: 0, width: segW, height: h })
      .png()
      .toBuffer();
    const clean = await processFrame(crop, undefined, { isolate: true });
    views[way] = await sharp(clean).trim().png().toBuffer();
  }
  return views as Record<IsoWay, Buffer>;
}

export interface SaveAnimationOptions {
  /** Base character identifier (e.g. 'bramble-ursine'). */
  charId: string;
  /** Animation action kind. */
  kind: 'walk' | 'run' | 'attack';
  /** Directions frames: array of 4 frame buffers in `ways` order. */
  directionsFrames: Buffer[][];
  /** Ordering of the 4 directions (default: ISO_WAYS). */
  ways?: readonly IsoWay[];
  /** Target canonical body height (default: CHARACTER_HEIGHT = 168px). */
  bodyHeight?: number;
  /** Cycle duration in seconds (default: 0.8s for walk/attack, 0.67s for run). */
  cycleSeconds?: number;
  /** Directory to save data art strips and frame JSONs (e.g. 'data/art/walks'). */
  dataDir: string;
  /** Directory for client public art (e.g. 'packages/client/public/art'). */
  clientArtDir?: string;
  /** Optional manifests to update in-memory. */
  manifest?: Record<string, any>;
  clientManifest?: Record<string, any>;
}

export interface StripResult {
  charId: string;
  way: IsoWay;
  stripBuf: Buffer;
  width: number;
  height: number;
}

export interface SaveAnimationResult {
  normalized: NormalizedWalk;
  strips: StripResult[];
}

/**
 * Normalizes animation strips across all 4 facings to canonical height and baseline,
 * writes strip PNGs, individual frame PNGs, and updates manifests.
 */
export async function saveAnimationOutputs(options: SaveAnimationOptions): Promise<SaveAnimationResult> {
  const {
    charId,
    kind,
    directionsFrames,
    ways = ISO_WAYS,
    bodyHeight = CHARACTER_HEIGHT,
    cycleSeconds = kind === 'run' ? 0.67 : 0.8,
    dataDir,
    clientArtDir = resolve('packages/client/public/art'),
    manifest,
    clientManifest,
  } = options;

  await mkdir(dataDir, { recursive: true });
  const framesOutDir = resolve(dataDir, 'frames');
  await mkdir(framesOutDir, { recursive: true });
  if (clientArtDir) await mkdir(clientArtDir, { recursive: true });

  const normalized = await normalizeWalk(directionsFrames, { bodyHeight });
  const results: StripResult[] = [];

  for (let c = 0; c < ways.length; c++) {
    const way = ways[c]!;
    const animId = `${charId}-${kind}-${way}`;
    const stripBuf = normalized.strips[c]!;
    const wayFrames = directionsFrames[c]!;
    const stripWidth = normalized.frameWidth * wayFrames.length;
    const stripHeight = normalized.frameHeight;

    results.push({ charId, way, stripBuf, width: stripWidth, height: stripHeight });

    // Write strip PNG
    await writeFile(resolve(dataDir, `${animId}.png`), stripBuf);
    if (clientArtDir) {
      await writeFile(resolve(clientArtDir, `${animId}.png`), stripBuf);
    }

    // Write individual frames and json index
    const frameNames: string[] = [];
    for (let i = 0; i < wayFrames.length; i++) {
      const frameName = `${animId}-${String(i + 1).padStart(2, '0')}.png`;
      frameNames.push(frameName);
      await writeFile(resolve(framesOutDir, frameName), wayFrames[i]!);
    }
    await writeFile(resolve(framesOutDir, `${animId}.json`), JSON.stringify(frameNames, null, 2));

    // Update manifest entries
    const now = Date.now();
    if (manifest) {
      manifest[animId] = {
        file: `wished-art/${kind}s/${animId}.png?v=${now.toString(36)}`,
        kind,
        width: stripWidth,
        height: stripHeight,
        frames: wayFrames.length,
        cycleSeconds,
        redone: now,
      };
    }
    if (clientManifest) {
      clientManifest[animId] = {
        file: `art/${animId}.png`,
        kind: 'walk', // 'walk' kind allows Phaser and CSS to auto-load and animate it
        width: stripWidth,
        height: stripHeight,
        frames: wayFrames.length,
        cycleSeconds,
      };
    }
  }

  return { normalized, strips: results };
}

/**
 * Builds a composite master spritesheet grid stacking all strips vertically.
 */
export async function buildCompositeSpritesheet(strips: StripResult[], outPath: string): Promise<Buffer> {
  const maxStripWidth = Math.max(...strips.map((s) => s.width));
  const maxStripHeight = Math.max(...strips.map((s) => s.height));

  const composite = sharp({
    create: {
      width: maxStripWidth,
      height: maxStripHeight * strips.length,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  const inputs = strips.map((s, idx) => ({
    input: s.stripBuf,
    top: idx * maxStripHeight,
    left: 0,
  }));

  const compositeBuf = await composite.composite(inputs).png().toBuffer();
  await writeFile(outPath, compositeBuf);
  return compositeBuf;
}
