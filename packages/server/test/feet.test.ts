import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { GROUND_DEGREES, judgeBase, measureFeet } from '../src/assets/feet.ts';
import { measureBase } from '../src/art-studio/auto-fit.ts';

type P = [number, number];

/** A test picture: solid shapes on see-through, as a painted piece looks once its magenta is cut away. */
async function picture(shapes: string): Promise<{ png: Buffer; alpha: Uint8Array; width: number; height: number }> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${shapes}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const { data, info } = await sharp(png).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  return { png, alpha: new Uint8Array(data), width: info.width, height: info.height };
}

/** A block standing on `w` by `d` tiles, its base edges sloping `rise` down for each 1 across (0.5 is the game's ground). */
function block(w: number, d: number, rise = 0.5, half = 60, tall = 120): { shape: string; left: P; front: P; right: P } {
  const left: P = [40, 360 - w * half * rise];
  const front: P = [40 + w * half, 360];
  const right: P = [40 + (w + d) * half, 360 - d * half * rise];
  const back: P = [40 + d * half, left[1] - d * half * rise];
  const pts = [left, front, right, [right[0], right[1] - tall], [back[0], back[1] - tall], [left[0], left[1] - tall]];
  return { shape: `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="#7a5a3a"/>`, left, front, right };
}

describe('the base check', () => {
  it('finds the feet of a block standing square on its tiles, and passes it', async () => {
    const b = block(2, 1);
    const { alpha, width, height } = await picture(b.shape);
    const feet = measureFeet(alpha, width, height)!;
    expect(feet.front.x).toBeCloseTo(b.front[0], -1);
    expect(feet.front.y).toBeCloseTo(b.front[1] - 1, -1);
    expect(feet.left.foot.x).toBeCloseTo(b.left[0], -1);
    expect(feet.right.foot.x).toBeCloseTo(b.right[0] - 1, -1);
    expect(feet.left.judged && feet.right.judged).toBe(true);
    expect(Math.abs(feet.left.degrees - GROUND_DEGREES)).toBeLessThan(2);
    expect(judgeBase(feet, { width: 2, height: 1 })).toMatchObject({ ok: true });
  });

  it('calls a base painted at a shallower angle wrong, saying which edge and how far', async () => {
    const { alpha, width, height } = await picture(block(2, 1, 0.29).shape);
    const verdict = judgeBase(measureFeet(alpha, width, height), { width: 2, height: 1 });
    expect(verdict.ok).toBe(false);
    expect(verdict.words).toMatch(/^Painted at the wrong angle: its left edge at 16°.*where the tiles slope at 27°/);
  });

  it('calls a block turned the other way, or too square for its tiles, wrong', async () => {
    const turned = await picture(block(1, 2).shape);
    expect(judgeBase(measureFeet(turned.alpha, turned.width, turned.height), { width: 2, height: 1 }).words).toMatch(/^Turned the other way: its long side runs to the right, but its tiles run 2 tiles to the left and 1 tile to the right/);
    const square = await picture(block(1.5, 1.5).shape);
    expect(judgeBase(measureFeet(square.alpha, square.width, square.height), { width: 2, height: 1 }).words).toMatch(/^Too square for its tiles/);
    // The same square block is right on square tiles.
    expect(judgeBase(measureFeet(square.alpha, square.width, square.height), { width: 1, height: 1 }).ok).toBe(true);
  });

  it('does not judge the angle of a round base', async () => {
    const pot = await picture('<ellipse cx="200" cy="250" rx="120" ry="110" fill="#a05030"/>');
    expect(judgeBase(measureFeet(pot.alpha, pot.width, pot.height), { width: 1, height: 1 }).ok).toBeUndefined();
  });

  it('reads legs standing apart as a base edge from foot to foot', async () => {
    // A rack seen nearly from the front: its legs stand on a line far shallower than the ground's.
    const legs = await picture('<rect x="60" y="60" width="280" height="80" fill="#753"/><rect x="60" y="60" width="16" height="300" fill="#753"/><rect x="324" y="60" width="16" height="250" fill="#753"/>');
    const feet = measureFeet(legs.alpha, legs.width, legs.height)!;
    expect(feet.right.judged).toBe(true);
    expect(judgeBase(feet, { width: 1, height: 1 }).words).toMatch(/^Painted at the wrong angle: its right edge at 11°/);
  });

  it("leaves a canopy's overhang out of the base", async () => {
    const b = block(1, 1);
    // A wide roof overhanging the block high up: steeper than any ground line from the base.
    const { alpha, width, height } = await picture(`${b.shape}<polygon points="10,40 190,10 380,40 380,60 10,60" fill="#5a7a3a"/>`);
    const feet = measureFeet(alpha, width, height)!;
    expect(feet.left.foot.x).toBeCloseTo(b.left[0], -1);
    expect(feet.right.foot.x).toBeCloseTo(b.right[0] - 1, -1);
  });

  it('is part of the Studio’s free measure', async () => {
    const { png } = await picture(block(2, 1).shape);
    const m = (await measureBase(png))!;
    expect(m.feet?.left.judged).toBe(true);
  });
});
