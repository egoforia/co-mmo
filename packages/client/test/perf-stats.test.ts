import { describe, expect, it } from 'vitest';
import { biggestTextures, chartPoints, FrameStats, middle, Rate, textureMemory, whereTimeGoes } from '../src/perf-stats.ts';

describe('performance overlay sums', () => {
  it('reads frame rate, the slowest frames and stutters from frame times', () => {
    const frames = new FrameStats(200);
    for (let i = 0; i < 198; i++) frames.frame(1000 / 60, 4);
    frames.frame(100, 40);
    frames.frame(60, 20);
    const f = frames.summary();
    expect(f.fps).toBeGreaterThan(50);
    expect(f.fps).toBeLessThan(60);
    // Two frames in two hundred are the slowest 1%.
    expect(f.lowFps).toBeCloseTo(1000 / 80);
    expect(f.worstMs).toBe(100);
    expect(f.longFrames).toBe(2);
    expect(f.workMs).toBeCloseTo((198 * 4 + 60) / 200);
    expect(f.recent).toHaveLength(200);
  });

  it('keeps only the last frames, and starts over after a pause', () => {
    const frames = new FrameStats(10);
    for (let i = 0; i < 30; i++) frames.frame(i < 20 ? 200 : 10, 1);
    expect(frames.summary()).toMatchObject({ fps: 100, worstMs: 10, longFrames: 0 });
    frames.clear();
    expect(frames.summary()).toMatchObject({ fps: 0, recent: [] });
  });

  it('counts a rate over the last few seconds', () => {
    const rate = new Rate(5000);
    rate.add(100, 0);
    rate.add(100, 4000);
    expect(rate.perSecond(4000)).toBe(40);
    // The first count falls out of the window.
    expect(rate.perSecond(6000)).toBe(20);
  });

  it('sizes our pictures, not Phaser\'s own', () => {
    const sizes = [
      { key: '__DEFAULT', width: 32, height: 32 },
      { key: 'tree', width: 512, height: 512 },
      { key: 'ground', width: 1024, height: 1024 },
    ];
    expect(textureMemory(sizes)).toEqual({ count: 2, mb: 5 });
    expect(biggestTextures(sizes, 1)).toEqual([{ key: 'ground', width: 1024, height: 1024 }]);
  });

  it('takes the middle round trip, so one slow answer does not swing it', () => {
    expect(middle([10, 12, 400])).toBe(12);
    expect(middle([10, 20])).toBe(15);
    expect(middle([])).toBe(0);
  });

  it('charts frame times from the bottom up, slow ones held at the top', () => {
    expect(chartPoints([0, 25, 500], 100, 10, 50)).toBe('0.0,10.0 50.0,5.0 100.0,0.0');
    expect(chartPoints([5], 100, 10, 50)).toBe('');
  });

  it('says where a slow frame goes, only when frames are slow', () => {
    expect(whereTimeGoes(60, 16, 4)).toBeUndefined();
    expect(whereTimeGoes(20, 50, 40)).toMatch(/game working/);
    expect(whereTimeGoes(20, 50, 8)).toMatch(/graphics card/);
  });
});
