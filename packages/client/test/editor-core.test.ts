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
    expect(ids.slice(0, 2)).toEqual(['look', 'select']);
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

  it('picks a building, then copies or moves it with the next click', () => {
    const core = new EditorCore();
    core.choose('select');
    expect(core.press('sanctum', map, inShop, 0).say).toMatch(/^Picked /);
    expect(core.settingsHtml()).toContain('data-pick="move"');
    expect(core.outlines('sanctum', map, [10, 10], 0)[0]).toMatchObject({ x: shop.x, y: shop.y, tone: 'held' });
    core.pickAction('copy');
    expect(core.press('sanctum', map, [20, 20], 0).draft).toEqual({ kind: 'house', at: [20, 20], floor: [shop.width - 2, shop.height - 2], style: shop.style });
    core.choose('select');
    core.press('sanctum', map, inShop, 0);
    core.pickAction('move');
    const moved = core.press('sanctum', map, [20, 20], 0);
    expect(moved.drafts?.map((d) => d.kind)).toEqual(['remove', 'house']);
    expect(moved.drafts?.[0]).toMatchObject({ target: shop.id });
  });

  it('draws a bookmark\'s name as a line of text', () => {
    const core = new EditorCore();
    core.choose('bookmark');
    core.set('name', 'Front door');
    expect(core.settingsHtml()).toContain('name="name" type="text" maxlength="40" value="Front door"');
    expect(core.press('sanctum', map, [30, 30], 1).draft).toEqual({ kind: 'bookmark', at: [30.5, 30.5], name: 'Front door', level: 1 });
  });

  it('picks a person, moves them to the floor shown, and loads them into the Person tool to change', () => {
    const core = new EditorCore();
    const amala = map.npcs.find((n) => n.id === 'sister-amala')!;
    const at: TilePoint = [Math.floor(amala.x), Math.floor(amala.y)];
    core.choose('select');
    expect(core.press('sanctum', map, at, 0).say).toBe('Picked Sister Amala.');
    expect(core.settingsHtml()).toContain('data-pick="change"');
    core.pickAction('move');
    expect(core.press('sanctum', map, [30, 30], 1).draft).toEqual({ kind: 'person', at: [30, 30], target: 'sister-amala', level: 1 });
    core.press('sanctum', map, at, 0);
    expect(core.pickAction('change').say).toMatch(/click Sister Amala/);
    expect(core.tool).toBe('person');
    expect(core.settingsHtml()).toContain('value="Sister Amala"');
    const change = core.press('sanctum', map, at, 0).draft!;
    expect(change).toMatchObject({ kind: 'person', target: 'sister-amala', name: 'Sister Amala', look: amala.asset, shop: { teaches: [{ ability: 'mend' }] } });
    expect(checkEdit(map, change, CREATURES)).toBeUndefined();
  });

  it('draws a patrol path from a monster\'s home with a drag, and lays a spawn at another level', () => {
    const core = new EditorCore();
    const home = map.creatures[0]!;
    const at: TilePoint = [Math.floor(home.x), Math.floor(home.y)];
    core.choose('patrol');
    core.press('sanctum', map, at, 0);
    for (let x = 1; x <= 6; x++) core.drag('sanctum', map, [at[0] + x, at[1]]);
    expect(core.release().draft).toEqual({ kind: 'patrol', at, route: [[at[0] + 1, at[1]], [at[0] + 4, at[1]], [at[0] + 6, at[1]]], level: 0 });
    core.choose('spawn');
    core.set('monsterLevel', '7');
    core.set('behavior', 'chase');
    expect(core.press('sanctum', map, [30, 30], 0).draft).toMatchObject({ kind: 'spawn', monsterLevel: 7, behavior: 'chase', level: 0 });
  });

  it('drags out a rectangle of paint, and copies an area to paste it with each click', () => {
    const core = new EditorCore();
    core.choose('paint');
    core.set('shape', 'rect');
    core.press('sanctum', map, [40, 40], 0);
    core.drag('sanctum', map, [41, 40]);
    core.drag('sanctum', map, [42, 41]);
    expect((core.release().draft as { tiles: TilePoint[] }).tiles).toHaveLength(6);
    core.choose('area');
    expect(core.press('sanctum', map, [shop.x - 1, shop.y - 1], 0).say).toMatch(/opposite corner/);
    expect(core.press('sanctum', map, [shop.x + shop.width, shop.y + shop.height], 0).say).toMatch(/^Copied /);
    const pasted = core.press('sanctum', map, [20, 20], 0).drafts!;
    expect(pasted.find((d) => d.kind === 'house')).toMatchObject({ at: [21, 21], style: shop.style });
    expect(core.settingsHtml()).toContain('data-area="save"');
  });
});
