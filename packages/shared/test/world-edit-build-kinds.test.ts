import { describe, expect, it } from 'vitest';
import { CREATURES, Tile, checkEdit, generateRegion, stampEdit, tileAt, withEdit, type RegionDef, type WorldEditDraft } from '../src/index.ts';

// The kinds that build a land up from blank ground (world editor v2, step 5):
// storeys and terraces, stairs between them, and furniture.

const blank: RegionDef = { id: 'blank-test', name: 'Blank', biome: 'sanctum', seed: 1, at: { x: 50, y: 50 }, exits: {}, layout: 'blank', workshop: true };
const lay = (map: ReturnType<typeof generateRegion>, draft: WorldEditDraft, id: string) => {
  expect(checkEdit(map, draft, CREATURES)).toBeUndefined();
  return withEdit(map, stampEdit(draft, { id, by: 'Test', made: 0 }, CREATURES));
};

describe('building a blank land up', () => {
  it('is flat open ground with players arriving in the middle', () => {
    const map = generateRegion(blank);
    expect(map.tiles.every((t) => t === Tile.Ground)).toBe(true);
    expect(map.spawn).toEqual({ x: map.width / 2, y: map.height / 2 });
    expect(map.buildings).toEqual([]);
  });

  it('lays a terrace, stairs up to it and furniture on it', () => {
    let map = generateRegion(blank);
    map = lay(map, { kind: 'storey', at: [20, 20], size: [8, 8], storey: 1, style: 'frostpeak-eyrie', open: true }, 'a');
    expect(map.storeys[0]).toMatchObject({ floor: 1, open: true, id: 'a:storey:0' });
    map = lay(map, { kind: 'stairs', at: [23, 24], size: [2, 3], from: 0, climbs: 'north' }, 'b');
    expect(map.stairways[0]).toMatchObject({ lower: 0, upper: 1 });
    map = lay(map, { kind: 'furniture', asset: 'sanctum-inn-furniture-bench', at: [22, 22], footprint: [2, 1], level: 1 }, 'c');
    expect(map.landmarks[0]).toMatchObject({ asset: 'sanctum-inn-furniture-bench', floor: 1 });
    expect(tileAt(map, 21, 21, 1)).toBe(Tile.Blocked);
  });

  it('says why in plain words when it cannot', () => {
    const map = generateRegion(blank);
    expect(checkEdit(map, { kind: 'storey', at: [20, 20], size: [8, 8], storey: 0, style: 'frostpeak-eyrie' }, CREATURES)).toMatch(/not on the ground/);
    expect(checkEdit(map, { kind: 'storey', at: [20, 20], size: [2, 8], storey: 1, style: 'frostpeak-eyrie' }, CREATURES)).toMatch(/at least 3/);
    expect(checkEdit(map, { kind: 'stairs', at: [20, 20], size: [2, 3], from: 1 }, CREATURES)).toMatch(/no open floor/);
    expect(checkEdit(map, { kind: 'furniture', asset: 'a-throne-of-skulls', at: [20, 20], footprint: [1, 1] }, CREATURES)).toMatch(/no furniture/);
  });
});
