import { describe, expect, it } from 'vitest';
import { figureRows, groundFrame, standingMetrics } from '../src/world-scene/figure-ground.ts';

/** A strip of `bottoms.length` frames, 4 wide and 20 tall, each solid from row 2 down to its bottom. */
function strip(bottoms: number[]): { data: Uint8Array; width: number } {
  const width = 4 * bottoms.length;
  const data = new Uint8Array(width * 20 * 4);
  bottoms.forEach((bottom, i) => {
    for (let y = 2; y <= bottom; y++) data[(y * width + i * 4 + 1) * 4 + 3] = 255;
  });
  return { data, width };
}

describe('where a walker stands', () => {
  it('finds the rows a figure spans inside one frame of a strip', () => {
    const { data, width } = strip([17, 12]);
    expect(figureRows(data, width, { x: 0, y: 0, width: 4, height: 20 })).toEqual({ top: 2, bottom: 17 });
    expect(figureRows(data, width, { x: 4, y: 0, width: 4, height: 20 })).toEqual({ top: 2, bottom: 12 });
    expect(figureRows(new Uint8Array(4 * 20 * 4), 4, { x: 0, y: 0, width: 4, height: 20 })).toBeUndefined();
  });

  it('stands a walk on the pose whose lowest foot is highest, not on its first frame', () => {
    // The first frame reaches a foot toward us; the legs pass in frame 2.
    const { data, width } = strip([18, 16, 11, 14]);
    const rows = [0, 1, 2, 3].map((i) => figureRows(data, width, { x: i * 4, y: 0, width: 4, height: 20 }));
    const at = groundFrame(rows);
    expect(at).toBe(2);
    // No frame's lowest foot is above the line its feet rest on.
    const ground = standingMetrics(rows[at], 20).originY * 20;
    for (const r of rows) expect(r!.bottom).toBeGreaterThanOrEqual(Math.floor(ground));
  });

  it('skips empty frames and falls back to the first for a picture with nothing in it', () => {
    expect(groundFrame([undefined, { top: 0, bottom: 9 }])).toBe(1);
    expect(groundFrame([undefined])).toBe(0);
  });

  it('rests the feet just into the shadow', () => {
    const { height, originY } = standingMetrics({ top: 0, bottom: 99 }, 100);
    expect(height).toBe(100);
    expect(originY).toBeCloseTo(0.96);
  });
});
