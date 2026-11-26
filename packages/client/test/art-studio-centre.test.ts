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

  it('centres with C', () => {
    expect(studioKey({ key: 'c', ctrlKey: false, altKey: false, metaKey: false }, false)).toEqual({ centre: true });
  });
});
