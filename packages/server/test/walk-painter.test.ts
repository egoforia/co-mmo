import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ISO_WAYS, walkArt, walkStandArt } from '@co-mmo/shared';
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
  it('keeps walk frames where they stood in the clip, and cuts walks from before that again for free', async () => {
    const root = await mkdtemp(join(tmpdir(), 'walks-'));
    const anchorDir = join(root, 'anchors'), artDir = join(root, 'art');
    await mkdir(join(anchorDir, 'raw'), { recursive: true });
    for (const look of ['player-mara', 'player-ilya']) await writeFile(join(anchorDir, 'raw', `${look}.png`), await picture(300, 300, walker(150, 280)));
    const images: ImageProvider = { id: 'gemini', model: 'gemini-3.1-flash-image', generate: async () => ({ mimeType: 'image/png', data: await picture(400, 300, walker(120, 280)) }) };
    let clips = 0;
    const video: VideoProvider = { id: 'gemini', model: 'veo-3.1-lite-generate-preview', generate: async (r) => (clips++, { mimeType: 'video/mp4', data: r.first.data, seconds: r.seconds }) };
    const options = { provider: () => images, video: () => video, overBudget: () => false, spend: () => {}, spendVideo: () => {}, anchorDir, artDir, shipped: async () => ({}), toFrames: frames };
    const first = new WalkPainter(options);
    await first.load();
    const mara = first.anchorWalker('player-mara');
    await first.paintView(mara, 'front-left', undefined);
    await first.makeClip(mara, 'front-left', undefined);
    const id = walkArt('player-mara', 'front-left');
    const names = JSON.parse(await readFile(join(artDir, 'walks', 'frames', `${id}.json`), 'utf8')) as string[];
    const sizes = async () => Promise.all(names.map(async (n) => { const m = await sharp(join(artDir, 'walks', 'frames', n)).metadata(); return `${m.width}x${m.height}`; }));
    // Every frame shares one canvas, so the striding legs keep their places instead of being centred one by one.
    expect(new Set(await sizes()).size).toBe(1);

    // A walk cut the old way (each frame trimmed on its own) is cut again from its clip at the next start, with no model asked.
    for (const n of names) {
      const path = join(artDir, 'walks', 'frames', n);
      await writeFile(path, await sharp(await readFile(path)).trim().png().toBuffer());
    }
    expect(new Set(await sizes()).size).toBeGreaterThan(1);
    const placed = JSON.parse(await readFile(join(artDir, 'walks', 'placed.json'), 'utf8')) as string[];
    await writeFile(join(artDir, 'walks', 'placed.json'), JSON.stringify(placed.filter((p) => p !== id)));
    const before = clips;
    const again = new WalkPainter(options);
    await again.start();
    expect(clips).toBe(before);
    expect(new Set(await sizes()).size).toBe(1);
    expect(again.manifest()[id]).toMatchObject({ redone: expect.any(Number) });
  }, 180_000);

  it('paints a look standing in each isometric way when asked, walks it on video, and keeps one cycle of 12 frames per way', async () => {
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
    const told: string[][] = [];
    const painter = new WalkPainter({
      provider: () => images, video: () => video, overBudget: () => false,
      spend: (usd) => spent.push(usd), spendVideo: (usd) => spent.push(usd),
      anchorDir, artDir, shipped: async () => ({}), toFrames: frames,
      onPainted: (ids) => told.push(ids),
    });
    await painter.load();
    for (const look of ['player-mara', 'player-ilya']) {
      const w = painter.anchorWalker(look);
      for (const way of ISO_WAYS) {
        await painter.paintView(w, way, undefined);
        await painter.makeClip(w, way, undefined);
      }
    }
    // Open games are told about each look's walks once they are on disk, and each standing picture as it is painted.
    const walksTold = told.filter((ids) => ids[0]!.includes('-walk-'));
    expect(walksTold.at(-1)).toEqual(ISO_WAYS.map((d) => walkArt('player-ilya', d)));
    expect(told.filter((ids) => ids[0]!.includes('-stand-')).flat()).toEqual(['player-mara', 'player-ilya'].flatMap((look) => ISO_WAYS.map((d) => walkStandArt(look, d))));
    expect(Object.keys(await painter.standingManifest())).toEqual(expect.arrayContaining([walkStandArt('player-mara', 'front-left')]));

    const manifest = painter.manifest();
    expect(Object.keys(manifest)).toHaveLength(8);
    const entry = manifest[walkArt('player-mara', 'front-left')]!;
    expect(entry).toMatchObject({ file: expect.stringMatching(/^wished-art\/walks\/player-mara-walk-front-left\.png/), kind: 'walk', frames: 12, cycleSeconds: 0.6 });
    const strip = await sharp(join(artDir, 'walks', 'player-mara-walk-front-left.png')).metadata();
    expect([strip.width, strip.height]).toEqual([entry.width, entry.height]);
    expect(entry.width % 12).toBe(0);
    // Four painted views a look, plus one repaint; four looping clips a look.
    expect(asked).toHaveLength(9);
    expect(clips).toHaveLength(8);
    expect(clips.every((c) => c.last === c.first && c.seconds === 8)).toBe(true);
    expect(clips.map((c) => c.prompt).find((p) => p.includes('LOWER-LEFT corner'))).toBeDefined();
    expect(spent).toHaveLength(17);

    // Everything is kept, and start-up paints nothing, even when an approved picture changed:
    // walkers are painted from the Art tab.
    await writeFile(join(anchorDir, 'raw', 'player-mara.png'), await picture(300, 300, walker(150, 270)));
    const again = new WalkPainter({
      provider: () => images, video: () => video, overBudget: () => false,
      spend: (usd) => spent.push(usd), spendVideo: (usd) => spent.push(usd),
      anchorDir, artDir, shipped: async () => ({}), toFrames: frames,
    });
    await again.start();
    expect(Object.keys(again.manifest())).toHaveLength(8);
    expect(spent).toHaveLength(17);
    expect(clips).toHaveLength(8);
    expect(JSON.parse(await readFile(join(artDir, 'walks', 'manifest.json'), 'utf8'))).toEqual(manifest);
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
    await painter.load();
    const mara = painter.anchorWalker('player-mara');
    expect(await painter.paintView(mara, 'front-left', undefined)).toBe(true);
    expect(await painter.makeClip(mara, 'front-left', undefined)).toBe(false);
    expect(painter.manifest()).toEqual({});
    expect(Object.keys(await painter.standingManifest())).toEqual([walkStandArt('player-mara', 'front-left')]);
  }, 60_000);
});
