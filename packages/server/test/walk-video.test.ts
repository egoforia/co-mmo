import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { GeminiVideoProvider, videoUsd } from '../src/assets/video.ts';
import { VIDEO_FRAME, findCycle, gearPlacement, soleFigure, startFrame, walkFromFrames } from '../src/assets/walk-video.ts';

// Test pictures: simple shapes on magenta, standing in for painted figures.
const MAGENTA = '#FF00FF';
const picture = (width: number, height: number, shapes: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${MAGENTA}"/>${shapes}</svg>`)).png().toBuffer();
/** A walker whose legs are `step` pixels apart, with a red flag on its right so it has a facing. */
const walker = (x: number, y: number, step = 0) =>
  `<rect x="${x - 20}" y="${y - 160}" width="40" height="100" fill="#3060c0"/><circle cx="${x}" cy="${y - 180}" r="22" fill="#e0b090"/>` +
  `<rect x="${x + 20}" y="${y - 150}" width="30" height="24" fill="#d02020"/>` +
  `<rect x="${x - 14 - step}" y="${y - 60}" width="12" height="60" fill="#604020"/><rect x="${x + 2 + step}" y="${y - 60}" width="12" height="60" fill="#604020"/>`;

describe('video walks', () => {
  it('names each carried item in front of or behind the body, by which way the walker faces', () => {
    const staff = [{ item: 'staff', side: 'right' as const }];
    expect(gearPlacement(staff, 'right')).toContain('staff is on the far side, BEHIND');
    expect(gearPlacement(staff, 'left')).toContain('staff is on the near side, IN FRONT');
    expect(gearPlacement(staff, 'front')).toContain("viewer's left");
    expect(gearPlacement([], 'front')).toBe('');
  });

  it('keeps the one figure, drops a neighbour cut off at the edge, and refuses two whole figures', async () => {
    // A bit of a neighbour's hat at the left edge, close enough to touch the figure's reach.
    const crumb = '<rect x="0" y="40" width="30" height="20" fill="#3a7a3a"/>';
    const one = await soleFigure(await picture(300, 260, walker(80, 250) + crumb));
    const { width } = await sharp(one).metadata();
    // The figure and its flag are 70 pixels wide; the crumb at the edge would make it 130.
    expect(width).toBeLessThan(80);
    await expect(soleFigure(await picture(400, 260, walker(80, 250) + walker(300, 250)))).rejects.toThrow('2 figures instead of one');
  });

  it('stands the figure in the middle of a video-sized magenta frame', async () => {
    const frame = await startFrame(await soleFigure(await picture(300, 260, walker(150, 250))));
    const meta = await sharp(frame).metadata();
    expect([meta.width, meta.height]).toEqual([VIDEO_FRAME.width, VIDEO_FRAME.height]);
    const { data } = await sharp(frame).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [...data.subarray((y * VIDEO_FRAME.width + x) * 3, (y * VIDEO_FRAME.width + x) * 3 + 3)];
    expect(at(10, 10)).toEqual([255, 0, 255]);
    expect(at(640, 500)).not.toEqual([255, 0, 255]);
  });

  it('finds how long one cycle lasts and spreads the kept frames through it', () => {
    // A clip whose pictures repeat every 20 frames, after a still second at each end.
    const pose = (i: number) => (i < 24 || i >= 168 ? -1 : (i - 24) % 20);
    const difference = (a: number, b: number) => (pose(a) === pose(b) ? 0 : 1 + Math.abs(pose(a) - pose(b)) / 20);
    const cycle = findCycle(192, difference, 12);
    expect(cycle.period).toBe(20);
    expect(cycle.picks).toHaveLength(12);
    expect(cycle.picks.at(-1)! - cycle.picks[0]!).toBeLessThan(20);
    expect(new Set(cycle.picks.map(pose)).size).toBe(12);
  });

  it('cuts one cycle of walk frames out of a clip', async () => {
    const strideOf = (i: number) => Math.round(10 * Math.sin((2 * Math.PI * i) / 16));
    const frames = await Promise.all(Array.from({ length: 96 }, (_, i) => picture(1280, 720, walker(640, 640, strideOf(i)))));
    const { figures, cycle } = await walkFromFrames(frames, 8);
    expect(cycle.period % 16).toBe(0);
    expect(figures).toHaveLength(8);
    // Spread through the cycle, so the legs are apart by different amounts.
    expect(new Set(figures.map((f) => f.toString('base64'))).size).toBeGreaterThan(4);
  });

  it('starts a Veo job, waits for it and downloads the clip', async () => {
    const calls: { url: string; body?: any }[] = [];
    let polls = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith(':predictLongRunning')) return Response.json({ name: 'operations/abc' });
      if (url.endsWith('operations/abc')) return Response.json(++polls < 2 ? { name: 'operations/abc' } : { name: 'operations/abc', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files.example/clip' } }] } } });
      return new Response(Buffer.from('mp4 bytes'));
    }) as typeof fetch;
    const provider = new GeminiVideoProvider('key', 'veo-3.1-lite-generate-preview', fake, async () => {});
    const first = { mimeType: 'image/png', data: Buffer.from('png') };
    const clip = await provider.generate({ prompt: 'walk', first, last: first, seconds: 8, resolution: '1080p' });
    expect(clip.data.toString()).toBe('mp4 bytes');
    expect(calls[0]!.body.instances[0].lastFrame.bytesBase64Encoded).toBe(Buffer.from('png').toString('base64'));
    expect(calls[0]!.body.parameters).toEqual({ aspectRatio: '16:9', resolution: '1080p', durationSeconds: 8 });
    expect(videoUsd(provider.model, clip)).toBeCloseTo(0.64);
  });

  it('says plainly when Veo turns a clip down', async () => {
    const fake = (async (url: string) =>
      url.endsWith(':predictLongRunning') ? Response.json({ error: { message: 'Your use case is currently not supported.' } }, { status: 400 }) : Response.json({})) as typeof fetch;
    const provider = new GeminiVideoProvider('key', undefined, fake, async () => {});
    const first = { mimeType: 'image/png', data: Buffer.from('png') };
    await expect(provider.generate({ prompt: 'walk', first, seconds: 4 })).rejects.toThrow('not supported');
  });
});
