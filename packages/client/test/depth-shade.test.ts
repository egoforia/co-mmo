import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';

// No real tile layers here: every object is a plain picture.
vi.mock('phaser', () => ({ default: { Tilemaps: { TilemapLayer: class {} } } }));

const { forgetShade, setDepthShade } = await import('../src/world-scene/types.ts');

/** A picture that counts how often it is tinted and made solid. */
function picture(baseTint?: number) {
  const calls = { tint: [] as number[], clear: 0, alpha: 0 };
  const o = {
    scene: {},
    getData: (key: string) => (key === 'baseTint' ? baseTint : undefined),
    setTint: (t: number) => calls.tint.push(t),
    clearTint: () => calls.clear++,
    setAlpha: () => calls.alpha++,
  };
  return { o: o as unknown as Phaser.GameObjects.GameObject, calls };
}

describe('floor shade', () => {
  it('shades a picture once, however many frames ask', () => {
    const { o, calls } = picture();
    for (let frame = 0; frame < 60; frame++) setDepthShade(o, 0);
    expect(calls.clear).toBe(1);
    expect(calls.alpha).toBe(1);
  });

  it('shades it again when its floor falls below ours, and back', () => {
    const { o, calls } = picture();
    setDepthShade(o, 0);
    setDepthShade(o, 1);
    setDepthShade(o, 1);
    setDepthShade(o, 0);
    expect(calls.tint).toHaveLength(1);
    expect(calls.clear).toBe(2);
  });

  it('keeps a wall its own tint on our floor', () => {
    const { o, calls } = picture(0xd8dce8);
    setDepthShade(o, 0);
    setDepthShade(o, 0);
    expect(calls.tint).toEqual([0xd8dce8]);
  });

  it('shades it again after something else tinted it', () => {
    const { o, calls } = picture();
    setDepthShade(o, 0);
    forgetShade(o);
    setDepthShade(o, 0);
    expect(calls.clear).toBe(2);
  });
});
