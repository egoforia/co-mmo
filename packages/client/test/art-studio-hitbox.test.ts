import { describe, expect, it } from 'vitest';
import { PROJECTION } from '../src/projection.ts';
import { FitDraft, type FitState } from '../src/art-studio/fit-tool.ts';
import { alikeAssets, blockedOf, tileUnder, toggleTile } from '../src/art-studio/hitbox-tool.ts';
import { studioKey } from '../src/art-studio/keys.ts';
import type { StudioAsset } from '../src/art-studio/browser.ts';

const plain: FitState = { offset: [0, 0], scale: 1 };

describe('the Hitbox tool', () => {
  it('blocks every tile until some are chosen', () => {
    expect(blockedOf(plain, 2, 1)).toEqual([[0, 0], [1, 0]]);
    expect(blockedOf({ blocks: [[1, 0]] }, 2, 1)).toEqual([[1, 0]]);
  });

  it('opens and blocks tiles, keeps one, and leaves the hitbox out when all block', () => {
    const one = toggleTile(plain, [0, 0], 2, 1);
    expect(one.blocks).toEqual([[1, 0]]);
    expect(toggleTile(one, [1, 0], 2, 1)).toBe(one);
    const back = toggleTile(one, [0, 0], 2, 1);
    expect(back).toEqual(plain);
    expect(toggleTile(plain, [5, 0], 2, 1)).toBe(plain);
    expect(toggleTile({ ...plain, offset: [3, 1] }, [1, 0], 2, 1)).toEqual({ offset: [3, 1], scale: 1, blocks: [[0, 0]] });
  });

  it('reaches two tiles past the footprint, for a picture painted wider', () => {
    const wider = toggleTile(plain, [-1, 0], 2, 1);
    expect(wider.blocks).toEqual([[-1, 0], [0, 0], [1, 0]]);
    expect(blockedOf(wider, 2, 1)).toEqual([[-1, 0], [0, 0], [1, 0]]);
    expect(toggleTile(wider, [-1, 0], 2, 1)).toEqual(plain);
    expect(toggleTile(plain, [3, 2], 2, 1).blocks).toEqual([[0, 0], [1, 0], [3, 2]]);
    expect(toggleTile(plain, [-3, 0], 2, 1)).toBe(plain);
    expect(toggleTile(plain, [4, 0], 2, 1)).toBe(plain);
  });

  it('finds the tile under a point of the ground', () => {
    const middle = (x: number, y: number) => PROJECTION.toScreen(x + 0.5, y + 0.5);
    expect(tileUnder(middle(0, 0))).toEqual([0, 0]);
    expect(tileUnder(middle(1, 0))).toEqual([1, 0]);
    expect(tileUnder(middle(2, 3))).toEqual([2, 3]);
    expect(tileUnder(middle(-1, 0))).toEqual([-1, 0]);
  });

  it('keeps the chosen tiles in the fit, undone step by step', () => {
    const d = new FitDraft({ offset: [2, 0] });
    d.set(toggleTile(d.state, [0, 0], 2, 1));
    expect(d.changed).toBe(true);
    expect(d.fit).toEqual({ offset: [2, 0], blocks: [[1, 0]] });
    d.nudge(1, 0);
    expect(d.state.blocks).toEqual([[1, 0]]);
    d.undo();
    d.undo();
    expect(d.changed).toBe(false);
    expect(new FitDraft({ offset: [0, 0], blocks: [[1, 0]] }).state.blocks).toEqual([[1, 0]]);
  });

  it('turns on with B', () => {
    expect(studioKey({ key: 'b', ctrlKey: false, altKey: false, metaKey: false }, false)).toEqual({ hitbox: true });
    expect(studioKey({ key: 'b', ctrlKey: false, altKey: false, metaKey: false }, true)).toBeUndefined();
  });

  it('finds the other set pieces shown with the same footprint', () => {
    const piece = (id: string, width: number, group = 'pieces') => ({ id, name: id, group, footprint: { width, height: 1 } }) as StudioAsset;
    const shrine = piece('shrine', 2);
    expect(alikeAssets(shrine, [shrine, piece('altar', 2), piece('well', 1), piece('spot', 2, 'spots'), piece('bench', 1.6)]).map((a) => a.id)).toEqual(['altar', 'bench']);
  });
});
