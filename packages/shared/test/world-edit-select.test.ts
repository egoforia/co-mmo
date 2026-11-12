import { describe, expect, it } from 'vitest';
import {
  ARCH_TESTBED_REGION,
  ARCH_TESTBED_WAYPOINTS,
  Tile,
  checkEdit,
  copyDraft,
  generateRegion,
  moveDrafts,
  pickAt,
  removeDraft,
  stampEdit,
  type RegionMap,
  type WorldEdit,
  type WorldEditDraft,
} from '../src/index.ts';

// The editor's Select tool on the testbed: what a click picks on each floor,
// and the edits that take it away, copy it and move it, laid as the server
// lays them (checked first, each on the land the one before left).

const testbed = () => generateRegion(ARCH_TESTBED_REGION);

/** Lays drafts in order over a land, the way the editor saves them; throws with the reason one does not fit. */
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

describe('the Select tool', () => {
  it('picks the smallest thing on each floor', () => {
    const map = testbed();
    expect(pickAt(map, [43, 43], 0)).toMatchObject({ kind: 'landmark', id: 'testbed-03:landmark:0' });
    expect(pickAt(map, [42, 42], 0)).toMatchObject({ kind: 'building', id: 'testbed-01:building:0', box: { x: 40, y: 40, w: 10, h: 10 } });
    expect(pickAt(map, [49, 105], 1)).toMatchObject({ kind: 'stairway', details: ['From the ground floor up to floor 1', 'Climbing north'] });
    expect(pickAt(map, [104, 44], 1)).toMatchObject({ kind: 'storey', name: 'A terrace', box: { x: 100, y: 40, w: 12, h: 12 } });
    expect(pickAt(map, [106, 46], 1)).toMatchObject({ kind: 'bookmark', name: 'Bookmark “G2-A”' });
    expect(pickAt(map, [20, 20], 0)).toBeUndefined();
  });

  it('takes away a terrace with what stands on it, and a building with its floors', () => {
    const map = testbed();
    const terrace = pickAt(map, [104, 44], 1)!;
    const gone = lay(map, [removeDraft(terrace)]);
    expect(gone.storeys.some((s) => s.x === 100 && s.y === 40 && s.floor === 1)).toBe(false);
    expect(gone.storeys.some((s) => s.x === 102 && s.y === 40 && s.floor === 2)).toBe(true);

    const cathedral = pickAt(map, [42, 102], 0)!;
    expect(cathedral.kind).toBe('building');
    const razed = lay(map, [removeDraft(cathedral)]);
    expect(razed.buildings.some((b) => b.x === 40 && b.y === 100)).toBe(false);
    expect(razed.storeys.some((s) => s.x === 40 && s.y === 100)).toBe(false);
    expect(razed.stairways.some((s) => s.x === 48 && s.y === 104)).toBe(false);
    expect(razed.tiles[100 * razed.width + 40]).toBe(Tile.Ground);
  });

  it('copies a terrace, a house and a piece of furniture where it is told', () => {
    const map = testbed();
    const terrace = pickAt(map, [104, 44], 1)!;
    const house = pickAt(map, [58, 42], 0)!;
    const table = pickAt(map, [43, 43], 0)!;
    const copied = lay(map, [copyDraft(map, terrace, [160, 40])!, copyDraft(map, house, [160, 100])!, copyDraft(map, table, [20, 20])!]);
    expect(copied.storeys.find((s) => s.x === 160 && s.y === 40)).toMatchObject({ floor: 1, width: 12, height: 12, open: true, style: 'frostpeak-eyrie' });
    expect(copied.buildings.find((b) => b.x === 160 && b.y === 100)).toMatchObject({ width: 10, height: 10, style: 'sanctum-inn' });
    expect(copied.landmarks.find((l) => l.asset === 'sanctum-inn-furniture-dining-table' && l.x === 21.5 && l.y === 21.5)).toBeTruthy();
  });

  it('moves a building in one step: taken away, laid again', () => {
    const map = testbed();
    const house = pickAt(map, [58, 42], 0)!;
    const drafts = moveDrafts(map, house, [160, 100])!;
    expect(drafts.map((d) => d.kind)).toEqual(['remove', 'house']);
    const moved = lay(map, drafts);
    expect(moved.buildings.some((b) => b.x === 56 && b.y === 40)).toBe(false);
    expect(moved.buildings.some((b) => b.x === 160 && b.y === 100)).toBe(true);
  });

  it('moves a piece of furniture by itself', () => {
    const map = testbed();
    const table = pickAt(map, [43, 43], 0)!;
    const [move] = moveDrafts(map, table, [45, 45])!;
    expect(move).toMatchObject({ kind: 'move', target: 'testbed-03:landmark:0' });
    const moved = lay(map, [move!]);
    expect(moved.landmarks.find((l) => l.asset === 'sanctum-inn-furniture-dining-table')).toMatchObject({ x: 46.5, y: 46.5 });
  });
});

describe('bookmarks', () => {
  it('ship with the testbed, one for each place the camera checks look from', () => {
    const map = testbed();
    expect(map.bookmarks?.map((b) => b.name)).toEqual(Object.keys(ARCH_TESTBED_WAYPOINTS));
    expect(map.bookmarks?.find((b) => b.name === 'G2-D')).toMatchObject({ x: 121, y: 43, floor: 4, note: 'Summit high pillar extreme vertical drop' });
  });

  it('are named once, said in plain words when wrong, and taken away', () => {
    const map = testbed();
    expect(checkEdit(map, { kind: 'bookmark', at: [30.5, 30.5], name: '' }, {})).toMatch(/name/);
    expect(checkEdit(map, { kind: 'bookmark', at: [30.5, 30.5], name: 'G1-A' }, {})).toMatch(/already/);
    const marked = lay(map, [{ kind: 'bookmark', at: [30.5, 30.5], name: 'Doorway', note: 'the door from outside', level: 0 }]);
    expect(marked.bookmarks?.at(-1)).toMatchObject({ name: 'Doorway', x: 30.5, y: 30.5, floor: 0 });
    const gone = lay(marked, [removeDraft(pickAt(marked, [30, 30], 0)!)]);
    expect(gone.bookmarks?.some((b) => b.name === 'Doorway')).toBe(false);
  });
});
