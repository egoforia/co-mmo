import { describe, expect, it } from 'vitest';
import {
  ARCH_TESTBED_REGION,
  EDIT_KINDS,
  Tile,
  checkEdit,
  copyDraft,
  editWords,
  floorChecks,
  generateRegion,
  landChecks,
  moveDrafts,
  pickAt,
  removeDraft,
  standWall,
  stampEdit,
  tileAt,
  type RegionMap,
  type WorldEdit,
  type WorldEditDraft,
} from '../src/index.ts';

// Ramps in the world editor: the Stairs tool lays one, Select names it from
// any of its tiles, and taking it away gives the floor back.

const testbed = () => generateRegion(ARCH_TESTBED_REGION);

function lay(map: RegionMap, drafts: WorldEditDraft[]): RegionMap {
  const edits: WorldEdit[] = [...(map.def.edits ?? [])];
  let now = map;
  drafts.forEach((d, i) => {
    const why = checkEdit(now, d, {});
    if (why) throw new Error(why);
    edits.push(stampEdit(d, { id: `t${edits.length}-${i}`, by: 'Test', made: 0 }, {}));
    now = generateRegion({ ...map.def, edits });
  });
  return now;
}

const STAIRS = EDIT_KINDS.stairs;

describe('the Stairs tool laying a ramp', () => {
  it('turns its settings into a ramp 1 wide, long the way it climbs, and shows foot, body, head and landings', () => {
    const values = { way: 'ramp', from: '0', climbs: 'east', width: 2, height: 3, length: 2, look: 'wood' };
    expect(STAIRS.make({ at: [10, 10] }, values)).toEqual({ kind: 'stairs', at: [10, 10], size: [2, 1], from: 0, climbs: 'east', way: 'ramp', look: 'wood' });
    const ghost = STAIRS.outline!(testbed(), { at: [10, 10], level: 0 }, values);
    expect(ghost).toEqual([
      { x: 10, y: 10, w: 1, h: 1 },
      { x: 11, y: 10, w: 1, h: 1 },
      { x: 9, y: 10, w: 1, h: 1, tone: 'held' },
      { x: 12, y: 10, w: 1, h: 1, tone: 'held' },
    ]);
    // Climbing turns with R; width and depth are for stairs only.
    expect(STAIRS.fields.find((f) => f.key === 'climbs')).toMatchObject({ turns: true });
    expect(STAIRS.fields.find((f) => f.key === 'width')!.when!(values)).toBe(false);
    expect(STAIRS.fields.find((f) => f.key === 'length')!.when!(values)).toBe(true);
  });

  it('says plainly why one does not fit', () => {
    const map = testbed();
    expect(checkEdit(map, { kind: 'stairs', at: [100, 161], size: [2, 3], from: 0, climbs: 'north', way: 'ramp' }, {})).toBe('A ramp is 1 tile wide, and long the way it climbs.');
    expect(checkEdit(map, { kind: 'stairs', at: [100, 161], size: [3, 1], from: 0, climbs: 'north', way: 'ramp' }, {})).toBe('A ramp is 1 tile wide, and long the way it climbs.');
    expect(checkEdit(map, { kind: 'stairs', at: [60, 60], size: [1, 3], from: 0, climbs: 'north', way: 'ramp', look: 'gold' }, {})).toBe('A ramp is stone, wood or earth.');
    // Out in the open there is no floor above to step off onto.
    expect(checkEdit(map, { kind: 'stairs', at: [60, 60], size: [1, 3], from: 0, climbs: 'north', way: 'ramp' }, {})).toMatch(/no open floor in front of the ramp's top/);
  });

  it('still reads older ladders, and words each way up', () => {
    const map = testbed();
    expect(STAIRS.keep({ kind: 'stairs', at: [1, 2], size: [1, 1], from: -1, ladder: true }, { creatures: {} })).toEqual({ kind: 'stairs', at: [1, 2], size: [1, 1], from: -1, way: 'ladder' });
    expect(editWords({ kind: 'stairs', at: [1, 2], size: [1, 1], from: -1, ladder: true })).toBe('A ladder up from 1 down, at 1, 2');
    expect(editWords({ kind: 'stairs', at: [100, 161], size: [1, 3], from: 0, climbs: 'north', way: 'ramp' })).toBe('A ramp, 3 long, rising north, up from the ground, at 100, 161');
    expect(map.stairways.find((s) => s.kind === 'ramp')).toBeDefined();
  });
});

describe('a ramp on the testbed', () => {
  it('holds together, and Select names it from its foot, body and head', () => {
    const map = testbed();
    expect(floorChecks(map)).toEqual([]);
    expect(landChecks(map).shapes).toEqual([]);
    for (const [at, level] of [[[100, 163], 0], [[100, 162], 0], [[100, 161], 1]] as const) {
      expect(pickAt(map, [at[0], at[1]], level)).toMatchObject({ kind: 'stairway', name: 'A ramp, 3 long, rising north', box: { x: 100, y: 161, w: 1, h: 3 } });
    }
  });

  it('is taken away with its floor given back, and copied or moved with its look', () => {
    const map = testbed();
    const picked = pickAt(map, [100, 162], 0)!;
    const gone = lay(map, [removeDraft(picked)]);
    expect(gone.stairways.some((s) => s.kind === 'ramp')).toBe(false);
    const without = generateRegion({ ...ARCH_TESTBED_REGION, base: ARCH_TESTBED_REGION.base?.filter((e) => e.id !== 'testbed-59') });
    expect(tileAt(gone, 100, 162, 0)).toBe(tileAt(without, 100, 162, 0));
    expect(tileAt(gone, 100, 162, 0)).not.toBe(Tile.Blocked);
    expect(copyDraft(map, picked, [97, 161])).toEqual({ kind: 'stairs', at: [97, 161], size: [1, 3], from: 0, climbs: 'north', way: 'ramp', look: 'stone' });
    const moved = lay(map, moveDrafts(map, picked, [97, 161])!);
    expect(moved.stairways.filter((s) => s.kind === 'ramp').map((s) => [s.x, s.y, s.art?.up])).toEqual([[97, 161, 'ramp-stone-3-away']]);
    expect(tileAt(moved, 100, 162, 0)).not.toBe(Tile.Blocked);
    expect(tileAt(moved, 97, 162, 0)).toBe(Tile.Blocked);
  });

  it('warns in the checks when a wall stands where it meets the floor above', () => {
    const map = testbed();
    standWall(map, { id: 'test-wall', floor: 1, style: 'frostpeak-eyrie', height: 'full' }, 100, 161, 'north');
    expect(floorChecks(map)).toContain('A wall on floor 1 stands between the top of the ramp at (100, 161) and its landing.');
  });
});
