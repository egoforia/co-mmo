import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeSeamless, removeKeyBackground } from '../src/assets/postprocess.ts';

const raw = async (png: Buffer) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

describe('removeKeyBackground', () => {
  it('makes the magenta background transparent and keeps the subject', async () => {
    const square = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#4060c0' } }).png().toBuffer();
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff00ff' } })
      .composite([{ input: square, left: 22, top: 22 }]).png().toBuffer();
    const result = await removeKeyBackground(png);
    expect(result.clean).toBe(true);
    const { data, info } = await raw(result.png);
    expect(data[3]).toBe(0);
    expect(data[(32 * info.width + 32) * 4 + 3]).toBe(255);
  });

  it('flags a background that is not one flat colour', async () => {
    const noisy = Buffer.alloc(32 * 32 * 3).map(() => Math.floor(Math.random() * 256));
    const png = await sharp(noisy, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    expect((await removeKeyBackground(png)).clean).toBe(false);
  });
});

describe('makeSeamless', () => {
  it('makes opposite edges meet', async () => {
    // A left-to-right ramp: the raw edges differ by the whole range.
    const w = 64;
    const ramp = Buffer.alloc(w * w * 3);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) ramp.fill(x * 4, (y * w + x) * 3, (y * w + x) * 3 + 3);
    const png = await sharp(ramp, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer();
    const { data, info } = await raw(await makeSeamless(png));
    expect(info.width).toBe(w);
    const row = 10 * info.width * 4;
    const jump = Math.abs(data[row] - data[row + (info.width - 1) * 4]);
    expect(jump).toBeLessThan(40);
  });
});
