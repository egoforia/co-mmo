import { describe, expect, it } from 'vitest';
import { canvasFloor, nextZoom, pictureBox } from '../src/art-studio/canvas.ts';
import { versionsHtml, versionsOf } from '../src/art-studio/versions.ts';
import { canvasHash, hashPage, workspaceOf } from '../src/art-studio/workspaces.ts';
import { standing } from '../src/tile-stand.ts';

describe('the Studio canvas', () => {
  it('stands an asset on its footprint, rounded up to whole tiles, or on one tile', () => {
    expect(canvasFloor({ footprint: { width: 2, height: 1 } })).toEqual({ left: 0, top: 0, right: 2, bottom: 1 });
    expect(canvasFloor({ footprint: { width: 1.5, height: 1 } })).toEqual({ left: 0, top: 0, right: 2, bottom: 1 });
    expect(canvasFloor({})).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('puts the picture where the game stands it', () => {
    const floor = { left: 0, top: 0, right: 2, bottom: 1 };
    for (const fitted of [true, false]) {
      const size = { width: 256, height: 200 };
      const plan = standing(floor, size, fitted);
      const box = pictureBox(floor, size, fitted);
      expect(box.x + box.width / 2).toBeCloseTo(plan.x);
      expect(box.y + box.height * plan.originY).toBeCloseTo(plan.y);
      expect(box.width).toBeCloseTo(256 * plan.scale);
    }
  });

  it('zooms in steps from 50 to 400 %', () => {
    expect(nextZoom(100, 1)).toBe(150);
    expect(nextZoom(100, -1)).toBe(75);
    expect(nextZoom(400, 1)).toBe(400);
    expect(nextZoom(50, -1)).toBe(50);
  });

  it('opens on #art/canvas in the Place workspace, and leaves other pages to art-ui', () => {
    expect(hashPage(canvasHash('sanctum-shrine'), 'entities')).toBe('canvas');
    expect(hashPage('#art/items/Weapons', 'items')).toBe('items');
    expect(workspaceOf('canvas')?.id).toBe('place');
  });
});

describe('the Versions dock', () => {
  const item = { id: 'rock', url: '/a/now.png', versions: [{ id: 'lzx1', url: '/a/old.png' }], shipped: { url: '/art/rock.png' } };

  it('lists the one shown now, earlier ones, then the shipped one', () => {
    expect(versionsOf(item).map((v) => v.id)).toEqual(['now', 'lzx1', 'shipped']);
  });

  it('lays the chosen version against the one shown now, with a way to put it back', () => {
    const html = versionsHtml(item, 'shipped');
    expect(html).toContain('data-restore="shipped"');
    expect(html).toContain('src="/art/rock.png"');
    expect(versionsHtml({ id: 'x', url: '/n.png' }, undefined)).toContain('Only the one shown now');
  });
});
