import { describe, expect, it } from 'vitest';
import { centreFit, type BaseMeasure } from '../src/art-studio/auto-centre.ts';
import type { StudioAsset } from '../src/art-studio/browser.ts';
import { pictureBox } from '../src/art-studio/canvas.ts';
import { centreHtml, centreTargets, proposalMoves, proposals } from '../src/art-studio/centre-page.ts';
import { studioKey } from '../src/art-studio/keys.ts';
import { PROJECTION } from '../src/projection.ts';

const m = (x: number, y: number, width: number, sure: 'high' | 'low' = 'high'): BaseMeasure => ({ width: 256, height: 256, base: { x, y, width }, bottom: y + 5, sure });
const asset = (id: string, group: string, more: Partial<StudioAsset> = {}): StudioAsset => ({ id, name: id, group, status: 'painted', place: { tab: 'biomes' }, ...more });

describe('auto-centre', () => {
  for (const floor of [{ left: 0, top: 0, right: 1, bottom: 1 }, { left: 0, top: 0, right: 2, bottom: 1 }]) {
    for (const fitted of [false, true]) {
      it(`stands the foot on the middle of a ${floor.right} × 1 diamond (${fitted ? 'isometric' : 'older'} picture)`, () => {
        const measure = m(150, 230, 90);
        const fit = centreFit(measure, floor, fitted, false);
        const box = pictureBox(floor, { width: 256, height: 256 }, fitted, { offset: fit.offset, scale: fit.scale });
        const middle = PROJECTION.toScreen(floor.right / 2, 0.5);
        expect(Math.abs(box.x + 150 * box.scale - middle.x)).toBeLessThanOrEqual(box.scale);
        expect(Math.abs(box.y + 230 * box.scale - middle.y)).toBeLessThanOrEqual(box.scale);
      });
    }
  }

  it('trims the size of a foot far wider than its tiles, within the limit, only when asked', () => {
    const floor = { left: 0, top: 0, right: 1, bottom: 1 };
    expect(centreFit(m(128, 230, 250), floor, false, true).scale).toBe(0.85);
    expect(centreFit(m(128, 230, 250), floor, false, false).scale).toBe(1);
    expect(centreFit(m(128, 230, 120), floor, false, true).scale).toBe(1);
  });

  it('proposes for a group, ticking only sure ones that move', () => {
    const list = proposals(
      [asset('a', 'spots'), asset('b', 'spots'), asset('c', 'pieces')],
      { a: m(200, 230, 80), b: m(100, 230, 80, 'low'), c: { why: 'It has no see-through edges to find its foot from.' } },
      {},
    );
    expect(list.map((p) => !!p.fit)).toEqual([true, true, false]);
    expect(proposalMoves(list[0]!)).toBe(true);
    const html = centreHtml(list);
    expect(html).toContain('value="a" checked');
    expect(html).not.toContain('value="b" checked');
    expect(html).toContain('no see-through edges');
    expect(centreTargets([asset('x', 'characters'), asset('y', 'scenery')]).map((a) => a.id)).toEqual(['y']);
  });

  it('stands found feet on the left, front and right corners of the tiles', () => {
    for (const floor of [{ left: 0, top: 0, right: 2, bottom: 1 }, { left: 0, top: 0, right: 1, bottom: 1 }]) {
      for (const fitted of [true]) {
        // An isometric picture with its feet a little in from its sides (13..243 of 256), so it must grow to reach the corners.
        const run = floor.right - floor.left;
        const front = { x: 13 + (230 * run) / (run + 1), y: 240 };
        const feet = { left: { foot: { x: 13, y: 240 - (115 * run) / (run + 1) }, degrees: 26.6, judged: true }, front, right: { foot: { x: 243, y: 240 - 115 / (run + 1) }, degrees: 26.6, judged: true } };
        const fit = centreFit({ ...m(120, 230, 200), feet }, floor, fitted, true);
        const box = pictureBox(floor, { width: 256, height: 256 }, fitted, { offset: fit.offset, scale: fit.scale });
        const at = (p: { x: number; y: number }) => ({ x: box.x + p.x * box.scale, y: box.y + p.y * box.scale });
        const corners = [PROJECTION.toScreen(floor.left, floor.bottom), PROJECTION.toScreen(floor.right, floor.bottom), PROJECTION.toScreen(floor.right, floor.top)];
        const placed = [at(feet.left.foot), at(front), at(feet.right.foot)];
        // Whole pixels and a size kept within its limits leave each foot within a few pixels of its corner.
        placed.forEach((p, i) => {
          expect(Math.abs(p.x - corners[i]!.x)).toBeLessThan(2);
          expect(Math.abs(p.y - corners[i]!.y)).toBeLessThan(2);
        });
      }
    }
  });

  it('keeps to the middle when a base edge could not be read', () => {
    const floor = { left: 0, top: 0, right: 1, bottom: 1 };
    const feet = { left: { foot: { x: 20, y: 200 }, degrees: 26.6, judged: false }, front: { x: 120, y: 240 }, right: { foot: { x: 220, y: 200 }, degrees: 26.6, judged: true } };
    expect(centreFit({ ...m(150, 230, 90), feet }, floor, true, false)).toEqual(centreFit(m(150, 230, 90), floor, true, false));
  });

  it('lists the pictures painted at the wrong angle, and says why', () => {
    const list = proposals(
      [asset('rack', 'pieces', { footprint: { width: 2, height: 1 } }), asset('pot', 'pieces', { footprint: { width: 1, height: 1 } })],
      {
        rack: { ...m(120, 230, 200), verdict: { ok: false, words: 'Painted at the wrong angle: its right edge at 39°, where the tiles slope at 27°. Paint it again.' } },
        pot: { ...m(120, 230, 200), verdict: { ok: true, words: "Its base runs at the tiles' angle (left 27°)." } },
      },
      {},
    );
    const html = centreHtml(list);
    expect(html).toContain('1 of 2 are painted at the wrong angle');
    expect(html).toContain('<small class="bad">Painted at the wrong angle: its right edge at 39°');
    expect(html).toContain("Its base runs at the tiles&#39; angle");
  });

  it('centres with C', () => {
    expect(studioKey({ key: 'c', ctrlKey: false, altKey: false, metaKey: false }, false)).toEqual({ centre: true });
  });
});
