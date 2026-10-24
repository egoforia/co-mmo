import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CHARACTER_HEIGHT, CREATURE_HEIGHTS, ISO_WAYS, TURNTABLE_WAYS } from '@co-mmo/shared';
import { cutFigures, feetCentre, isolateFigure, normalizeWalk } from '../src/assets/walk-frames.ts';
import { waysFromSheet } from '../src/assets/walk-video.ts';

const MAGENTA = '#FF00FF';

const picture = (width: number, height: number, shapes: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${MAGENTA}"/>${shapes}</svg>`)).png().toBuffer();

const transparentPicture = (width: number, height: number, shapes: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes}</svg>`)).png().toBuffer();

/** A figure with body, head, reaching arm (extended limb), and feet. */
const reachFigure = (x: number, y: number, { h = 100, reach = 30 } = {}) =>
  `<rect x="${x - 15}" y="${y - h}" width="30" height="${h}" fill="#3060c0"/>` +
  `<circle cx="${x}" cy="${y - h - 12}" r="12" fill="#e0b090"/>` +
  `<rect x="${x + 15}" y="${y - h + 10}" width="${reach}" height="12" fill="#d02020"/>` +
  `<rect x="${x - 10}" y="${y - 20}" width="8" height="20" fill="#202020"/>` +
  `<rect x="${x + 2}" y="${y - 20}" width="8" height="20" fill="#202020"/>`;

const alphaAt = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3]!;
};

describe('walk-frames coherence & normalization', () => {
  it('isolates the figure, preserving extended reach while filtering background specks and border bits', async () => {
    // Character with extended arm reach of 40px reaching near border
    const char = reachFigure(80, 200, { h: 120, reach: 40 });
    // Disconnected small speck (<10% of body)
    const speck = '<circle cx="20" cy="50" r="3" fill="#3060c0"/>';
    // Edge artifact whisker touching boundary
    const whisker = '<rect x="0" y="10" width="5" height="15" fill="#3060c0"/>';

    const raw = await transparentPicture(240, 240, char + speck + whisker);
    const isolated = await isolateFigure(raw);
    const meta = await sharp(isolated).metadata();
    expect(meta.width).toBe(240);

    // Speck and border whisker should be cleared (alpha = 0)
    expect(await alphaAt(isolated, 20, 50)).toBe(0);
    expect(await alphaAt(isolated, 2, 12)).toBe(0);

    // Extended fist at x = 80 + 15 + 30 = 125, y = 200 - 120 + 15 = 95 must be preserved
    expect(await alphaAt(isolated, 125, 95)).toBeGreaterThan(0);
  });

  it('cuts turnaround sheets in turntable order as well as standard ISO_WAYS order', async () => {
    // 4 figures spaced across sheet width
    const sheet = await picture(
      1200,
      300,
      [150, 450, 750, 1050].map((x, i) => `<rect x="${x - 10 - i * 5}" y="60" width="${20 + i * 10}" height="220" fill="#3060c0"/>`).join(''),
    );

    // Turntable sequence: Col 0: FL, Col 1: FR, Col 2: BR, Col 3: BL
    const turntable = await waysFromSheet(sheet, TURNTABLE_WAYS);
    expect(Object.keys(turntable)).toEqual(expect.arrayContaining([...TURNTABLE_WAYS]));

    const wFL = (await sharp(turntable['front-left']).metadata()).width;
    const wFR = (await sharp(turntable['front-right']).metadata()).width;
    const wBR = (await sharp(turntable['back-right']).metadata()).width;
    const wBL = (await sharp(turntable['back-left']).metadata()).width;

    // Col widths were 20, 30, 40, 50
    expect(wFL).toBe(20);
    expect(wFR).toBe(30);
    expect(wBR).toBe(40);
    expect(wBL).toBe(50);
  });

  it('normalizes clips of different generator resolutions to identical character scale and ground baseline', async () => {
    // Model A: 720p resolution, figure height 200px (sitting at y = 450)
    const frameA1 = await transparentPicture(600, 500, reachFigure(300, 450, { h: 200, reach: 20 }));
    const frameA2 = await transparentPicture(600, 500, reachFigure(300, 450, { h: 200, reach: 35 }));

    // Model B: 1080p resolution, figure height 300px (1.5x scale, sitting at y = 650 with different padding)
    const frameB1 = await transparentPicture(900, 750, reachFigure(450, 650, { h: 300, reach: 30 }));
    const frameB2 = await transparentPicture(900, 750, reachFigure(450, 650, { h: 300, reach: 52 }));

    const walkA = await normalizeWalk([[frameA1, frameA2]], { bodyHeight: CHARACTER_HEIGHT, margin: 2 });
    const walkB = await normalizeWalk([[frameB1, frameB2]], { bodyHeight: CHARACTER_HEIGHT, margin: 2 });

    // Both should yield strips of identical height and comparable width
    expect(walkA.frameHeight).toBe(walkB.frameHeight);
    expect(Math.abs(walkA.frameWidth - walkB.frameWidth)).toBeLessThanOrEqual(4);

    // Both feet touch the exact ground baseline: 2 pixels above the bottom
    const centreA = Math.round(walkA.frameWidth / 2);
    const centreB = Math.round(walkB.frameWidth / 2);

    expect(await alphaAt(walkA.strips[0]!, centreA, walkA.frameHeight - 3)).toBeGreaterThan(0);
    expect(await alphaAt(walkA.strips[0]!, centreA, walkA.frameHeight - 1)).toBe(0);

    expect(await alphaAt(walkB.strips[0]!, centreB, walkB.frameHeight - 3)).toBeGreaterThan(0);
    expect(await alphaAt(walkB.strips[0]!, centreB, walkB.frameHeight - 1)).toBe(0);
  });

  it('normalizes creatures according to canonical size tiers', async () => {
    // reachFigure with h=200 has body (200px) + head circle (r=12 -> 24px) = 224px total figure height
    const rawFrame = await transparentPicture(400, 400, reachFigure(200, 350, { h: 200 }));

    // Tiny tier: 64px
    const tiny = await normalizeWalk([[rawFrame]], { bodyHeight: CREATURE_HEIGHTS.tiny, margin: 2 });
    expect(tiny.scale).toBeCloseTo(64 / 224, 2);
    expect(tiny.frameHeight).toBeLessThan(80);

    // High tier: 224px
    const high = await normalizeWalk([[rawFrame]], { bodyHeight: CREATURE_HEIGHTS.high, margin: 2 });
    expect(high.scale).toBeCloseTo(224 / 224, 2);
    expect(high.frameHeight).toBeGreaterThan(200);

    // Colossal tier: 320px
    const colossal = await normalizeWalk([[rawFrame]], { bodyHeight: CREATURE_HEIGHTS.colossal, margin: 2 });
    expect(colossal.scale).toBeCloseTo(320 / 224, 2);
    expect(colossal.frameHeight).toBeGreaterThan(300);
  });
});
