import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { measureAlpha, measureBase } from '../src/art-studio/auto-fit.ts';

/** An alpha channel with solid rectangles [x0, y0, x1, y1). */
function alpha(width: number, height: number, rects: [number, number, number, number][]): Uint8Array {
  const a = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) a[y * width + x] = 255;
  return a;
}

describe('where a picture meets the ground', () => {
  it('finds the middle of the lowest band of solid pixels', () => {
    // A trunk 20 wide standing at x 60-80, its foot on row 90; a crown above.
    const m = measureAlpha(alpha(100, 100, [[20, 10, 90, 50], [60, 50, 80, 90]]), 100, 100)!;
    expect(m.base.x).toBe(70);
    expect(m.base.width).toBe(20);
    expect(m.bottom).toBe(90);
    expect(m.base.y).toBeGreaterThan(78);
    expect(m.sure).toBe('high');
  });

  it('ignores specks narrower than 3 % of the widest row', () => {
    const m = measureAlpha(alpha(200, 100, [[10, 10, 190, 50], [90, 50, 110, 80], [5, 95, 7, 97]]), 200, 100)!;
    expect(m.bottom).toBe(80);
    expect(m.base.x).toBe(100);
  });

  it('is unsure of a foot in many pieces, and reads nothing from a full-bleed picture', () => {
    const legs = measureAlpha(alpha(100, 100, [[10, 10, 90, 60], [10, 60, 20, 90], [40, 60, 50, 90], [70, 60, 80, 90]]), 100, 100)!;
    expect(legs.sure).toBe('low');
    expect(measureAlpha(alpha(10, 10, [[0, 0, 10, 10]]), 10, 10)).toBeUndefined();
    expect(measureAlpha(alpha(10, 10, []), 10, 10)).toBeUndefined();
  });

  it('reads a PNG', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 10, height: 20, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }, left: 5, top: 15 }])
      .png()
      .toBuffer();
    const m = await measureBase(png);
    expect(m).toMatchObject({ width: 40, height: 40, bottom: 35, base: { x: 10, width: 10 } });
  });
});
