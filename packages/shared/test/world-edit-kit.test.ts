import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, BUILDING_STYLES, EDIT_KINDS, Tile, buildingKit, checkEdit, designSpec, generateRegion, kitProblems, stampEdit, type FieldValue, type WorldEdit, type WorldEditDraft } from '../src/index.ts';

// The kit building designer: a spec drawn from the editor's settings, checked
// with the kit's own shape checks, laid as a walled building whose kit house
// is built from that spec.

const look = Object.values(BUILDING_STYLES).find((s) => s.kit)!.id;
const plain = Object.values(BUILDING_STYLES).find((s) => !s.kit)!.id;
const settings = (more: Record<string, FieldValue> = {}): Record<string, FieldValue> => ({
  style: look, across: 3, deep: 3, storeys: 1, door: 1, windows: 'every-other', roof: 'gable', battlements: false, towers: 'none', dome: false, chimney: true, ...more,
});

/** The testbed with drafts laid over it, as the editor lays them. */
function lay(drafts: WorldEditDraft[]) {
  const edits: WorldEdit[] = drafts.map((d, i) => stampEdit(d, { id: `k${i}`, by: 'Test', made: 0 }, {}));
  return generateRegion({ ...ARCH_TESTBED_REGION, edits });
}

describe('the kit building designer', () => {
  it('draws a spec from its settings that holds together, crowns and all', () => {
    expect(designSpec(settings())).toMatchObject({ W: 3, D: 3, roof: true, storeys: [{ left: { 1: 'door' } }] });
    for (const more of <Record<string, FieldValue>[]>[{}, { storeys: 3 }, { roof: 'flat', battlements: true, towers: 'all', across: 5, deep: 5, door: 2 }, { roof: 'flat', dome: true, across: 5, deep: 5, door: 2 }, { windows: 'every' }, { across: 10, deep: 10, storeys: 4, door: 0 }]) {
      expect(kitProblems(designSpec(settings(more))), JSON.stringify(more)).toEqual([]);
    }
    // A tower on the doorway's corner keeps the doorway.
    expect(designSpec(settings({ towers: 'front', door: 2 })).storeys[0]!.left).toMatchObject({ 2: 'door' });
  });

  it('shows the shape checks under its settings', () => {
    expect(EDIT_KINDS.kit.notes!(settings())).toEqual([{ ok: true, text: 'Shape checks: every part meets, nothing floats.' }]);
  });

  it('lays a building whose kit house is built from its spec, doorway where it was drawn', () => {
    const draft = EDIT_KINDS.kit.make({ at: [160, 100] }, settings({ across: 4, deep: 3, door: 3, storeys: 2 }));
    expect(checkEdit(generateRegion(ARCH_TESTBED_REGION), draft, {})).toBeUndefined();
    const map = lay([draft]);
    const b = map.buildings.find((x) => x.x === 160 && x.y === 100)!;
    expect(b).toMatchObject({ width: 10, height: 8, style: look, door: { x: 167, y: 107 } });
    expect(map.tiles[107 * map.width + 167]).toBe(Tile.Door);
    expect(map.tiles[107 * map.width + 165]).toBe(Tile.Wall);
    const house = buildingKit.kitHouse(b)!;
    expect(house.spec).toEqual(b.kit);
    expect(house.spec.storeys).toHaveLength(2);
    // Its upper storey is a floor to walk on.
    expect(map.storeys.some((s) => s.floor === 1 && s.x === 160 && s.y === 100)).toBe(true);
  });

  it('says in plain words what cannot be built', () => {
    const map = generateRegion(ARCH_TESTBED_REGION);
    const good = EDIT_KINDS.kit.make({ at: [160, 100] }, settings());
    expect(checkEdit(map, { ...good, style: plain } as WorldEditDraft, {})).toBe('Pick a look the building kit can build.');
    expect(checkEdit(map, { ...good, at: [40, 40] } as WorldEditDraft, {})).toMatch(/Another building/);
    const twoDoors = structuredClone(good) as Extract<WorldEditDraft, { kind: 'kit' }>;
    twoDoors.spec.storeys[0]!.front = { 0: 'door' };
    expect(checkEdit(map, twoDoors, {})).toMatch(/doorway/);
    expect(checkEdit(map, { ...good, spec: { ...good.spec, W: 0 } } as WorldEditDraft, {})).toMatch(/bays/);
  });
});
