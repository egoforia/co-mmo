import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BUILDING_STYLES, WALK_DIRECTIONS, buildingArtIds, walkArt, walkStandArt } from '@co-mmo/shared';
import { ANCHORS } from '../src/assets/anchors.ts';
import type { ImageProvider, ImageRequest } from '../src/assets/provider.ts';
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
    const item = (id: string) => body.items.find((i: any) => i.id === id);
    expect(item('bramble-cottage-exterior')).toMatchObject({ name: 'outside', source: 'shipped', repaintable: true, place: { tab: 'biomes', page: 'Whispering Woods', section: "Old Bramble's cottage" } });
    expect(item('bramble-cottage-exterior').recipe.steps[0]).toMatchObject({ media: 'picture', prompt: expect.stringContaining('layout sketch') });
    expect(item('sanctum-rock').place).toEqual({ tab: 'biomes', page: 'Sanctum', section: 'Scenery' });
    expect(item('player-ilya').place).toEqual({ tab: 'characters', page: 'Ilya' });
    expect(item('desert-scarab').place).toEqual({ tab: 'monsters', page: 'Sun Scarab' });
    expect(item('item-tonic').place).toEqual({ tab: 'items', page: 'Consumables' });
    expect(item('item-wooden-sword').place).toEqual({ tab: 'items', page: 'Weapons' });
    expect(body.groups.find((g: any) => g.id === "biomes/Whispering Woods/Old Bramble's cottage").items.length).toBeGreaterThan(3);
    expect(body.walkers.find((w: any) => w.id === 'player-mara')).toMatchObject({ kind: 'player look', place: { tab: 'characters', page: 'Mara' } });
    expect(body.walkers.find((w: any) => w.id === 'desert-scarab')).toMatchObject({ kind: 'creature', walks: {} });
    expect(body.walkers.find((w: any) => w.id === 'desert-scarab').estimateUsd).toBeGreaterThan(0);
  });

  it('paints a shipped building picture again with the Owner\'s words, logs it, and serves it over the shipped one', async () => {
    const { base, store, painter } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    const asked = await ask(base, owner.token, 'paint', { asset: 'bramble-cottage-furniture-bed', note: 'a patchwork quilt' });
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

  it('keeps every earlier version, puts any of them back, and can go back to the shipped picture', async () => {
    const { base, store, artDir } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    const paint = async () => {
      expect((await ask(base, owner.token, 'paint', { asset: 'sanctum-rock' })).status).toBe(202);
      await app!.art.idle();
    };
    await paint();
    const first = await readFile(join(artDir, 'redone', 'sanctum-rock.png'));
    await paint();
    const item = async () => (await api(base, '/api/admin/art', owner.token)).body.items.find((i: any) => i.id === 'sanctum-rock');
    const after = await item();
    expect(after).toMatchObject({ source: 'redone', shippedBack: true, versions: [{ id: expect.any(String), url: expect.stringMatching(/^\/wished-art\/history\/sanctum-rock\//) }] });
    // Each version keeps what made it: the prompt, the model and the pictures sent along.
    expect(after.recipe.steps[0]).toMatchObject({ media: 'picture', model: 'fake-image', pictures: expect.arrayContaining([expect.objectContaining({ name: 'Mossy white stone' })]) });
    expect(after.versions[0].recipe.steps[0]).toMatchObject({ media: 'picture', prompt: after.recipe.steps[0].prompt });
    expect((await fetch(`${base}${after.recipe.steps[0].pictures[0].url}`)).status).toBe(200);
    expect(after.shipped).toMatchObject({ url: '/art/sanctum-rock.png', recipe: { steps: [{ model: 'gemini-2.5-flash-image' }] } });
    expect((await fetch(`${base}${after.versions[0].url}`)).status).toBe(200);

    // Putting the first back keeps the second as an earlier version too.
    expect((await api(base, '/api/admin/art/restore', owner.token, 'POST', { asset: 'sanctum-rock', version: after.versions[0].id })).status).toBe(200);
    expect(Buffer.compare(await readFile(join(artDir, 'redone', 'sanctum-rock.png')), first)).toBe(0);
    expect((await item()).versions).toHaveLength(2);
    expect((await api(base, '/api/admin/art/restore', owner.token, 'POST', { asset: 'sanctum-rock', version: 'nope' })).body.message).toMatch(/not there/);

    expect((await api(base, '/api/admin/art/restore', owner.token, 'POST', { asset: 'sanctum-rock', version: 'shipped' })).status).toBe(200);
    expect(await item()).toMatchObject({ source: 'shipped' });
    const { body: art } = await api(base, '/api/art', owner.token);
    expect(art['sanctum-rock']).toBeUndefined();
  });

  it('paints a normal map for a picture from the picture itself, serves it beside it, and goes back to the worked-out one', async () => {
    const { base, store, painter, artDir } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    expect((await ask(base, owner.token, 'paint', { asset: 'sanctum-rock' })).status).toBe(202);
    await app!.art.idle();
    const item = async () => (await api(base, '/api/admin/art', owner.token)).body.items.find((i: any) => i.id === 'sanctum-rock');
    expect(await item()).toMatchObject({ normalPaintable: true });
    expect((await item()).normalMap).toBeUndefined();

    // The review shows the usual words and the picture sent along; the Owner's own words replace them.
    const usual = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'normal', asset: 'sanctum-rock' });
    expect(usual.body.title).toBe('Paint a normal map for Mossy white stone');
    expect(usual.body.parts[0].recipe.steps[0]).toMatchObject({ prompt: expect.stringContaining('normal map'), pictures: [{ name: 'Mossy white stone' }] });
    const own = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'normal', asset: 'sanctum-rock', prompt: 'A normal map of this stone, very bumpy.' });
    expect(own.body.parts[0].recipe.steps[0].prompt).toBe('A normal map of this stone, very bumpy.');

    const painted = await ask(base, owner.token, 'normal', { asset: 'sanctum-rock', prompt: 'A normal map of this stone, very bumpy.' });
    expect(painted.status).toBe(202);
    await app!.art.idle();
    expect((painter as any).prompts.at(-1)).toBe('A normal map of this stone, very bumpy.');
    const { body: art } = await api(base, '/api/art', owner.token);
    expect(art['sanctum-rock-normal']).toMatchObject({ kind: 'normal', width: 128, height: 128, redone: expect.any(Number) });
    // Exactly the picture's size, so each pixel of the map lies on its pixel.
    const map = await sharp(await readFile(join(artDir, 'redone', 'sanctum-rock-normal.png'))).metadata();
    expect([map.width, map.height]).toEqual([128, 128]);
    expect((await item()).normalMap).toMatch(/^\/wished-art\/redone\/sanctum-rock-normal\.png\?v=/);

    expect((await api(base, '/api/admin/art/normal-drop', owner.token, 'POST', { asset: 'sanctum-rock' })).status).toBe(200);
    expect((await api(base, '/api/art', owner.token)).body['sanctum-rock-normal']).toBeUndefined();
    expect((await api(base, '/api/admin/art/normal-drop', owner.token, 'POST', { asset: 'sanctum-rock' })).body.message).toMatch(/no painted normal map/);
    expect((await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'normal', asset: 'no-such-thing' })).body.message).toMatch(/not part of the game/);
  });

  it('paints a whole group again, one request per picture', async () => {
    const { base, store, painter } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    const asked = await ask(base, owner.token, 'paint-group', { group: "biomes/Whispering Woods/Old Bramble's cottage" });
    expect(asked.status).toBe(202);
    expect(asked.body.count).toBeGreaterThan(3);
    expect(asked.body.estimateUsd).toBeGreaterThan(0);
    await app!.art.idle();
    expect((painter as any).calls).toBe(asked.body.count);
    expect((await ask(base, owner.token, 'paint-group', { group: 'nothing' })).body.message).toMatch(/no group/);
  });

  it('paints shipped scenery again at its shipped size, served from the redone folder', async () => {
    const { base, store } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    expect((await ask(base, owner.token, 'paint', { asset: 'sanctum-rock' })).status).toBe(202);
    await app!.art.idle();
    const { body: art } = await api(base, '/api/art', owner.token);
    expect(art['sanctum-rock']).toMatchObject({ width: 128, height: 128, redone: expect.any(Number) });
    const served = await fetch(`${base}/${art['sanctum-rock'].file.split('?')[0]}`);
    expect(served.status).toBe(200);
    expect((await ask(base, owner.token, 'paint', { asset: 'no-such-thing' })).body.message).toMatch(/no picture/);
  });

  it('makes a creature walk with the chosen body, and paints one direction again on its own', async () => {
    const clips = video();
    const anchors = await tmp();
    await mkdir(join(anchors, 'raw'), { recursive: true });
    await writeFile(join(anchors, 'raw', 'desert-scarab.png'), await figure(300, 300, 150, 280));
    const { base, store, artDir } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir: anchors, painter: figurePainter(), video: clips, frames });
    const owner = account(store, 'Ego', 'owner');
    const made = await ask(base, owner.token, 'walk', { walker: 'desert-scarab', body: 'six-legged' });
    expect(made.status).toBe(202);
    await app!.art.idle();
    expect(clips.asked).toHaveLength(4);
    expect(clips.asked[0]!.prompt).toContain('scuttle');
    const { body: art } = await api(base, '/api/art', owner.token);
    for (const d of WALK_DIRECTIONS) expect(art[walkArt('desert-scarab', d)]).toMatchObject({ kind: 'walk', frames: 12 });
    const { body: jobs } = await api(base, '/api/admin/art/jobs', owner.token);
    expect(jobs.jobs.filter((j: any) => j.media === 'clip' && j.status === 'done')).toHaveLength(4);

    // Before painting the left walk again, the Owner sees the left standing picture it starts from and the prompt.
    const review = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'walk', walker: 'desert-scarab', body: 'six-legged', directions: ['left'] });
    expect(review.status).toBe(200);
    const [clip] = review.body.parts[0].recipe.steps;
    expect(review.body.parts[0].recipe.steps).toHaveLength(1);
    expect(clip).toMatchObject({ media: 'clip', model: clips.model, prompt: expect.stringContaining('to the left'), pictures: [{ name: 'First and last frame: Sun Scarab standing, facing left', url: expect.stringMatching(/^\/wished-art\/recipes\/pictures\//) }] });
    expect((await fetch(`${base}${clip.pictures[0].url}`)).status).toBe(200);
    // With its standing picture painted again too, that picture comes first and the clip starts from it.
    const both = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'walk', walker: 'desert-scarab', body: 'six-legged', directions: ['left'], views: true });
    expect(both.body.parts[0].recipe.steps.map((x: any) => x.media)).toEqual(['picture', 'clip']);
    expect(both.body.parts[0].recipe.steps[0]).toMatchObject({ prompt: expect.stringContaining('facing left'), pictures: [{ name: "Sun Scarab's approved picture, on magenta" }] });
    expect(both.body.parts[0].recipe.steps[1].pictures[0]).toMatchObject({ later: true });
    expect(both.body.fingerprint).not.toBe(review.body.fingerprint);
    // An approval holds only for what was reviewed.
    const stale = await api(base, '/api/admin/art/walk', owner.token, 'POST', { walker: 'desert-scarab', body: 'six-legged', directions: ['left'], approved: both.body.fingerprint });
    expect(stale.body.message).toMatch(/changed since you reviewed/);
    expect(clips.asked).toHaveLength(4);

    const strip = join(artDir, 'walks', `${walkArt('desert-scarab', 'left')}.png`);
    const firstLeft = await readFile(strip);
    const again = await api(base, '/api/admin/art/walk', owner.token, 'POST', { walker: 'desert-scarab', body: 'six-legged', directions: ['left'], approved: review.body.fingerprint });
    expect(again.status).toBe(202);
    await app!.art.idle();
    expect(clips.asked).toHaveLength(5);
    expect(clips.asked[4]!.prompt).toContain('to the left');
    expect(JSON.parse(await readFile(join(artDir, 'walks', 'manifest.json'), 'utf8'))[walkArt('desert-scarab', 'left')].file).toContain('?v=');

    // The first left walk is kept with what made it, and goes back for free.
    const left = async () => (await api(base, '/api/admin/art', owner.token)).body.walkers.find((w: any) => w.id === 'desert-scarab').walks.left;
    const now = await left();
    expect(now.recipe.steps.at(-1)).toMatchObject({ media: 'clip', prompt: expect.stringContaining('to the left') });
    expect(now.versions).toHaveLength(1);
    expect(now.versions[0]).toMatchObject({ frames: 12 });
    expect(now.versions[0].recipe.steps.map((x: any) => x.media)).toEqual(['picture', 'clip']);
    expect((await fetch(`${base}${now.versions[0].url}`)).status).toBe(200);
    expect((await api(base, '/api/admin/art/restore-walk', owner.token, 'POST', { walker: 'desert-scarab', direction: 'left', version: now.versions[0].id })).status).toBe(200);
    expect(clips.asked).toHaveLength(5);
    expect((await left()).versions).toHaveLength(2);
    expect(Buffer.compare(await readFile(strip), firstLeft)).toBe(0);

    const done = await ask(base, owner.token, 'walk', { walker: 'desert-scarab', body: 'six-legged' });
    expect(done.status).toBe(409);
    expect(done.body.message).toMatch(/already walks/);
  }, 60_000);

  it('paints a standing picture on its own with the Owner\'s prompt, then makes its clip from it', async () => {
    const clips = video();
    const painted: string[] = [];
    const base0 = figurePainter();
    const painter: ImageProvider = { ...base0, generate: (r) => (painted.push(r.prompt), base0.generate(r)) };
    const anchors = await tmp();
    await mkdir(join(anchors, 'raw'), { recursive: true });
    await writeFile(join(anchors, 'raw', 'desert-scarab.png'), await figure(300, 300, 150, 280));
    const { base, store, artDir } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir: anchors, painter, video: clips, frames });
    const owner = account(store, 'Ego', 'owner');
    expect((await ask(base, owner.token, 'walk', { walker: 'desert-scarab', body: 'six-legged' })).status).toBe(202);
    await app!.art.idle();
    expect(clips.asked).toHaveLength(4);
    const scarab = async () => (await api(base, '/api/admin/art', owner.token)).body.walkers.find((w: any) => w.id === 'desert-scarab');
    const before = (await scarab()).standing.left;
    expect(before).toMatchObject({ approved: false, url: expect.stringMatching(/^\/wished-art\/walks\/views\/desert-scarab-left\.png/), versions: [] });
    expect((await scarab()).standing.front).toMatchObject({ approved: true });

    // The standing picture alone, with the Owner's own words: no clip is made.
    const view = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'view', walker: 'desert-scarab', direction: 'left', prompt: 'The scarab facing left, shell gleaming.' });
    expect(view.status).toBe(200);
    expect(view.body.parts[0].recipe.steps).toHaveLength(1);
    expect(view.body.parts[0].recipe.steps[0]).toMatchObject({ media: 'picture', prompt: 'The scarab facing left, shell gleaming.', pictures: [{ name: "Sun Scarab's approved picture, on magenta" }] });
    // The picture sent is the scarab itself, so the note against copying the pictures' subjects is left out.
    expect(view.body.parts[0].recipe.steps[0].note).toBeUndefined();
    expect(view.body.parts[0].recipe.steps[0].settings).toContain('the pictures show the subject itself, not only the style');
    const usual = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'view', walker: 'desert-scarab', direction: 'left' });
    expect(usual.body.parts[0].recipe.steps[0].prompt).toContain('facing left');
    // The approval is for those words only.
    const other = await api(base, '/api/admin/art/view', owner.token, 'POST', { walker: 'desert-scarab', direction: 'left', approved: view.body.fingerprint });
    expect(other.status).toBe(409);
    const painting = await api(base, '/api/admin/art/view', owner.token, 'POST', { walker: 'desert-scarab', direction: 'left', prompt: 'The scarab facing left, shell gleaming.', approved: view.body.fingerprint });
    expect(painting.status).toBe(202);
    await app!.art.idle();
    expect(painted.at(-1)).toBe('The scarab facing left, shell gleaming.');
    expect(clips.asked).toHaveLength(4);
    const after = (await scarab()).standing.left;
    expect(after.recipe.steps[0].prompt).toBe('The scarab facing left, shell gleaming.');
    expect(after.versions).toHaveLength(1);
    expect((await fetch(`${base}${after.url}`)).status).toBe(200);

    // Another direction can be painted from several pictures: the approved one and the new left one.
    const two = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'view', walker: 'desert-scarab', direction: 'back', from: ['approved', 'left'] });
    expect(two.status).toBe(200);
    expect(two.body.parts[0].recipe.steps[0].pictures.map((p: any) => p.name)).toEqual(["Sun Scarab's approved picture, on magenta", 'Sun Scarab standing, facing left, on magenta']);
    expect(two.body.parts[0].recipe.steps[0].prompt).toContain('2 reference images');
    expect((await api(base, '/api/admin/art/view', owner.token, 'POST', { walker: 'desert-scarab', direction: 'back', approved: two.body.fingerprint })).status).toBe(409);
    expect((await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'view', walker: 'desert-scarab', direction: 'back', from: ['right'] })).status).toBe(200);

    // The clip starts and ends on that new picture, with its own edited words.
    const clip = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'clip', walker: 'desert-scarab', body: 'six-legged', direction: 'left', prompt: 'It scuttles left, slowly.' });
    expect(clip.status).toBe(200);
    const step = clip.body.parts[0].recipe.steps[0];
    expect(step).toMatchObject({ media: 'clip', prompt: 'It scuttles left, slowly.', pictures: [{ name: 'First and last frame: Sun Scarab standing, facing left', url: expect.any(String) }] });
    expect((await api(base, '/api/admin/art/clip', owner.token, 'POST', { walker: 'desert-scarab', body: 'six-legged', direction: 'left', prompt: 'It scuttles left, slowly.', approved: clip.body.fingerprint })).status).toBe(202);
    await app!.art.idle();
    expect(clips.asked).toHaveLength(5);
    expect(clips.asked[4]!.prompt).toBe('It scuttles left, slowly.');
    const walked = (await scarab()).walks.left;
    expect(walked.recipe.steps.map((x: any) => x.prompt)).toEqual(['The scarab facing left, shell gleaming.', 'It scuttles left, slowly.']);
    expect(walked.versions).toHaveLength(1);
    expect(JSON.parse(await readFile(join(artDir, 'walks', 'manifest.json'), 'utf8'))[walkArt('desert-scarab', 'left')].redone).toBeGreaterThan(0);

    // The earlier standing picture goes back for free, and the walk stays as it is.
    expect((await api(base, '/api/admin/art/restore-view', owner.token, 'POST', { walker: 'desert-scarab', direction: 'left', version: after.versions[0].id })).status).toBe(200);
    const restored = (await scarab()).standing.left;
    expect(restored.versions).toHaveLength(2);
    expect(restored.recipe.steps[0].prompt).toContain('facing left');
    expect(clips.asked).toHaveLength(5);
  }, 60_000);

  it('uses each way\'s walk as soon as it is made, and serves standing pictures for the ways that do not walk yet', async () => {
    const clips = video();
    const anchors = await tmp();
    await mkdir(join(anchors, 'raw'), { recursive: true });
    await writeFile(join(anchors, 'raw', 'desert-scarab.png'), await figure(300, 300, 150, 280));
    const { base, store, artDir } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir: anchors, painter: figurePainter(), video: clips, frames });
    const owner = account(store, 'Ego', 'owner');
    const view = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'view', walker: 'desert-scarab', direction: 'left' });
    expect((await api(base, '/api/admin/art/view', owner.token, 'POST', { walker: 'desert-scarab', direction: 'left', approved: view.body.fingerprint })).status).toBe(202);
    await app!.art.idle();
    // Standing facing left, with no walk anywhere yet: the game is given the standing picture.
    let art = (await api(base, '/api/art', owner.token)).body;
    expect(art[walkStandArt('desert-scarab', 'left')]).toMatchObject({ kind: 'stand', file: expect.stringMatching(/^wished-art\/walks\/views\/desert-scarab-left\.png\?v=/) });
    expect(art[walkArt('desert-scarab', 'left')]).toBeUndefined();
    expect((await fetch(`${base}/${art[walkStandArt('desert-scarab', 'left')].file}`)).status).toBe(200);

    // One clip, and that way walks at once; the others stand.
    const clip = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'clip', walker: 'desert-scarab', body: 'six-legged', direction: 'left' });
    expect((await api(base, '/api/admin/art/clip', owner.token, 'POST', { walker: 'desert-scarab', body: 'six-legged', direction: 'left', approved: clip.body.fingerprint })).status).toBe(202);
    await app!.art.idle();
    art = (await api(base, '/api/art', owner.token)).body;
    expect(art[walkArt('desert-scarab', 'left')]).toMatchObject({ kind: 'walk', frames: expect.any(Number) });
    expect(art[walkArt('desert-scarab', 'right')]).toBeUndefined();
    expect(Object.keys(JSON.parse(await readFile(join(artDir, 'walks', 'manifest.json'), 'utf8')))).toEqual([walkArt('desert-scarab', 'left')]);
  }, 60_000);

  it('paints the isometric ways as standing pictures only, from the approved picture and the ways beside them', async () => {
    const clips = video();
    const painted: string[] = [];
    const base0 = figurePainter();
    const painter: ImageProvider = { ...base0, generate: (r) => (painted.push(r.prompt), base0.generate(r)) };
    const anchors = await tmp();
    await mkdir(join(anchors, 'raw'), { recursive: true });
    await writeFile(join(anchors, 'raw', 'desert-scarab.png'), await figure(300, 300, 150, 280));
    const { base, store } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir: anchors, painter, video: clips, frames });
    const owner = account(store, 'Ego', 'owner');

    // One way on its own: turned halfway, and served as a standing picture, never walked.
    const one = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'view', walker: 'desert-scarab', direction: 'front-left' });
    expect(one.status).toBe(200);
    expect(one.body.title).toBe('Paint Sun Scarab standing, facing towards us and to the left');
    expect(one.body.parts[0].recipe.steps[0].prompt).toContain('turned halfway to the left');
    expect((await api(base, '/api/admin/art/view', owner.token, 'POST', { walker: 'desert-scarab', direction: 'front-left', approved: one.body.fingerprint })).status).toBe(202);
    await app!.art.idle();
    const art = (await api(base, '/api/art', owner.token)).body;
    expect(art[walkStandArt('desert-scarab', 'front-left')]).toMatchObject({ kind: 'stand', file: expect.stringMatching(/^wished-art\/walks\/views\/desert-scarab-front-left\.png\?v=/) });
    expect(art[walkStandArt('desert-scarab', 'left')]).toBeUndefined();
    expect((await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'clip', walker: 'desert-scarab', body: 'six-legged', direction: 'front-left' })).body.message).toBeTruthy();

    // The rest in one go, each painted from the approved picture and any way beside it already painted.
    expect((await ask(base, owner.token, 'view', { walker: 'desert-scarab', direction: 'left' })).status).toBe(202);
    await app!.art.idle();
    const rest = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'ways', walker: 'desert-scarab' });
    expect(rest.status).toBe(200);
    expect(rest.body.title).toBe('Paint Sun Scarab standing in 3 more isometric ways');
    const steps = rest.body.parts[0].recipe.steps;
    expect(steps).toHaveLength(3);
    expect(steps[1].pictures.map((p: any) => p.name)).toEqual(["Sun Scarab's approved picture, on magenta", 'Sun Scarab standing, facing left, on magenta']);
    expect(steps[0].pictures).toHaveLength(1);
    const asked = painted.length;
    expect((await api(base, '/api/admin/art/ways', owner.token, 'POST', { walker: 'desert-scarab', approved: rest.body.fingerprint })).status).toBe(202);
    await app!.art.idle();
    expect(painted).toHaveLength(asked + 3);
    expect(clips.asked).toHaveLength(0);
    const scarab = (await api(base, '/api/admin/art', owner.token)).body.walkers.find((w: any) => w.id === 'desert-scarab');
    for (const way of ['front-left', 'front-right', 'back-left', 'back-right']) expect(scarab.standing[way].url).toBeTruthy();
    expect((await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'ways', walker: 'desert-scarab' })).body.message).toMatch(/already has a standing picture for every isometric way/);
  }, 60_000);

  it('shows every walker\'s missing isometric ways in one review, a part per walker', async () => {
    // Every shipped walker's approved picture, so each can be painted from it.
    const anchors = await tmp();
    await mkdir(join(anchors, 'raw'), { recursive: true });
    for (const a of ANCHORS.filter((a) => a.kind === 'player' || a.kind === 'npc' || a.kind === 'monster')) await writeFile(join(anchors, 'raw', `${a.id}.png`), await figure(300, 300, 150, 280));
    const { base, store } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir: anchors, painter: figurePainter(), video: video(), frames });
    const owner = account(store, 'Ego', 'owner');
    const all = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'ways' });
    expect(all.status).toBe(200);
    const walkers = (await api(base, '/api/admin/art', owner.token)).body.walkers;
    expect(all.body.title).toBe(`Paint every walker standing in the isometric ways: ${walkers.length * 4} pictures`);
    expect(all.body.parts.map((p: any) => p.name)).toEqual(walkers.map((w: any) => w.name));
    expect(all.body.parts.every((p: any) => p.recipe.steps.length === 4)).toBe(true);
  }, 60_000);

  it('keeps a walk stopped by the day\'s clip limit, and makes it once the Owner raises the limit', async () => {
    const clips = video();
    const anchors = await tmp();
    await mkdir(join(anchors, 'raw'), { recursive: true });
    await writeFile(join(anchors, 'raw', 'desert-scarab.png'), await figure(300, 300, 150, 280));
    const { base, store, artDir } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir: anchors, painter: figurePainter(), video: clips, frames });
    const owner = account(store, 'Ego', 'owner');
    store.updateSettings({ ...store.settings, ai: { ...store.settings.ai, video: { provider: 'gemini', model: clips.model, dailyClips: 0 } } });
    expect((await ask(base, owner.token, 'walk', { walker: 'desert-scarab', body: 'six-legged' })).status).toBe(202);
    await app!.art.idle();
    expect(clips.asked).toHaveLength(0);
    const { body: jobs } = await api(base, '/api/admin/art/jobs', owner.token);
    expect(jobs.jobs.filter((j: any) => j.media === 'clip' && j.status === 'skipped')).toHaveLength(4);
    // Kept, so a restart meanwhile still asks for it.
    const kept = await until(async () => JSON.parse(await readFile(join(artDir, 'paint-requests.json'), 'utf8').catch(() => '[]')).length);
    expect(kept).toBe(1);

    const { body } = await api(base, '/api/admin/ai', owner.token);
    expect((await api(base, '/api/admin/ai', owner.token, 'PUT', { ...body.ai, video: { ...body.ai.video, dailyClips: 7 } })).status).toBe(200);
    await until(async () => app!.art.pending.size > 0);
    await app!.art.idle();
    expect(clips.asked).toHaveLength(4);
    const { body: art } = await api(base, '/api/art', owner.token);
    for (const d of WALK_DIRECTIONS) expect(art[walkArt('desert-scarab', d)]).toMatchObject({ kind: 'walk' });
  }, 60_000);

  it('refuses to paint once the month\'s budget is spent', async () => {
    const { base, store } = await start({ shippedArt: await shippedManifest(await tmp()), anchorDir });
    const owner = account(store, 'Ego', 'owner');
    store.recordSpend({ at: Date.now(), usd: 1000, kind: 'image', provider: 'fake', model: 'fake-image', playerId: null });
    const refused = await ask(base, owner.token, 'paint', { asset: 'sanctum-rock' });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/budget is spent/);
  });

  it('shows a request held back by the model\'s rate limit as waiting, and paints it after a restart', async () => {
    const shippedArt = await shippedManifest(await tmp());
    const once = () => new MemoryPaintQueue({ limit: () => ({ perMinute: 1, atOnce: 1 }) });
    const first = await start({ shippedArt, anchorDir, paintQueue: once() });
    const owner = account(first.store, 'Ego', 'owner');
    await ask(first.base, owner.token, 'paint', { asset: 'sanctum-rock' });
    await ask(first.base, owner.token, 'paint', { asset: 'bramble-cottage-furniture-bed' });
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

  it('paints a building look\'s texture sheet only once approved, keeps it with its layout and words, and checks it for free', async () => {
    // The test painter fills the guide's green shapes with one plain colour: a stand-in, never game art.
    const sheetPainter: ImageProvider & { asked: ImageRequest[] } = {
      id: 'gemini',
      model: 'gemini-3.1-flash-image',
      asked: [],
      async generate(request) {
        this.asked.push(request);
        const { data, info } = await sharp(request.references![0]!.data).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let i = 0; i < data.length; i += 3) if (data[i] === 0 && data[i + 1] === 255 && data[i + 2] === 0) data.set([196, 172, 140], i);
        return { mimeType: 'image/png', data: await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer() };
      },
    };
    const { base, store, artDir } = await start({ painter: sheetPainter });
    const owner = account(store, 'Ego', 'owner');
    const review = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'sheet', look: 'timber-cottage', textures: ['window'] });
    expect(review.status).toBe(200);
    expect(review.body.title).toBe('Paint the window texture of the timber-framed cottage sheet again');
    const [step] = review.body.parts[0].recipe.steps;
    expect(step).toMatchObject({ media: 'picture', model: 'gemini-3.1-flash-image', prompt: expect.stringContaining('window'), pictures: [{ name: 'Layout guide: the green shapes to paint', url: expect.any(String) }] });
    expect(step.settings).toEqual(expect.arrayContaining(['shape 16:9', 'size 2K']));
    // nothing is painted before it is approved
    expect((await api(base, '/api/admin/art/sheet', owner.token, 'POST', { look: 'timber-cottage', textures: ['window'] })).status).toBe(409);
    expect(sheetPainter.asked).toHaveLength(0);

    const painting = await ask(base, owner.token, 'sheet', { look: 'timber-cottage', textures: ['window'] });
    expect(painting.status).toBe(202);
    expect(painting.body.estimateUsd).toBeGreaterThan(0);
    await app!.art.idle();
    expect(sheetPainter.asked).toHaveLength(1);
    expect(sheetPainter.asked[0]).toMatchObject({ prompt: step.prompt, edit: true, aspectRatio: '16:9', size: '2K' });
    const kept = join(artDir, 'kit-sheets', 'timber-cottage');
    expect(await readFile(join(kept, 'sheet-1.prompt.txt'), 'utf8')).toBe(step.prompt);
    expect(Object.keys(JSON.parse(await readFile(join(kept, 'sheet-1.layout.json'), 'utf8')))).toEqual(['window']);
    expect(store.spendThisMonth(Date.now())).toHaveLength(1);
    const { body: jobs } = await api(base, '/api/admin/art/jobs', owner.token);
    expect(jobs.jobs[0]).toMatchObject({ asset: 'kit-sheet-timber-cottage', status: 'done', label: review.body.title });

    // checked for free: the window passes and is used, the rest are not painted yet
    const sheet = await until(async () => (await api(base, '/api/admin/art', owner.token)).body.sheets.find((x: any) => x.look === 'timber-cottage' && !x.checking));
    expect(sheet.paintings).toEqual([{ id: 'painted/sheet-1', shipped: false }]);
    expect(sheet.textures.find((t: any) => t.name === 'window')).toEqual({ name: 'window', ok: true, painting: 'painted/sheet-1', failed: [] });
    expect(sheet.textures.find((t: any) => t.name === 'roof')).toEqual({ name: 'roof', ok: false, failed: ['not painted yet'] });

    expect((await ask(base, owner.token, 'sheet', { look: 'castle' })).body.message).toMatch(/no building look/);
    expect((await ask(base, owner.token, 'sheet', { look: 'timber-cottage', textures: ['chimney'] })).body.message).toMatch(/no texture called chimney/);
  }, 30_000);
});

/** Reviews a paid request as God's View does, then approves exactly what it showed. */
async function ask(base: string, token: string, what: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const review = await api(base, '/api/admin/art/review', token, 'POST', { what, ...body });
  if (review.status !== 200) return review;
  return api(base, `/api/admin/art/${what}`, token, 'POST', { ...body, approved: review.body.fingerprint });
}

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
