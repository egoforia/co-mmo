import { describe, expect, it } from 'vitest';
import { EDIT_KINDS, Tile, buildFloors, checkEdit, CREATURES, generateRegion, regionDef, type TilePoint } from '@co-mmo/shared';
import { EditorCore } from '../src/editor/core.ts';

// The editor core both views share: the tools come from the registry, the
// settings start where the old windows started, and what a press makes is a
// draft the server accepts.

const map = generateRegion(regionDef('sanctum')!);
const shop = map.buildings.find((b) => b.style === 'sanctum-arcanum')!;
const inShop: TilePoint = [shop.x + Math.floor(shop.width / 2), shop.y + Math.floor(shop.height / 2)];

/** An open tile of ground, for tools that need one. */
function openGround(): TilePoint {
  for (let y = 10; y < map.height - 10; y++) for (let x = 10; x < map.width - 10; x++) if (map.tiles[y * map.width + x] === Tile.Ground) return [x, y];
  throw new Error('no open ground');
}

describe('the editor core', () => {
  it('offers Look and every kind of edit there is', () => {
    const ids = new EditorCore().tools().map((t) => t.id);
    expect(ids[0]).toBe('look');
    for (const kind of Object.values(EDIT_KINDS)) if (kind.available?.() ?? true) expect(ids).toContain(kind.kind);
  });

  it('draws each setting named by its key, short counts as lists', () => {
    const core = new EditorCore();
    core.choose('floors');
    const html = core.settingsHtml();
    expect(html).toContain('<select name="up">');
    expect(html).toContain('<select name="down">');
    expect(html).toContain('name="ladders"');
    core.choose('paint');
    expect(core.settingsHtml()).toContain('<select name="tile">');
    core.choose('spawn');
    expect(core.settingsHtml()).toContain('<input name="count" type="number"');
  });

  it('makes floors for the building clicked, by its name', () => {
    const core = new EditorCore();
    core.choose('floors');
    core.set('down', '1');
    const step = core.press('sanctum', map, inShop, 0);
    expect(step.draft).toMatchObject({ kind: 'floors', up: 1, down: 1, target: shop.id });
    expect(checkEdit(map, step.draft!, CREATURES)).toBeUndefined();
  });

  it('lays a brush stroke when the pointer is let go', () => {
    const core = new EditorCore();
    core.choose('paint');
    core.set('brush', '3');
    const [x, y] = openGround();
    expect(core.press('sanctum', map, [x, y], 0)).toEqual({});
    core.drag('sanctum', map, [x + 1, y]);
    const step = core.release();
    expect(step.draft).toMatchObject({ kind: 'paint', tile: 'tree' });
    expect(step.draft && 'tiles' in step.draft && step.draft.tiles.length).toBe(12);
    expect(core.release()).toEqual({});
  });

  it('runs a road from the first click to the second', () => {
    const core = new EditorCore();
    core.choose('road');
    expect(core.press('sanctum', map, [10, 10], 0).say).toMatch(/ends/);
    expect(core.press('sanctum', map, [20, 12], 0).draft).toEqual({ kind: 'road', from: [10, 10], to: [20, 12] });
  });

  it('picks a tree up and puts it down, or takes it away', () => {
    let tree: TilePoint | undefined;
    for (let i = 0; i < map.tiles.length && !tree; i++) if (map.tiles[i] === Tile.Tree) tree = [i % map.width, Math.floor(i / map.width)];
    const core = new EditorCore();
    core.choose('move');
    expect(core.press('sanctum', map, tree!, 0).say).toMatch(/Picked up a tree/);
    expect(core.holding()).toBe(true);
    expect(core.settingsHtml()).toContain('data-away');
    expect(core.takeAway(0).draft).toEqual({ kind: 'move', from: tree, to: null, level: 0 });
    expect(core.holding()).toBe(false);
  });

  it('keeps the floor shown on tools that work on every floor', () => {
    const copy = generateRegion(regionDef('sanctum')!);
    buildFloors(copy, copy.buildings.find((b) => b.style === 'sanctum-arcanum')!, 1, 0);
    const core = new EditorCore();
    core.choose('spawn');
    expect(core.press('sanctum', copy, inShop, 1).draft).toMatchObject({ kind: 'spawn', level: 1 });
    core.choose('house');
    expect(core.press('sanctum', copy, openGround(), 1).draft).not.toHaveProperty('level');
  });

  it('outlines what the tool would touch', () => {
    const core = new EditorCore();
    core.choose('clear');
    core.set('radius', '2');
    expect(core.outlines('sanctum', map, [30, 30], 0)).toEqual([{ x: 28, y: 28, w: 5, h: 5, tone: 'warn' }]);
    core.choose('floors');
    expect(core.outlines('sanctum', map, inShop, 0)).toEqual([{ x: shop.x, y: shop.y, w: shop.width, h: shop.height }]);
  });
});
