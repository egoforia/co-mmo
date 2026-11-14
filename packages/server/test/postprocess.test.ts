import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeSeamless, removeKeyBackground, removeKeySpill } from '../src/assets/postprocess.ts';

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

  it('clears enclosed pockets of key colour only when asked', async () => {
    // A blue ring with magenta inside: the hole is cut off from the border.
    const ring = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#4060c0' } })
      .composite([{ input: await sharp({ create: { width: 14, height: 14, channels: 3, background: '#ff00ff' } }).png().toBuffer(), left: 8, top: 8 }])
      .png().toBuffer();
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff00ff' } })
      .composite([{ input: ring, left: 17, top: 17 }]).png().toBuffer();
    const alphaAtCentre = async (out: Buffer) => {
      const { data, info } = await raw(out);
      return data[(32 * info.width + 32) * 4 + 3];
    };
    expect(await alphaAtCentre((await removeKeyBackground(png)).png)).toBe(255);
    expect(await alphaAtCentre((await removeKeyBackground(png, undefined, { holes: true })).png)).toBe(0);
  });

  it('keeps enclosed pockets when the key is white, since the subject may be white too', async () => {
    // An old anchor on white: a white robe inside a dark outline must survive.
    const outline = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#403020' } })
      .composite([{ input: await sharp({ create: { width: 14, height: 14, channels: 3, background: '#ffffff' } }).png().toBuffer(), left: 8, top: 8 }])
      .png().toBuffer();
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } })
      .composite([{ input: outline, left: 17, top: 17 }]).png().toBuffer();
    const { data, info } = await raw((await removeKeyBackground(png, undefined, { holes: true })).png);
    expect(data[3]).toBe(0);
    expect(data[(32 * info.width + 32) * 4 + 3]).toBe(255);
  });

  it('keeps a subject whose colour is close to an off-magenta backdrop', async () => {
    // A dusty pink backdrop, as some models paint "magenta", around a dusty rose block.
    const block = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#c07888' } }).png().toBuffer();
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#d86aa8' } })
      .composite([{ input: block, left: 20, top: 20 }]).png().toBuffer();
    const result = await removeKeyBackground(png, undefined, { holes: true });
    expect(result.clean).toBe(true);
    expect(result.key).toEqual({ r: 216, g: 106, b: 168 });
    const { data, info } = await raw(result.png);
    expect(data[3]).toBe(0);
    let kept = 0;
    for (let y = 22; y < 42; y++) for (let x = 22; x < 42; x++) if (data[(y * info.width + x) * 4 + 3] === 255) kept++;
    expect(kept).toBe(400);
  });

  it('follows a backdrop that fades from top to bottom', async () => {
    const w = 64;
    const fade = Buffer.alloc(w * w * 3);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) fade.set([255, Math.round(y * 1.2), 255 - Math.round(y * 1.5)], (y * w + x) * 3);
    const square = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#4060c0' } }).png().toBuffer();
    const png = await sharp(fade, { raw: { width: w, height: w, channels: 3 } }).composite([{ input: square, left: 24, top: 24 }]).png().toBuffer();
    const result = await removeKeyBackground(png);
    expect(result.clean).toBe(true);
    const { data, info } = await raw(result.png);
    for (const [x, y] of [[2, 2], [61, 61], [32, 4], [32, 60]]) expect(data[(y * info.width + x) * 4 + 3], `${x},${y}`).toBe(0);
    expect(data[(32 * info.width + 32) * 4 + 3]).toBe(255);
  });

  it('cuts a grainy backdrop in one piece', async () => {
    const w = 64;
    const grain = Buffer.alloc(w * w * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 24;
    for (let i = 0; i < w * w; i++) grain.set([250 + rnd() / 4, 20 + rnd(), 230 + rnd()].map((v) => Math.max(0, Math.min(255, Math.round(v)))), i * 3);
    const square = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#d8c8a0' } }).png().toBuffer();
    const png = await sharp(grain, { raw: { width: w, height: w, channels: 3 } }).composite([{ input: square, left: 22, top: 22 }]).png().toBuffer();
    const result = await removeKeyBackground(png);
    expect(result.clean).toBe(true);
    const { data, info } = await raw(result.png);
    let left = 0;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if ((x < 18 || x > 45 || y < 18 || y > 45) && data[(y * info.width + x) * 4 + 3] > 0) left++;
    expect(left).toBe(0);
    expect(data[(32 * info.width + 32) * 4 + 3]).toBe(255);
  });

  it('flags a background that is not one flat colour', async () => {
    const noisy = Buffer.alloc(32 * 32 * 3).map(() => Math.floor(Math.random() * 256));
    const png = await sharp(noisy, { raw: { width: 32, height: 32, channels: 3 } }).png().toBuffer();
    expect((await removeKeyBackground(png)).clean).toBe(false);
  });
});

describe('removeKeySpill', () => {
  it('clears the cast of whatever backdrop the cut found', async () => {
    // A glow over a green backdrop: strongly green pixels go, greenish ones lose the cast, a plain one stays.
    const px = Buffer.from([30, 230, 40, 255, 140, 200, 130, 255, 120, 110, 100, 255]);
    const png = await sharp(px, { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
    const { data } = await raw(await removeKeySpill(png, 70, { r: 20, g: 240, b: 30 }));
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[5]).toBe(175);
    expect([...data.subarray(8, 12)]).toEqual([120, 110, 100, 255]);
  });

  it('clears magenta, as asked for, when the found backdrop is a dull pink, so rose subjects stay', async () => {
    const px = Buffer.from([250, 30, 245, 255, 210, 120, 140, 255]);
    const png = await sharp(px, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const { data } = await raw(await removeKeySpill(png, 70, { r: 219, g: 89, b: 144 }));
    expect(data[3]).toBe(0);
    expect([...data.subarray(4, 8)]).toEqual([210, 120, 140, 255]);
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
