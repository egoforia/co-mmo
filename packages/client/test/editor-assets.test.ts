import { describe, expect, it } from 'vitest';
import { Tile, generateRegion, regionDef, type TilePoint } from '@co-mmo/shared';
import { pickable } from '../src/editor/asset-picker.ts';
import { EditorCore } from '../src/editor/core.ts';

// Things to place are chosen from their pictures: the forms draw a picture
// button for them, the picker filters and orders them, and a making tool
// says before a click whether the spot will do and what it would stand there.

const map = generateRegion(regionDef('sanctum')!);
const choices = [
  { id: 'a', name: 'Oak table', art: 'a', size: [2, 1] as [number, number] },
  { id: 'b', name: 'Stone bench', art: 'b' },
  { id: 'c', name: 'Oak stool', art: 'c' },
];

function openGround(): TilePoint {
  for (let y = 10; y < map.height - 10; y++) for (let x = 10; x < map.width - 10; x++) if (map.tiles[y * map.width + x] === Tile.Ground) return [x, y];
  throw new Error('no open ground');
}

describe('the asset picker', () => {
  it('finds by name, keeps starred pictures first, and filters', () => {
    expect(pickable(choices, 'all', 'oak', [], []).map((c) => c.id)).toEqual(['a', 'c']);
    expect(pickable(choices, 'all', '', ['c'], []).map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(pickable(choices, 'kept', '', ['b'], []).map((c) => c.id)).toEqual(['b']);
    expect(pickable(choices, 'recent', '', [], ['c', 'a']).map((c) => c.id)).toEqual(['c', 'a']);
    expect(pickable(choices, 'land', '', [], [], new Set(['b'])).map((c) => c.id)).toEqual(['b']);
    expect(pickable(choices, 'unpainted', '', [], [], new Set(), (art) => art !== 'a').map((c) => c.id)).toEqual(['a']);
  });

  it('draws a picture button for things placed, and sets the choice by its input name', () => {
    const core = new EditorCore();
    core.choose('furniture');
    expect(core.settingsHtml()).toContain('data-asset-field="asset"');
    expect(core.settingsHtml()).not.toContain('<select name="asset"');
    const found = core.assetChoices('asset')!;
    expect(found.label).toBe('Piece');
    expect(found.choices.every((c) => c.art && c.size)).toBe(true);
    core.set('asset', found.choices[1]!.id);
    expect(core.assetChoices('asset')!.value).toBe(found.choices[1]!.id);
    // The inspector's look of a person is chosen the same way.
    const amala = map.npcs.find((n) => n.id === 'sister-amala')!;
    core.choose('select');
    core.press('sanctum', map, [Math.floor(amala.x), Math.floor(amala.y)], 0);
    expect(core.settingsHtml()).toContain('data-asset-field="insp.person.look"');
    expect(core.assetChoices('insp.person.look')!.value).toBe(amala.asset);
  });

  it('says before a click whether a person fits there, and what they look like', () => {
    const core = new EditorCore();
    core.choose('person');
    const fits = core.aimAt(map, openGround(), 0)!;
    expect(fits.problem).toBeUndefined();
    expect(fits.character).toBe(true);
    expect(fits.art).toBe(core.assetChoices('look')!.value);
    expect(core.aimAt(map, [-5, -5], 0)!.problem).toBeTruthy();
    core.choose('select');
    expect(core.aimAt(map, openGround(), 0)).toBeUndefined();
  });
});
