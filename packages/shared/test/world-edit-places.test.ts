import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, CREATURES, Tile, checkEdit, generateRegion, regionDef, stampEdit, thingById, tileAt, withEdit, type WorldEdit, type WorldEditDraft } from '../src/index.ts';

// Edits that name their floor and point at things by name (world-edits/names.ts).

const stamp = (draft: WorldEditDraft, id: string): WorldEdit => stampEdit(draft, { id, by: 'Test', made: 0 }, CREATURES);
const testbed = (edits: WorldEdit[] = []) => generateRegion({ ...ARCH_TESTBED_REGION, edits });

describe('names for what stands on a land', () => {
  it('names generated things in the order they are laid, the same every time', () => {
    const a = generateRegion(regionDef('sanctum')!);
    const b = generateRegion(regionDef('sanctum')!);
    expect(a.buildings.map((x) => x.id)).toEqual(b.buildings.map((x) => x.id));
    expect(a.buildings[0]!.id).toBe('gen:building:0');
    expect(a.stairways.every((s) => s.id?.startsWith('gen:stairway:'))).toBe(true);
  });

  it('names what a land ships with after the edit that lays it', () => {
    const a = testbed();
    expect(a.buildings[0]!.id).toBe('testbed-01:building:0');
    expect(a.storeys.every((s) => /^testbed-\d+:storey:0$/.test(s.id ?? ''))).toBe(true);
    expect(thingById(a, 'testbed-03:landmark:0')).toMatchObject({ kind: 'landmark', thing: { asset: 'sanctum-inn-furniture-dining-table' } });
  });

  it('names what an edit lays after the edit', () => {
    const map = testbed([stamp({ kind: 'piece', piece: 'sea-cave-boulder', at: [30, 40] }, 'p1')]);
    expect(map.landmarks.find((l) => l.asset === 'sea-cave-boulder')?.id).toBe('p1:landmark:0');
  });
});

describe('edits that point at a thing by name', () => {
  it('moves the named piece, and an edit whose thing is gone is listed as no longer fitting', () => {
    const put = stamp({ kind: 'piece', piece: 'sea-cave-boulder', at: [30, 40] }, 'p1');
    const move = stamp({ kind: 'move', from: [30, 40], to: [30, 44], target: 'p1:landmark:0' }, 'm1');
    const moved = testbed([put, move]);
    expect(moved.landmarks.find((l) => l.id === 'p1:landmark:0')).toMatchObject({ x: 31, y: 45 });
    expect(moved.unlaid).toBeUndefined();

    const away = stamp({ kind: 'move', from: [30, 44], to: null, target: 'p1:landmark:0' }, 'm2');
    const gone = testbed([away, move]);
    expect(gone.unlaid).toEqual(['m2', 'm1']);
    expect(checkEdit(testbed([put, away]), { kind: 'move', from: [30, 44], to: [30, 46], target: 'p1:landmark:0' }, CREATURES)).toBe('That is not there any more.');
  });

  it('gives floors to the named building', () => {
    const house = stamp({ kind: 'house', at: [180, 40], floor: [10, 8], style: 'sanctum-inn' }, 'h1');
    const edited = testbed([house, stamp({ kind: 'floors', at: [0, 0], up: 1, down: 0, target: 'h1:building:0' }, 'f1')]);
    expect(edited.unlaid).toBeUndefined();
    expect(edited.storeys.some((s) => s.floor === 1 && s.x === 180 && s.y === 40)).toBe(true);
  });
});

describe('edits on floors above and below the ground', () => {
  // Bay 2's first terrace: floor 1 over (100, 40), 12 by 12.
  const on = (floor: number) => ({ level: floor });

  it('stands a set piece on a terrace, blocking only that floor', () => {
    const map = testbed([stamp({ kind: 'piece', piece: 'sea-cave-boulder', at: [104, 46], ...on(1) }, 'p1')]);
    expect(map.landmarks.find((l) => l.id === 'p1:landmark:0')).toMatchObject({ floor: 1 });
    expect(tileAt(map, 104, 46, 1)).toBe(Tile.Blocked);
    expect(tileAt(map, 104, 46, 0)).toBe(Tile.Ground);
  });

  it('lets monsters live on a floor, and a clear made there leaves the ground alone', () => {
    const up = stamp({ kind: 'spawn', creature: 'walking-mushroom', at: [104, 46], count: 2, ...on(1) }, 's1');
    const down = stamp({ kind: 'spawn', creature: 'walking-mushroom', at: [30, 36], count: 2, ...on(0) }, 's2');
    const map = testbed([up, down]);
    expect(map.creatures.filter((c) => c.floor === 1)).toHaveLength(2);
    const cleared = testbed([up, down, stamp({ kind: 'clear', at: [104, 46], radius: 80, ...on(1) }, 'c1')]);
    expect(cleared.creatures).toHaveLength(2);
    expect(cleared.creatures.every((c) => !c.floor)).toBe(true);
    // A clear saved before floors had names clears every floor, as it always did.
    const old = testbed([up, down, { kind: 'clear', at: [104, 46], radius: 80, id: 'c0', by: 'Test', made: 0 }]);
    expect(old.creatures).toHaveLength(0);
  });

  it('says plainly when a tool works only on the ground, and keeps a floor only for tools that use one', () => {
    const map = testbed();
    expect(checkEdit(map, { kind: 'paint', tile: 'tree', tiles: [[104, 46]], level: 1 }, CREATURES)).toBe('The Paint tool works on the ground floor for now.');
    expect(checkEdit(map, { kind: 'piece', piece: 'sea-cave-boulder', at: [104, 46], level: 9 }, CREATURES)).toMatch(/Floors go from/);
    expect(stamp({ kind: 'road', from: [1, 1], to: [3, 3], level: 0 }, 'r1')).not.toHaveProperty('level');
    expect(stamp({ kind: 'clear', at: [1, 1], radius: 2, level: 0 }, 'c1')).toHaveProperty('level', 0);
  });
});

describe('laying one more edit without laying the whole land again', () => {
  it('comes out as the whole land laid with that edit', () => {
    const base = testbed();
    const tree = stamp({ kind: 'paint', tile: 'tree', tiles: [[30, 34], [31, 34]] }, 't1');
    const quick = withEdit(base, tree);
    const full = testbed([tree]);
    expect([...quick.tiles]).toEqual([...full.tiles]);
    expect(base.tiles[34 * base.width + 30]).toBe(Tile.Ground);
  });
});
