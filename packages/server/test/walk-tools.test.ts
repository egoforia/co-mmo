import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { BODY_TYPES, WALK_VIEWS } from '@co-mmo/shared';
import { GUIDE_SIZE, poseGuide, poseGuideSvg } from '../src/assets/pose-guide.ts';
import { cutFigures, feetCentre, normalizeWalk } from '../src/assets/walk-frames.ts';
import { checkWalk } from '../src/assets/walk-checks.ts';

// Test pictures: simple shapes on a transparent background, standing in for painted figures.
const picture = (width: number, height: number, shapes: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes}</svg>`)).png().toBuffer();
/** A figure: a body, a head, and a red flag on one side, so it has a facing. */
const figure = (x: number, y: number, { flag = 1, h = 60, fill = '#3060c0' } = {}) =>
  `<rect x="${x - 8}" y="${y - h}" width="16" height="${h}" fill="${fill}"/><circle cx="${x}" cy="${y - h - 8}" r="8" fill="#e0b090"/><rect x="${flag > 0 ? x + 8 : x - 28}" y="${y - h + 4}" width="20" height="16" fill="#d02020"/>`;
const alphaAt = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3]!;
};

describe('pose guides', () => {
  it('draws every step of every view of every body type', async () => {
    for (const body of Object.values(BODY_TYPES)) {
      for (const view of WALK_VIEWS) {
        const meta = await sharp(await poseGuide(body, view, 0)).metadata();
        expect([meta.width, meta.height]).toEqual([GUIDE_SIZE.width, GUIDE_SIZE.height]);
      }
    }
  });

  it('draws different pictures for different steps, and marks the face only when it can be seen', () => {
    const body = BODY_TYPES['two-legged']!;
    expect(poseGuideSvg(body, 'right', 0)).not.toEqual(poseGuideSvg(body, 'right', 2));
    const eyes = (view: (typeof WALK_VIEWS)[number]) => (poseGuideSvg(body, view, 0).match(/<circle/g) ?? []).length - 1;
    expect(eyes('front')).toBe(2);
    expect(eyes('right')).toBe(1);
    expect(eyes('back')).toBe(0);
  });
});

describe('frame cutter', () => {
  it('keeps a loose part with its own figure, drops specks and stray bits, and reads rows left to right', async () => {
    const png = await picture(400, 300, [
      figure(60, 120), figure(200, 120), figure(340, 120),
      figure(60, 280), figure(200, 280), figure(340, 280),
      // A staff tip floating just off the first figure, a speck, and a bit far from everyone.
      '<rect x="74" y="20" width="4" height="20" fill="#805020"/>',
      '<rect x="130" y="150" width="2" height="2" fill="#000"/>',
      '<rect x="390" y="150" width="6" height="30" fill="#000"/>',
    ].join(''));
    const figs = await cutFigures(png, { count: 6 });
    expect(figs.map((f) => Math.round((f.box.left + f.box.right) / 2 / 100))).toEqual([1, 2, 3, 1, 2, 3].map((v) => [0.6, 2, 3.4][v - 1]).map((x) => Math.round(x)));
    expect(figs[0]!.box.top).toBe(20);
    expect(figs.every((f) => f.box.right < 390)).toBe(true);
  });

  it('splits two figures from different rows that touch, and says when figures are missing', async () => {
    const png = await picture(200, 300, figure(100, 150, { h: 60 }) + figure(100, 300, { h: 60 }) + '<rect x="99" y="150" width="3" height="70" fill="#3060c0"/>');
    const figs = await cutFigures(png, { count: 2 });
    expect(figs).toHaveLength(2);
    expect(figs[0]!.box.bottom).toBeLessThan(figs[1]!.box.top + 5);
    await expect(cutFigures(png, { count: 5 })).rejects.toThrow(/expected 5/);
  });

  it('flags a figure that runs off the edge', async () => {
    const figs = await cutFigures(await picture(200, 100, figure(100, 100)), { count: 1 });
    expect(figs[0]!.touchesEdge).toBe(true);
  });
});

describe('normalizer', () => {
  it('scales every direction alike and stands every frame on one baseline, centred on its feet', async () => {
    const small = await sharp(await picture(40, 80, figure(20, 80, { h: 50 }))).trim().png().toBuffer();
    const big = await sharp(await picture(80, 160, figure(40, 160, { h: 110 }))).trim().png().toBuffer();
    const walk = await normalizeWalk([[small, small], [big, big]], { bodyHeight: 100, margin: 2 });
    expect(walk.strips).toHaveLength(2);
    const meta = await sharp(walk.strips[0]!).metadata();
    expect(meta.width).toBe(walk.frameWidth * 2);
    // Both directions' feet sit on the same row, two pixels above the bottom.
    for (const strip of walk.strips) {
      const centre = Math.round(walk.frameWidth / 2);
      expect(await alphaAt(strip, centre, walk.frameHeight - 3)).toBeGreaterThan(0);
      expect(await alphaAt(strip, centre, walk.frameHeight - 1)).toBe(0);
    }
    // The trimmed figure starts at its body's left edge, so its feet are 8 pixels in, not under the flag.
    expect(Math.abs((await feetCentre(small)) - 8)).toBeLessThan(2);
  });
});

describe('free checks', () => {
  const ref = () => picture(60, 90, figure(30, 85));
  const frame = (shapes: string) => picture(60, 90, shapes).then((p) => sharp(p).trim().png().toBuffer());

  it('passes good frames and counts repeated poses', async () => {
    const a = await frame(figure(30, 85));
    const b = await frame(figure(30, 85) + '<rect x="10" y="80" width="10" height="5" fill="#3060c0"/>');
    const good = await checkWalk([a, b], await sharp(await ref()).trim().png().toBuffer());
    expect(good.problems).toEqual([]);
    const repeated = await checkWalk([a, a, b], await sharp(await ref()).trim().png().toBuffer());
    expect(repeated.problems).toContain('Frame 2 repeats frame 1.');
    expect(repeated.distinctPoses).toBe(2);
  });

  it('finds a frame facing the other way, a missing part, and left-over magenta', async () => {
    const reference = await sharp(await ref()).trim().png().toBuffer();
    const turned = await frame(figure(30, 85, { flag: -1 }));
    const noFlag = await frame(figure(30, 85).replace(/<rect[^>]*#d02020"\/>/, ''));
    const magenta = await frame(figure(30, 85) + '<rect x="22" y="40" width="16" height="20" fill="#ff00ff"/>');
    const check = await checkWalk([turned, noFlag, magenta], reference);
    expect(check.problems.join(' ')).toMatch(/Frame 1 seems to face the other way/);
    expect(check.problems.join(' ')).toMatch(/Frame 2 has less red .*missing/);
    expect(check.problems.join(' ')).toMatch(/Frame 3 still shows some magenta/);
    expect(check.badFrames).toEqual([1, 2, 3]);
  });
});
