import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { WALK_DIRECTIONS, walkArt } from '@co-mmo/shared';
import type { ImageProvider, ImageRequest } from '../src/assets/provider.ts';
import type { VideoProvider, VideoRequest } from '../src/assets/video.ts';
import { WalkPainter } from '../src/walk-painter.ts';

// Test pictures: simple shapes on magenta, standing in for painted looks.
const picture = (width: number, height: number, shapes: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#FF00FF"/>${shapes}</svg>`)).png().toBuffer();
const walker = (x: number, y: number) =>
  `<rect x="${x - 20}" y="${y - 160}" width="40" height="100" fill="#3060c0"/><circle cx="${x}" cy="${y - 180}" r="22" fill="#e0b090"/><rect x="${x - 14}" y="${y - 60}" width="28" height="60" fill="#604020"/>` +
  `<rect x="${x + 20}" y="${y - 150}" width="30" height="24" fill="#d02020"/>`;

/** A clip's frames: the first picture with two legs striding back and forth under it. */
async function frames(first: Buffer): Promise<Buffer[]> {
  const leg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="100"><rect width="20" height="100" fill="#604020"/></svg>`);
  return Promise.all(Array.from({ length: 96 }, (_, i) => {
    const swing = Math.round(110 * Math.sin((2 * Math.PI * i) / 16));
    return sharp(first).composite([{ input: leg, left: 630 + swing, top: 540 }, { input: leg, left: 630 - swing, top: 540 }]).png().toBuffer();
  }));
}

describe('walk painter', () => {
  it('paints each look standing in every direction, walks it on video, and keeps one cycle of 12 frames per direction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'walks-'));
    const anchorDir = join(root, 'anchors'), artDir = join(root, 'art');
    await mkdir(join(anchorDir, 'raw'), { recursive: true });
    for (const look of ['player-mara', 'player-ilya']) await writeFile(join(anchorDir, 'raw', `${look}.png`), await picture(300, 300, walker(150, 280)));

    const asked: ImageRequest[] = [];
    let doubled = true;
    const images: ImageProvider = {
      id: 'gemini', model: 'gemini-3.1-flash-image',
      generate: async (request) => {
        asked.push(request);
        // The first view comes back with two figures, which must be refused and painted again.
        const twice = doubled && !(doubled = false);
        return { mimeType: 'image/png', data: await picture(400, 300, walker(120, 280) + (twice ? walker(300, 280) : '')) };
      },
    };
    const clips: VideoRequest[] = [];
    const video: VideoProvider = {
      id: 'gemini', model: 'veo-3.1-lite-generate-preview',
      generate: async (request) => {
        clips.push(request);
        return { mimeType: 'video/mp4', data: request.first.data, seconds: request.seconds };
      },
    };
    const spent: number[] = [];
    const painter = new WalkPainter({
      provider: () => images, video: () => video, overBudget: () => false,
      spend: (usd) => spent.push(usd), spendVideo: (usd) => spent.push(usd),
      anchorDir, artDir, shipped: async () => ({}), toFrames: frames,
    });
    await painter.start();

    const manifest = painter.manifest();
    expect(Object.keys(manifest)).toHaveLength(8);
    const entry = manifest[walkArt('player-mara', 'left')]!;
    expect(entry).toMatchObject({ file: 'wished-art/walks/player-mara-walk-left.png', kind: 'walk', frames: 12, cycleSeconds: 0.6 });
    const strip = await sharp(join(artDir, 'walks', 'player-mara-walk-left.png')).metadata();
    expect([strip.width, strip.height]).toEqual([entry.width, entry.height]);
    expect(entry.width % 12).toBe(0);
    // Three painted views a look (the front is the approved picture), plus one repaint; four looping clips a look.
    expect(asked).toHaveLength(7);
    expect(clips).toHaveLength(8);
    expect(clips.every((c) => c.last === c.first && c.seconds === 8)).toBe(true);
    expect(clips.map((c) => c.prompt).find((p) => p.includes('to the left'))).toBeDefined();
    expect(spent).toHaveLength(15);

    // Everything is kept, so a second start paints nothing.
    const again = new WalkPainter({
      provider: () => images, video: () => video, overBudget: () => false,
      spend: (usd) => spent.push(usd), spendVideo: (usd) => spent.push(usd),
      anchorDir, artDir, shipped: async () => ({}), toFrames: frames,
    });
    await again.start();
    expect(Object.keys(again.manifest())).toHaveLength(8);
    expect(spent).toHaveLength(15);
    expect(JSON.parse(await readFile(join(artDir, 'walks', 'manifest.json'), 'utf8'))).toEqual(manifest);

    // Mara's approved picture is painted again (say, with empty hands): she walks again from it, Ilya keeps his walks.
    await writeFile(join(anchorDir, 'raw', 'player-mara.png'), await picture(300, 300, walker(150, 270)));
    const changed = new WalkPainter({
      provider: () => images, video: () => video, overBudget: () => false,
      spend: (usd) => spent.push(usd), spendVideo: (usd) => spent.push(usd),
      anchorDir, artDir, shipped: async () => ({}), toFrames: frames,
    });
    await changed.start();
    expect(clips).toHaveLength(12);
    expect(clips.slice(8).every((c) => !c.prompt.includes('Ilya'))).toBe(true);
    expect(changed.manifest()[walkArt('player-mara', 'front')]!.file).toContain('?v=');
    expect(changed.manifest()[walkArt('player-ilya', 'front')]!.file).not.toContain('?v=');
  }, 180_000);

  it('paints nothing without a video model, and keeps the views it paid for', async () => {
    const root = await mkdtemp(join(tmpdir(), 'walks-'));
    const anchorDir = join(root, 'anchors'), artDir = join(root, 'art');
    await mkdir(join(anchorDir, 'raw'), { recursive: true });
    for (const look of ['player-mara', 'player-ilya']) await writeFile(join(anchorDir, 'raw', `${look}.png`), await picture(300, 300, walker(150, 280)));
    const images: ImageProvider = { id: 'gemini', model: 'm', generate: async () => ({ mimeType: 'image/png', data: await picture(300, 300, walker(150, 280)) }) };
    const painter = new WalkPainter({
      provider: () => images, video: () => undefined, overBudget: () => false, spend: () => {}, spendVideo: () => {},
      anchorDir, artDir, shipped: async () => ({}), toFrames: frames,
    });
    await painter.start();
    expect(painter.manifest()).toEqual({});
    expect(WALK_DIRECTIONS.length).toBe(4);
  }, 60_000);
});
