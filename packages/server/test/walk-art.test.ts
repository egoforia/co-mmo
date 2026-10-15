import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { WALK_FRAMES, walkArt, walkArtIds, type ArtManifest } from '@co-mmo/shared';
import type { GeneratedImage, ImageProvider, ImageRequest } from '../src/assets/provider.ts';
import { SHEET_COLUMNS, SHEET_ROWS, processWalkArt, walkArtJobs } from '../src/assets/walk-art.ts';
import { WalkPainter } from '../src/walk-painter.ts';

/** A sheet like the model's: eight figures on magenta, each a little taller than the last, or one missing. */
async function fakeSheet(missing?: number): Promise<GeneratedImage> {
  const cell = { width: 200, height: 220 };
  const figures = [];
  for (let i = 0; i < SHEET_COLUMNS * SHEET_ROWS; i++) {
    if (i === missing) continue;
    const h = 120 + i * 5;
    const input = await sharp({ create: { width: 70, height: h, channels: 3, background: '#3a5f8a' } }).png().toBuffer();
    figures.push({ input, left: (i % SHEET_COLUMNS) * cell.width + 65, top: Math.floor(i / SHEET_COLUMNS) * cell.height + 20 + (i % 2) * 10 });
  }
  const data = await sharp({ create: { width: cell.width * SHEET_COLUMNS, height: cell.height * SHEET_ROWS, channels: 3, background: '#ff00ff' } })
    .composite(figures)
    .png()
    .toBuffer();
  return { mimeType: 'image/png', data, outputTokens: 1120 };
}

class FakeProvider implements ImageProvider {
  readonly id = 'gemini';
  readonly model = 'gemini-3.1-flash-image';
  readonly requests: ImageRequest[] = [];
  async generate(request: ImageRequest): Promise<GeneratedImage> {
    this.requests.push(request);
    return fakeSheet();
  }
}

describe('walk art jobs', () => {
  it('asks for eight frames in each of the four directions, painted from the approved look', () => {
    const jobs = walkArtJobs();
    expect(jobs.map((j) => j.id)).toEqual(walkArtIds());
    const back = jobs.find((j) => j.id === walkArt('player-ilya', 'back'))!;
    expect(back.look).toBe('player-ilya');
    expect(back.prompt).toMatch(/exactly 8 frames/);
    expect(back.prompt).toMatch(/walking away from the viewer/);
    expect(back.prompt).toMatch(/long red scarf/);
  });
});

describe('processWalkArt', () => {
  const job = walkArtJobs()[0]!;

  it('lines the frames up in one strip, feet on the bottom row, all the same size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'walk-art-'));
    const entry = await processWalkArt(job, (await fakeSheet()).data, dir);
    expect(entry).toMatchObject({ file: `art/${job.id}.png`, kind: 'walk', width: 128 * WALK_FRAMES, height: 192 });
    const { data, info } = await sharp(await readFile(join(dir, `${job.id}.png`))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([128 * WALK_FRAMES, 192]);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]!;
    for (let i = 0; i < WALK_FRAMES; i++) {
      const middle = i * 128 + 64;
      // Every figure stands on the bottom row, in the middle of its frame.
      expect(alpha(middle, 191)).toBeGreaterThan(200);
      expect(alpha(i * 128 + 2, 191)).toBe(0);
    }
    // The tallest figure fills the frame; shorter ones are not stretched to match.
    expect(alpha(7 * 128 + 64, 2)).toBeGreaterThan(200);
    expect(alpha(64, 20)).toBe(0);
  });

  it('refuses a sheet with a frame missing, so it is painted again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'walk-art-'));
    await expect(processWalkArt(job, (await fakeSheet(5)).data, dir)).rejects.toThrow(/frame 6/);
  });
});

describe('WalkPainter', () => {
  it('paints only the walk sheets that did not ship, and serves them', async () => {
    const artDir = await mkdtemp(join(tmpdir(), 'walks-'));
    const provider = new FakeProvider();
    const ids = walkArtIds();
    const shipped: ArtManifest = Object.fromEntries(ids.slice(0, -2).map((id) => [id, { file: `art/${id}.png`, kind: 'walk', width: 1, height: 1 }]));
    const spent: number[] = [];
    const painter = new WalkPainter({
      provider: () => provider, overBudget: () => false, spend: (usd) => spent.push(usd),
      anchorDir: artDir, artDir, shipped: async () => shipped,
    });
    await painter.start();
    expect(Object.keys(painter.manifest())).toEqual(ids.slice(-2));
    expect(painter.manifest()[ids.at(-1)!]!.file).toBe(`wished-art/walks/${ids.at(-1)}.png`);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]!.aspectRatio).toBe('16:9');
    expect(spent).toHaveLength(2);
    await painter.start();
    expect(provider.requests).toHaveLength(2);
  });

  it('paints nothing without an image model or over budget', async () => {
    const artDir = await mkdtemp(join(tmpdir(), 'walks-'));
    const provider = new FakeProvider();
    for (const options of [{ provider: () => undefined, overBudget: () => false }, { provider: () => provider, overBudget: () => true }]) {
      const painter = new WalkPainter({ ...options, spend: () => {}, anchorDir: artDir, artDir, shipped: async () => ({}) });
      await painter.start();
      expect(painter.manifest()).toEqual({});
    }
    expect(provider.requests).toHaveLength(0);
  });
});
