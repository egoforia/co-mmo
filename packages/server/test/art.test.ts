import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BUILDING_STYLES, WALK_DIRECTIONS, buildingArtIds, walkArt } from '@co-mmo/shared';
import type { ImageProvider } from '../src/assets/provider.ts';
import type { VideoProvider, VideoRequest } from '../src/assets/video.ts';
import { MemoryPaintQueue } from '../src/paint-queue.ts';
import { account, api, app, start, stop } from './helpers.ts';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const anchorDir = join(repo, 'assets/anchors');

/** A shipped manifest with every building and the scenery a test repaints, so start-up paints nothing. */
async function shippedManifest(dir: string): Promise<string> {
  const entry = (id: string) => [id, { file: `art/${id}.png`, kind: 'prop', width: 128, height: 128 }];
  const ids = [
    ...Object.values(BUILDING_STYLES).flatMap(buildingArtIds),
    'sanctum-rock', 'desert-scarab',
    ...['player-mara', 'player-ilya'].flatMap((look) => WALK_DIRECTIONS.map((d) => walkArt(look, d))),
  ];
  const path = join(dir, 'shipped.json');
  await writeFile(path, JSON.stringify(Object.fromEntries(ids.map(entry))));
  return path;
}

/** A clip's frames: its first picture with two legs striding under it. */
async function frames(first: Buffer): Promise<Buffer[]> {
  const leg = await sharp({ create: { width: 20, height: 100, channels: 3, background: '#604020' } }).png().toBuffer();
  return Promise.all(Array.from({ length: 96 }, (_, i) => {
    const swing = Math.round(110 * Math.sin((2 * Math.PI * i) / 16));
    return sharp(first).composite([{ input: leg, left: 630 + swing, top: 540 }, { input: leg, left: 630 - swing, top: 540 }]).png().toBuffer();
  }));
}

// A narrow stand-in figure on magenta, so the striding legs of the fake clip show.
const figure = (width: number, height: number, x: number, y: number) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#FF00FF"/>` +
    `<rect x="${x - 20}" y="${y - 160}" width="40" height="100" fill="#3060c0"/><circle cx="${x}" cy="${y - 180}" r="22" fill="#e0b090"/><rect x="${x - 14}" y="${y - 60}" width="28" height="60" fill="#604020"/>` +
    `<rect x="${x + 20}" y="${y - 150}" width="30" height="24" fill="#d02020"/></svg>`)).png().toBuffer();

const figurePainter = (): ImageProvider => ({
  id: 'gemini',
  model: 'gemini-3.1-flash-image',
  generate: async () => ({ mimeType: 'image/png', data: await figure(400, 300, 200, 280) }),
});

const video = (): VideoProvider & { asked: VideoRequest[] } => ({
  id: 'gemini',
  model: 'veo-3.1-lite-generate-preview',
  asked: [],
  async generate(request) {
    this.asked.push(request);
    return { mimeType: 'video/mp4', data: request.first.data, seconds: request.seconds };
  },
});

describe('the Art tab', () => {
  it('is the Owner\'s alone', async () => {
    const { base, store } = await start();
    const steward = account(store, 'Wren', 'steward');
    expect((await api(base, '/api/admin/art', steward.token)).status).toBe(403);
  });

  it('lists every building picture, scenery and walker with what painting each costs', async () => {
    const { base, store } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    const { status, body } = await api(base, '/api/admin/art', owner.token);
    expect(status).toBe(200);
    const cottage = body.groups.find((g: any) => g.id === 'building-bramble-cottage');
    expect(cottage.items.find((i: any) => i.id === 'bramble-cottage-exterior')).toMatchObject({ name: 'outside', source: 'shipped', repaintable: true });
    expect(body.groups.find((g: any) => g.id === 'scenery').items.some((i: any) => i.id === 'sanctum-rock')).toBe(true);
    expect(body.walkers.find((w: any) => w.id === 'player-mara')).toMatchObject({ kind: 'player look' });
    expect(body.walkers.find((w: any) => w.id === 'desert-scarab')).toMatchObject({ kind: 'creature', walks: {} });
    expect(body.walkers.find((w: any) => w.id === 'desert-scarab').estimateUsd).toBeGreaterThan(0);
  });

  it('paints a shipped building picture again with the Owner\'s words, logs it, and serves it over the shipped one', async () => {
    const { base, store, painter } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    const asked = await api(base, '/api/admin/art/paint', owner.token, 'POST', { asset: 'bramble-cottage-furniture-bed', note: 'a patchwork quilt' });
    expect(asked.status).toBe(202);
    expect(asked.body.estimateUsd).toBeGreaterThan(0);
    await app!.art.idle();
    expect((painter as any).prompts.at(-1)).toContain('Also: a patchwork quilt');
    const { body: art } = await api(base, '/api/art', owner.token);
    expect(art['bramble-cottage-furniture-bed']).toMatchObject({ redone: expect.any(Number) });
    expect(art['bramble-cottage-furniture-bed'].file).toMatch(/^wished-art\/buildings\/bramble-cottage-furniture-bed\.png\?v=/);
    const { body: jobs } = await api(base, '/api/admin/art/jobs', owner.token);
    expect(jobs.jobs[0]).toMatchObject({ asset: 'bramble-cottage-furniture-bed', status: 'done', source: 'gods-view', label: "Old Bramble's cottage: bed" });
    expect(store.spendThisMonth(Date.now()).length).toBe(1);
  });

  it('paints shipped scenery again at its shipped size, served from the redone folder', async () => {
    const { base, store } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    expect((await api(base, '/api/admin/art/paint', owner.token, 'POST', { asset: 'sanctum-rock' })).status).toBe(202);
    await app!.art.idle();
    const { body: art } = await api(base, '/api/art', owner.token);
    expect(art['sanctum-rock']).toMatchObject({ width: 128, height: 128, redone: expect.any(Number) });
    const served = await fetch(`${base}/${art['sanctum-rock'].file.split('?')[0]}`);
    expect(served.status).toBe(200);
    expect((await api(base, '/api/admin/art/paint', owner.token, 'POST', { asset: 'no-such-thing' })).body.message).toMatch(/no picture/);
  });

  it('makes a creature walk with the chosen body, and paints one direction again on its own', async () => {
    const clips = video();
    const anchors = await tmp();
    await mkdir(join(anchors, 'raw'), { recursive: true });
    await writeFile(join(anchors, 'raw', 'desert-scarab.png'), await figure(300, 300, 150, 280));
    const { base, store, artDir } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir: anchors, painter: figurePainter(), video: clips, frames });
    const owner = account(store, 'Ego', 'owner');
    const made = await api(base, '/api/admin/art/walk', owner.token, 'POST', { walker: 'desert-scarab', body: 'six-legged' });
    expect(made.status).toBe(202);
    await app!.art.idle();
    expect(clips.asked).toHaveLength(4);
    expect(clips.asked[0]!.prompt).toContain('scuttle');
    const { body: art } = await api(base, '/api/art', owner.token);
    for (const d of WALK_DIRECTIONS) expect(art[walkArt('desert-scarab', d)]).toMatchObject({ kind: 'walk', frames: 12 });
    const { body: jobs } = await api(base, '/api/admin/art/jobs', owner.token);
    expect(jobs.jobs.filter((j: any) => j.media === 'clip' && j.status === 'done')).toHaveLength(4);

    const again = await api(base, '/api/admin/art/walk', owner.token, 'POST', { walker: 'desert-scarab', body: 'six-legged', directions: ['left'] });
    expect(again.status).toBe(202);
    await app!.art.idle();
    expect(clips.asked).toHaveLength(5);
    expect(clips.asked[4]!.prompt).toContain('to the left');
    expect(JSON.parse(await readFile(join(artDir, 'walks', 'manifest.json'), 'utf8'))[walkArt('desert-scarab', 'left')].file).toContain('?v=');

    const done = await api(base, '/api/admin/art/walk', owner.token, 'POST', { walker: 'desert-scarab', body: 'six-legged' });
    expect(done.status).toBe(409);
    expect(done.body.message).toMatch(/already walks/);
  }, 60_000);

  it('refuses to paint once the month\'s budget is spent', async () => {
    const { base, store } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    store.recordSpend({ at: Date.now(), usd: 1000, kind: 'image', provider: 'fake', model: 'fake-image', playerId: null });
    const refused = await api(base, '/api/admin/art/paint', owner.token, 'POST', { asset: 'sanctum-rock' });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/budget is spent/);
  });

  it('shows a request held back by the model\'s rate limit as waiting, and paints it after a restart', async () => {
    const shippedArt = await shippedManifest(await tmp());
    const once = () => new MemoryPaintQueue({ limit: () => ({ perMinute: 1, atOnce: 1 }) });
    const first = await start({ shippedArt, anchorDir, paintQueue: once() });
    const owner = account(first.store, 'Ego', 'owner');
    await api(first.base, '/api/admin/art/paint', owner.token, 'POST', { asset: 'sanctum-rock' });
    await api(first.base, '/api/admin/art/paint', owner.token, 'POST', { asset: 'bramble-cottage-furniture-bed' });
    const waiting = await until(async () => {
      const { body } = await api(first.base, '/api/admin/art/jobs', owner.token);
      return body.jobs.find((j: any) => j.status === 'waiting');
    });
    expect(waiting).toMatchObject({ asset: 'bramble-cottage-furniture-bed', reason: expect.stringMatching(/takes 1 a minute/) });

    // Shutting down does not wait out the limit; the request is kept and asked for again.
    await stop();
    const kept = JSON.parse(await readFile(join(first.artDir, 'paint-requests.json'), 'utf8'));
    expect(kept).toEqual([{ kind: 'repaint', asset: 'bramble-cottage-furniture-bed', note: '' }]);
    const again = await start({ shippedArt, anchorDir, store: first.store, artDir: first.artDir, paintQueue: once() });
    await until(async () => (await api(again.base, '/api/art', owner.token)).body['bramble-cottage-furniture-bed']?.redone);
    await app!.art.idle();
  });
});

/** Asks until the answer is truthy, for up to five seconds. */
async function until<T>(ask: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const answer = await ask();
    if (answer) return answer;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('It never happened.');
}

function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'co-mmo-shipped-'));
}
