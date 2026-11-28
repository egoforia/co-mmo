import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BUILDING_STYLES } from '@co-mmo/shared';
import { buildingArtJobs, paintBuildingArt } from '../src/assets/building-art.ts';
import { GUIDE_LABEL, GUIDE_SIZE, footprintGuide, guidePatch } from '../src/assets/footprint-guide.ts';
import type { ImageRequest } from '../src/assets/provider.ts';
import { SEA_CAVE_KIT } from '../src/assets/sea-cave-kit.ts';
import { FOOTPRINT_GUIDE_WORDS, buildPrompt, footprintWords } from '../src/assets/style.ts';
import { paintKitAsset } from '../src/assets/wild-kit.ts';

const slope = (a: { x: number; y: number }, b: { x: number; y: number }) => (b.y - a.y) / (b.x - a.x);

describe('the footprint guide', () => {
  it('draws the patch at the game camera’s 2:1 angle, each side as many tiles long as the footprint', () => {
    for (const fp of [{ width: 1, height: 1 }, { width: 2, height: 1 }, { width: 1, height: 3 }, { width: 3, height: 2 }]) {
      const p = guidePatch(fp);
      expect(slope(p.left, p.front)).toBeCloseTo(0.5);
      expect(slope(p.front, p.right)).toBeCloseTo(-0.5);
      expect(slope(p.back, p.right)).toBeCloseTo(0.5);
      // Width runs from the left corner to the front corner, height from the front corner to the right one.
      expect(p.front.x - p.left.x).toBeCloseTo(fp.width * p.half);
      expect(p.right.x - p.front.x).toBeCloseTo(fp.height * p.half);
      // It sits inside the guide, centred, with room above it.
      expect(p.left.x).toBeGreaterThan(0);
      expect(p.right.x).toBeLessThan(GUIDE_SIZE);
      expect((p.left.x + p.right.x) / 2).toBeCloseTo(GUIDE_SIZE / 2);
      expect(p.back.y).toBeGreaterThan(GUIDE_SIZE / 2);
    }
  });

  it('is magenta with white marks on the corners, and nothing filled in between', async () => {
    const fp = { width: 2, height: 1 };
    const { data, info } = await sharp(await footprintGuide(fp)).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([GUIDE_SIZE, GUIDE_SIZE]);
    const at = (x: number, y: number) => [...data.subarray((Math.round(y) * info.width + Math.round(x)) * info.channels, (Math.round(y) * info.width + Math.round(x)) * info.channels + 3)];
    const p = guidePatch(fp);
    for (const c of [p.left, p.front, p.right, p.back]) expect(at(c.x, c.y)).toEqual([255, 255, 255]);
    // The patch's middle is left key colour: a filled patch gets painted as a floor.
    expect(at((p.left.x + p.right.x) / 2 + p.half / 4, (p.back.y + p.front.y) / 2)).toEqual([255, 0, 255]);
    expect(at(10, 10)).toEqual([255, 0, 255]);
  });

  it('is sent last with a piece that stands on tiles, and its words say so', async () => {
    const boulder = SEA_CAVE_KIT.find((a) => a.id === 'sea-cave-boulder')!;
    const dir = await mkdtemp(join(tmpdir(), 'painted-'));
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff00ff' } }).composite([{ input: await sharp({ create: { width: 30, height: 20, channels: 3, background: '#777' } }).png().toBuffer(), left: 17, top: 30 }]).png().toBuffer();
    const asked: ImageRequest[] = [];
    const provider = { id: 'gemini', model: 'gemini-3.1-flash-image', generate: async (r: ImageRequest) => (asked.push(r), { mimeType: 'image/png', data: png }) };
    await paintKitAsset(boulder, provider, dir, dir);
    const sent = asked[0]!;
    expect(sent.labels?.at(-1)).toBe(GUIDE_LABEL);
    expect(sent.references?.at(-1)?.data.equals(await footprintGuide({ width: 2, height: 1 }))).toBe(true);
    expect(sent.prompt).toContain(FOOTPRINT_GUIDE_WORDS);
    expect(sent.prompt).toContain('The last image is a footprint guide');
  });

  it('is sent with furniture, and not with a building’s outside or its floor', async () => {
    const jobs = buildingArtJobs(BUILDING_STYLES['bramble-cottage']!);
    const dir = await mkdtemp(join(tmpdir(), 'painted-'));
    const asked: ImageRequest[] = [];
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff00ff' } }).composite([{ input: await sharp({ create: { width: 30, height: 20, channels: 3, background: '#777' } }).png().toBuffer(), left: 17, top: 30 }]).png().toBuffer();
    const provider = { id: 'gemini', model: 'gemini-3.1-flash-image', generate: async (r: ImageRequest) => (asked.push(r), { mimeType: 'image/png', data: png }) };
    const dirs = { anchorDir: dir, rawDir: join(dir, 'raw'), outDir: dir };
    const rack = jobs.find((j) => j.id === 'bramble-cottage-furniture-herb-rack')!;
    await paintBuildingArt(rack, provider, dirs);
    expect(asked[0]!.labels?.at(-1)).toBe(GUIDE_LABEL);
    expect(asked[0]!.references?.at(-1)?.data.equals(await footprintGuide(rack.footprint!))).toBe(true);
    expect(rack.prompt).toContain(FOOTPRINT_GUIDE_WORDS);
    for (const job of jobs.filter((j) => j.kind !== 'furniture')) {
      await paintBuildingArt(job, provider, dirs);
      expect(asked.at(-1)!.labels ?? []).not.toContain(GUIDE_LABEL);
      expect(job.prompt).not.toContain(FOOTPRINT_GUIDE_WORDS);
    }
  });

  it('leaves the words of pictures with no footprint as they were', () => {
    const floor = SEA_CAVE_KIT.find((a) => a.id === 'sea-cave-floor')!;
    expect(buildPrompt(floor)).not.toContain('footprint guide');
    expect(footprintWords({ width: 2, height: 1 })).toMatch(/^Footprint: it stands on a diamond-shaped patch of ground 2 tiles from the left corner/);
  });
});
