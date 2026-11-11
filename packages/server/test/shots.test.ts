// The shot runner's own parts: the pinned sky lands on the hour and weather
// asked for, and the picture checks find what they say they find.

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { dayPhase, gameHour, regionDef, weatherAt } from '@co-mmo/shared';
import { pinnedSky } from '../shots/sky.ts';
import { changedShare, compare, pictureProblems } from '../shots/pictures.ts';
import { SHOTS } from '../shots/list.ts';

const square = (colour: { r: number; g: number; b: number }, patch?: { r: number; g: number; b: number }) =>
  sharp({ create: { width: 100, height: 100, channels: 3, background: colour } })
    .composite(patch ? [{ input: { create: { width: 20, height: 20, channels: 3, background: patch } }, left: 40, top: 40 }] : [])
    .png()
    .toBuffer();

describe('shots', () => {
  it('pins the sky to the hour and weather a shot asks for', () => {
    const now = Date.UTC(2026, 10, 11, 16, 0, 0);
    for (const [region, hour, weather] of [['sanctum', 23, 'clear'], ['sanctum', 18.5, 'rain'], ['desert', 15, 'sandstorm'], ['frostpeak', 12, 'snow']] as const) {
      const def = regionDef(region)!;
      const sky = pinnedSky(region, def.biome, hour, weather, now);
      if (typeof sky === 'string') throw new Error(sky);
      expect(gameHour(dayPhase(now, sky))).toBeCloseTo(hour, 3);
      expect(weatherAt(region, def.biome, now, sky)).toBe(weather);
      // The light hardly moves while the picture is taken: under a game minute in ten seconds.
      expect(gameHour(dayPhase(now + 10_000, sky)) - hour).toBeLessThan(1 / 60);
    }
    expect(pinnedSky('desert', 'mirage-desert', 12, 'snow', now)).toMatch(/never has snow/);
  });

  it('finds magenta left from a painting and a screen that drew nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shots-test-'));
    await sharp(await square({ r: 40, g: 120, b: 60 }, { r: 255, g: 0, b: 255 })).toFile(join(dir, 'magenta.png'));
    await sharp(await square({ r: 0, g: 0, b: 0 })).toFile(join(dir, 'blank.png'));
    await sharp(await square({ r: 40, g: 120, b: 60 }, { r: 200, g: 200, b: 90 })).toFile(join(dir, 'fine.png'));
    expect((await pictureProblems(join(dir, 'magenta.png'))).join()).toMatch(/400 magenta pixels between \(40,40\) and \(59,59\)/);
    expect((await pictureProblems(join(dir, 'blank.png'))).join()).toMatch(/one flat colour/);
    expect(await pictureProblems(join(dir, 'fine.png'))).toEqual([]);
  });

  it('measures what changed between two pictures, and where', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shots-test-'));
    const before = await square({ r: 40, g: 120, b: 60 });
    const after = await square({ r: 40, g: 120, b: 60 }, { r: 200, g: 40, b: 40 });
    await sharp(before).toFile(join(dir, 'before.png'));
    await sharp(after).toFile(join(dir, 'after.png'));
    const d = await compare(join(dir, 'before.png'), join(dir, 'after.png'), join(dir, 'side-by-side.png'));
    expect(d).toEqual({ changed: 0.04, box: { x: 40, y: 40, width: 20, height: 20 }, resized: false });
    expect(await changedShare(before, before)).toBe(0);
    expect((await sharp(join(dir, 'side-by-side.png')).metadata()).width).toBe(316);
  });

  it('gives every shot a unique name and something to look for', () => {
    const names = SHOTS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of SHOTS) expect(s.mustSee.length, s.name).toBeGreaterThan(0);
  });
});
