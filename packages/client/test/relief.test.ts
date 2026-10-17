import { describe, expect, it } from 'vitest';
import { normalMapOf } from '../src/relief.ts';

/** A w-by-h picture of a grey disc on a clear background. */
function disc(size: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    px.fill(128, o, o + 3);
    px[o + 3] = Math.hypot(x + 0.5 - c, y + 0.5 - c) < size * 0.35 ? 255 : 0;
  }
  return px;
}

describe('normalMapOf', () => {
  const size = 48;
  const map = normalMapOf(disc(size), size, size);
  const at = (x: number, y: number) => Array.from(map.slice((y * size + x) * 4, (y * size + x) * 4 + 4));

  it('rounds a picture off at its outline, each edge facing outward', () => {
    const c = size / 2;
    const edge = Math.round(size * 0.35) - 2;
    expect(at(c - edge, c)[0]).toBeLessThan(110); // left edge faces left
    expect(at(c + edge, c)[0]).toBeGreaterThan(146); // right edge faces right
    expect(at(c, c - edge)[1]).toBeGreaterThan(146); // top edge faces up
    expect(at(c, c + edge)[1]).toBeLessThan(110); // bottom edge faces down
  });

  it('faces us where the picture is flat', () => {
    const [r, g, b] = at(size / 2, size / 2);
    expect(Math.abs(r! - 128)).toBeLessThan(6);
    expect(Math.abs(g! - 128)).toBeLessThan(6);
    expect(b).toBeGreaterThan(250);
  });

  it('stays flat across a plain ground tile, edges included', () => {
    const tile = new Uint8ClampedArray(16 * 16 * 4).fill(200);
    const flat = normalMapOf(tile, 16, 16);
    for (let i = 0; i < flat.length; i += 4) expect([flat[i], flat[i + 1]]).toEqual([128, 128]);
  });
});
