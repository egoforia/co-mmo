import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, BUILDING_STYLES, CREATURES, EDIT_KINDS, SPOTS, Tile, checkEdit, copyDraft, generateRegion, pickAt, stampEdit, tunedCreature, type WorldEdit, type WorldEditDraft } from '../src/index.ts';

// The rest of the editor's group B: loot from a spawn, lights on their own,
// buildings given another look or size, and gathering spots scattered.

const creatures = Object.fromEntries(Object.entries(CREATURES).map(([id, c]) => [id, { name: c.name, art: c.art, level: c.level }]));

/** The testbed with drafts laid over it, as the editor lays them. */
function lay(drafts: WorldEditDraft[]) {
  const edits: WorldEdit[] = drafts.map((d, i) => stampEdit(d, { id: `x${i}`, by: 'Test', made: 0 }, creatures));
  return generateRegion({ ...ARCH_TESTBED_REGION, edits });
}

const at: [number, number] = [150, 120];
const plain = generateRegion(ARCH_TESTBED_REGION);

describe('the world editor\'s extras', () => {
  it('gives a spawn loot of its own, on top of its kind\'s', () => {
    const spawn = EDIT_KINDS.spawn.make({ at }, { creature: 'thorn-wolf', count: 1, monsterLevel: 0, behavior: 'own', active: 'own', loot: 'tonic', lootChance: 40 });
    expect(spawn).toMatchObject({ loot: 'tonic', lootChance: 40 });
    expect(checkEdit(plain, spawn, creatures)).toBeUndefined();
    const wolf = lay([spawn]).creatures.find((c) => c.spawn === 'x0')!;
    expect(tunedCreature(CREATURES['thorn-wolf']!, wolf).drops.at(-1)).toEqual({ item: 'tonic', chance: 0.4 });
    expect(checkEdit(plain, { ...spawn, loot: 'moonbeam' }, creatures)).toMatch(/cannot leave/);
  });

  it('stands a light on its own on any floor, to pick, copy and take away', () => {
    const draft = { ...EDIT_KINDS.light.make({ at }, { color: 'arcane', radius: 2, flicker: true }), level: 0 };
    expect(draft).toMatchObject({ kind: 'light', color: '#c49bff', radius: 2, flicker: true });
    expect(checkEdit(plain, draft, creatures)).toBeUndefined();
    const map = lay([draft]);
    expect(map.lights).toEqual([{ id: 'x0', x: 150.5, y: 120.5, floor: 0, light: { color: '#c49bff', radius: 2, flicker: true } }]);
    expect(checkEdit(map, draft, creatures)).toBe('A light already shines there.');
    const picked = pickAt(map, at, 0)!;
    expect(picked.kind).toBe('light');
    expect(copyDraft(map, picked, [152, 120])).toEqual({ kind: 'light', at: [152, 120], color: '#c49bff', radius: 2, flicker: true });
    expect(lay([draft, { kind: 'remove', at }]).lights).toEqual([]);
  });

  it('gives a building another look, or lays it again at another size', () => {
    const style = Object.values(BUILDING_STYLES).find((s) => s.kit)!.id;
    const other = Object.values(BUILDING_STYLES).find((s) => s.id !== style)!.id;
    const house: WorldEditDraft = { kind: 'house', at: [150, 100], floor: [6, 6], style };
    const built = lay([house]);
    const b = built.buildings.find((t) => t.x === 150 && t.y === 100)!;
    const restyle = EDIT_KINDS.restyle.make({ at: [151, 101], target: b.id }, { style: other, width: 0, depth: 0 });
    expect(restyle).toEqual({ kind: 'restyle', at: [151, 101], target: b.id, style: other });
    expect(checkEdit(built, restyle, creatures)).toBeUndefined();
    expect(lay([house, restyle]).buildings.find((t) => t.id === b.id)).toMatchObject({ style: other, width: 8, height: 8 });
    // Bigger, from the same corner, and still named the same.
    const bigger = EDIT_KINDS.restyle.make({ at: [151, 101], target: b.id }, { style, width: 10, depth: 8 });
    expect(checkEdit(built, bigger, creatures)).toBeUndefined();
    expect(lay([house, bigger]).buildings.find((t) => t.id === b.id)).toMatchObject({ x: 150, y: 100, width: 12, height: 10 });
    expect(checkEdit(built, { ...restyle, at: [5, 5], target: undefined }, creatures)).toBe('Click a building to change it.');
    expect(checkEdit(built, { ...bigger, floor: [1, 1] }, creatures)).toMatch(/tiles a side/);
  });

  it('scatters gathering spots round the one clicked', () => {
    const kind = Object.keys(SPOTS)[0]!;
    const draft = EDIT_KINDS.spot.make({ at }, { spot: kind, count: 5 });
    expect(draft).toEqual({ kind: 'spot', spot: kind, at, count: 5 });
    const spots = lay([draft]).spots.filter((s) => s.id.startsWith('x0'));
    expect(spots.length).toBe(5);
    expect(spots[0]).toMatchObject({ x: at[0], y: at[1] });
    expect(spots.every((s) => lay([draft]).tiles[s.y * plain.width + s.x] === Tile.Blocked)).toBe(true);
  });
});
