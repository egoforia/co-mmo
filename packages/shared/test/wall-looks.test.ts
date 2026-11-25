import { describe, expect, it } from 'vitest';
import { Tile, checkEdit, generateRegion, pickAt, regionDef, stampEdit, tileAt, wallLookAt, wallTileOwner, type RegionMap, type WorldEdit, type WorldEditDraft } from '../src/index.ts';

// One wall tile of a walled building or storey in a look of its own: the
// Sunlit Shore's sea cave (a walled building with storeys) takes it, the
// coral palace (a kit house) refuses in plain words.

function lay(map: RegionMap, drafts: WorldEditDraft[]): RegionMap {
  const edits: WorldEdit[] = [...(map.def.edits ?? [])];
  let now = map;
  drafts.forEach((d, i) => {
    const why = checkEdit(now, d, {});
    if (why) throw new Error(why);
    edits.push(stampEdit(d, { id: `w${edits.length}-${i}`, by: 'Test', made: 0 }, {}));
    now = generateRegion({ ...map.def, edits });
  });
  return now;
}

/** The first wall tile of a floor of the building whose top-left corner is given. */
function wallTile(map: RegionMap, corner: [number, number], floor: number): [number, number] {
  for (let x = corner[0] + 1; x < corner[0] + 20; x++) if (tileAt(map, x, corner[1], floor) === Tile.Wall) return [x, corner[1]];
  throw new Error('no wall tile');
}

describe('a wall tile in its own look', () => {
  const shore = () => generateRegion(regionDef('shore')!);

  it('is picked by Select on a walled building and changed, ground and storey alike', () => {
    const map = shore();
    const cave = map.buildings.find((b) => b.style === 'shore-sea-cave')!;
    const ground = wallTile(map, [cave.x, cave.y], 0);
    const upstairs = wallTile(map, [cave.x, cave.y], 1);
    expect(pickAt(map, ground, 0)).toMatchObject({ kind: 'wall', wall: { tile: true, style: 'shore-sea-cave' } });
    const changed = lay(map, [
      { kind: 'wall-look', at: ground, style: 'woods-castle' },
      { kind: 'wall-look', at: upstairs, style: 'sanctum-inn', level: 1 },
    ]);
    const caveNow = changed.buildings.find((b) => b.style === 'shore-sea-cave')!;
    expect(wallLookAt(caveNow, ...ground)).toBe('woods-castle');
    expect(wallLookAt(caveNow, ground[0] + 1, ground[1])).toBe('shore-sea-cave');
    expect(wallLookAt(wallTileOwner(changed, ...upstairs, 1)!, ...upstairs)).toBe('sanctum-inn');
    expect(pickAt(changed, ground, 0)).toMatchObject({ name: 'Mossgate Castle wall tile' });
    // Its own look back to the building's takes the tile's own away.
    const back = lay(changed, [{ kind: 'wall-look', at: ground, style: 'shore-sea-cave' }]);
    expect(back.buildings.find((b) => b.style === 'shore-sea-cave')!.wallLooks).toBeUndefined();
  });

  it('is refused on a kit house, whose walls change together, and on a tile that is no wall', () => {
    const map = shore();
    const palace = map.buildings.find((b) => b.style === 'shore-coral-palace')!;
    const at: [number, number] = [palace.x + 2, palace.y];
    expect(checkEdit(map, { kind: 'wall-look', at, style: 'woods-castle' }, {})).toMatch(/kit house/);
    expect(pickAt(map, at, 0)).toMatchObject({ kind: 'building', details: expect.arrayContaining([expect.stringMatching(/kit house/)]) });
    expect(checkEdit(map, { kind: 'wall-look', at: [5, 5], style: 'woods-castle' }, {})).toMatch(/not a wall/);
  });
});
