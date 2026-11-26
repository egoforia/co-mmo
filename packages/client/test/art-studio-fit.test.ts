import { describe, expect, it } from 'vitest';
import { pictureBox } from '../src/art-studio/canvas.ts';
import { FitDraft, clampFit } from '../src/art-studio/fit-tool.ts';
import { studioKey } from '../src/art-studio/keys.ts';
import { fittedAt } from '../src/tile-stand.ts';

describe('a fit applied where a picture stands', () => {
  it('moves it by its offset at the size it is drawn, and trims its size', () => {
    expect(fittedAt({ x: 100, y: 50, scale: 0.5 }, { offset: [10, -4] })).toEqual({ x: 105, y: 48, scale: 0.5 });
    expect(fittedAt({ x: 100, y: 50, scale: 1 }, { offset: [10, 0], scale: 0.9 })).toEqual({ x: 109, y: 50, scale: 0.9 });
    expect(fittedAt({ x: 100, y: 50, scale: 1 }, undefined)).toEqual({ x: 100, y: 50, scale: 1 });
  });

  it('moves a mirrored tree or rock the other way across', () => {
    expect(fittedAt({ x: 100, y: 50, scale: 1 }, { offset: [10, 2] }, true)).toEqual({ x: 90, y: 52, scale: 1 });
  });

  it('draws the canvas picture where the game puts it after the fit', () => {
    const floor = { left: 0, top: 0, right: 1, bottom: 1 };
    const plain = pictureBox(floor, { width: 100, height: 100 }, false);
    const moved = pictureBox(floor, { width: 100, height: 100 }, false, { offset: [6, -3] });
    expect(moved.x - plain.x).toBeCloseTo(6);
    expect(moved.y - plain.y).toBeCloseTo(-3);
  });
});

describe('the Offset tool', () => {
  it('keeps fits to whole pixels within limits and trims between 85 and 115 %', () => {
    expect(clampFit({ offset: [3.6, -999], scale: 2 })).toEqual({ offset: [4, -256], scale: 1.15 });
  });

  it('steps back through changes, a whole drag as one step', () => {
    const d = new FitDraft({ offset: [2, 0] });
    expect(d.changed).toBe(false);
    d.nudge(1, 0);
    d.mark();
    d.set({ offset: [5, 5], scale: 1 }, false);
    d.set({ offset: [9, 9], scale: 1 }, false);
    expect(d.state.offset).toEqual([9, 9]);
    expect(d.changed).toBe(true);
    d.undo();
    expect(d.state.offset).toEqual([3, 0]);
    d.undo();
    expect(d.state.offset).toEqual([2, 0]);
    expect(d.undo()).toBe(false);
  });

  it('nudges with the arrows, 10 px with Shift, and steps back with Ctrl Z', () => {
    const press = (key: string, more = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...more });
    expect(studioKey(press('ArrowLeft'), false)).toEqual({ nudge: [-1, 0] });
    expect(studioKey(press('ArrowDown', { shiftKey: true }), false)).toEqual({ nudge: [0, 10] });
    expect(studioKey(press('z', { ctrlKey: true }), false)).toEqual({ undo: true });
    expect(studioKey(press('z', { metaKey: true }), false)).toEqual({ undo: true });
    expect(studioKey(press('ArrowLeft'), true)).toBeUndefined();
  });
});
