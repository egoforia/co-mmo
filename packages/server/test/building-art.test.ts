import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BUILDING_STYLES, LAND_ITEMS, isoSpan, PIXEL_ART_SCALE, SEA_CAVE_PIECES, TILE_PIXELS, WORLD_REGIONS, buildingArtIds, generateRegion, type ArtManifest } from '@co-mmo/shared';
import { buildingArtJobs, processBuildingArt } from '../src/assets/building-art.ts';
import type { GeneratedImage, ImageProvider, ImageRequest } from '../src/assets/provider.ts';
import { BuildingPainter } from '../src/building-painter.ts';
import { STYLE } from '../src/assets/style-profile.ts';

const cottage = BUILDING_STYLES['bramble-cottage']!;
const raw = async (png: Buffer) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

/** A picture like the model's: a coloured shape on magenta, or noisy texture for a tile. */
async function fakePicture(request: ImageRequest): Promise<GeneratedImage> {
  const tile = request.prompt.includes('texture tile');
  const size = 256;
  const shape = await sharp({ create: { width: 120, height: 160, channels: 3, background: '#7a573c' } }).png().toBuffer();
  const data = tile
    ? await sharp(Buffer.alloc(size * size * 3).map((_, i) => 90 + ((i * 37) % 80)), { raw: { width: size, height: size, channels: 3 } }).png().toBuffer()
    : await sharp({ create: { width: size, height: size, channels: 3, background: '#ff00ff' } }).composite([{ input: shape, left: 68, top: 60 }]).png().toBuffer();
  return { mimeType: 'image/png', data, outputTokens: 1120 };
}

class FakeProvider implements ImageProvider {
  readonly id = 'gemini';
  readonly model = 'gemini-3.1-flash-image';
  readonly requests: ImageRequest[] = [];
  async generate(request: ImageRequest): Promise<GeneratedImage> {
    this.requests.push(request);
    return fakePicture(request);
  }
}

describe('building art jobs', () => {
  it('paints the outside first, then inside tiles and furniture matched to it', () => {
    const jobs = buildingArtJobs(cottage);
    expect(jobs.map((j) => j.id)).toEqual(buildingArtIds(cottage));
    expect(jobs[0]!.kind).toBe('exterior');
    expect(jobs[0]!.prompt).toMatch(/front door of the building is exactly where the dark arch is, at the middle of the bottom edge/);
    for (const job of jobs.slice(1)) {
      expect(job.references).toEqual([jobs[0]!.id]);
      expect(job.prompt.startsWith(STYLE.interior.style)).toBe(true);
    }
    expect(jobs.filter((j) => j.kind === 'tile').every((j) => /repeats seamlessly/.test(j.prompt))).toBe(true);
  });
});

describe('processBuildingArt', () => {
  const dir = mkdtemp(join(tmpdir(), 'building-art-'));
  const jobs = buildingArtJobs(cottage);

  it('turns a tile into a seamless game-sized tile, as 4 by 4 pixel art when the style asks for pixel-art insides', async () => {
    const floor = jobs.find((j) => j.id === 'bramble-cottage-floor')!;
    const entry = await processBuildingArt(floor, (await fakePicture({ prompt: floor.prompt })).data, await dir);
    expect(entry).toMatchObject({ file: 'art/bramble-cottage-floor.png', width: TILE_PIXELS, height: TILE_PIXELS });
    const { data, info } = await raw(await readFile(join(await dir, 'bramble-cottage-floor.png')));
    if (!STYLE.interior.pixelArt) return;
    // Every 4 by 4 block is one colour.
    for (let y = 0; y < info.height; y += PIXEL_ART_SCALE) {
      for (let x = 0; x < info.width; x += PIXEL_ART_SCALE) {
        const at = (dx: number, dy: number) => data.readUInt32LE(((y + dy) * info.width + x + dx) * 4);
        expect(at(3, 3)).toBe(at(0, 0));
      }
    }
  });

  it('fits furniture to the tiles it stands on, with the background cut away', async () => {
    const bed = jobs.find((j) => j.id === 'bramble-cottage-furniture-bed')!;
    const entry = await processBuildingArt(bed, (await fakePicture({ prompt: bed.prompt })).data, await dir);
    if (STYLE.camera === 'isometric') {
      // Painted standing on its two by two tiles, as wide as their diamond.
      expect(bed.footprint).toEqual({ width: 2, height: 2 });
      expect(bed.prompt).toMatch(/Footprint: it stands on a diamond-shaped patch of ground 2 tiles along each side/);
      expect(entry).toMatchObject({ width: isoSpan(2, 2), view: 'isometric' });
    } else {
      expect(entry.width).toBe(cottage.furniture.bed!.width * TILE_PIXELS);
      expect(entry.view).toBeUndefined();
    }
    expect(entry.height % PIXEL_ART_SCALE).toBe(0);
  });

  it('keeps the outside its full width, so the door stays in the middle', async () => {
    const exterior = jobs[0]!;
    const entry = await processBuildingArt(exterior, (await fakePicture({ prompt: exterior.prompt })).data, await dir);
    expect(entry.file).toBe('art/bramble-cottage-exterior.webp');
    expect(entry.width).toBe(256);
    // Empty rows above and below are trimmed.
    expect(entry.height).toBe(160);
  });
});

describe('BuildingPainter', () => {
  it('paints only the building art that did not ship, and serves it', async () => {
    const artDir = await mkdtemp(join(tmpdir(), 'painter-'));
    const provider = new FakeProvider();
    const others = Object.values(BUILDING_STYLES).filter((s) => s !== cottage).flatMap(buildingArtIds);
    const shipped: ArtManifest = Object.fromEntries([...buildingArtIds(cottage).slice(0, -2), ...others].map((id) => [id, { file: `art/${id}.png`, kind: 'x', width: 1, height: 1 }]));
    const spent: number[] = [];
    const painter = new BuildingPainter({
      provider: () => provider, overBudget: () => false, spend: (usd) => spent.push(usd),
      anchorDir: artDir, artDir, shipped: async () => shipped,
    });
    await painter.start();
    const missing = buildingArtIds(cottage).slice(-2);
    expect(Object.keys(painter.manifest())).toEqual(missing);
    expect(painter.manifest()[missing[0]!]!.file).toBe(`wished-art/buildings/${missing[0]}.png`);
    expect(provider.requests).toHaveLength(2);
    expect(spent[0]).toBeCloseTo(1120 * 60 / 1e6);
    // Nothing left to paint the next time.
    await painter.start();
    expect(provider.requests).toHaveLength(2);
  });

  it('paints nothing without an image model or over budget', async () => {
    const artDir = await mkdtemp(join(tmpdir(), 'painter-'));
    const provider = new FakeProvider();
    for (const options of [{ provider: () => undefined, overBudget: () => false }, { provider: () => provider, overBudget: () => true }]) {
      const painter = new BuildingPainter({ ...options, spend: () => {}, anchorDir: artDir, artDir, shipped: async () => ({}) });
      await painter.start();
      expect(painter.manifest()).toEqual({});
    }
    expect(provider.requests).toHaveLength(0);
  });
});

describe('the shipped art', () => {
  it('has a painted picture for every landmark in the world, or the server paints it as building art', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../client/public/art/manifest.json', import.meta.url), 'utf8')) as ArtManifest;
    // A building a wish added ships only its description; BuildingPainter paints it at start-up.
    for (const id of buildingArtIds(cottage)) expect(manifest).toHaveProperty([id]);
    const painted = new Set(Object.values(BUILDING_STYLES).flatMap(buildingArtIds));
    for (const def of WORLD_REGIONS) {
      const map = generateRegion(def);
      for (const b of map.buildings) expect(BUILDING_STYLES).toHaveProperty([b.style]);
      // The sea cave's kit props are painted in the Art tab, like all of a kit's pieces.
      for (const l of map.landmarks) expect(l.asset in manifest || painted.has(l.asset) || SEA_CAVE_PIECES.some((p) => p.id === l.asset)).toBe(true);
    }
    expect(manifest).toHaveProperty(['fx-slash']);
  });

  it('has a picture for everyone and everything in the great places, and for the bridges', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../client/public/art/manifest.json', import.meta.url), 'utf8')) as ArtManifest;
    const missing = new Set<string>();
    for (const def of WORLD_REGIONS) {
      const map = generateRegion(def);
      for (const thing of [...map.creatures, ...map.npcs]) if (!(thing.asset in manifest)) missing.add(thing.asset);
    }
    for (const item of Object.values(LAND_ITEMS)) if (!(item.art in manifest)) missing.add(item.art);
    if (!('bridge-planks' in manifest)) missing.add('bridge-planks');
    expect([...missing]).toEqual([]);
  });
});
