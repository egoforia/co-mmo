import { describe, expect, it } from 'vitest';
import { ARCH_TESTBED_REGION, CREATURES, Tile, brushTiles, checkEdit, copyArea, generateRegion, pasteArea, stampEdit, withEdit, type WorldEdit, type WorldEditDraft } from '../src/index.ts';

// Group C's brushes, and copying an area to paste elsewhere.

const creatures = Object.fromEntries(Object.entries(CREATURES).map(([id, c]) => [id, { name: c.name, art: c.art, level: c.level }]));
const plain = generateRegion(ARCH_TESTBED_REGION);

/** Checks and lays drafts one after another, as the server lays edits made together; the first problem, if any. */
function layTogether(drafts: WorldEditDraft[]) {
  let map = plain;
  for (const [i, d] of drafts.entries()) {
    const why = checkEdit(map, d, creatures);
    if (why) return { why, at: i, map };
    map = withEdit(map, stampEdit(d, { id: `a${i}`, by: 'Test', made: 0 }, creatures) as WorldEdit);
  }
  return { map };
}

describe('brush shapes', () => {
  it('fills a rectangle, draws a line and fills a patch', () => {
    expect(brushTiles(plain, 'rect', [10, 10], [12, 11])).toHaveLength(6);
    expect(brushTiles(plain, 'line', [10, 10], [14, 10])).toEqual([[10, 10], [11, 10], [12, 10], [13, 10], [14, 10]]);
    expect(brushTiles(plain, 'line', [10, 10], [14, 10], 3)).toHaveLength(21);
    // Blank ground joins up far and wide: the fill stops at the most one stroke may paint.
    const fill = brushTiles(plain, 'fill', [150, 120], [150, 120]);
    expect(fill.length).toBeGreaterThan(100);
    expect(fill.every(([x, y]) => plain.tiles[y * plain.width + x] === plain.tiles[120 * plain.width + 150])).toBe(true);
  });
});

describe('copying an area', () => {
  it('copies the testbed\'s terrace bay and pastes it again elsewhere, terrace for terrace', () => {
    const copy = copyArea(plain, [99, 39], [124, 52])!;
    expect(copy.size).toEqual([26, 14]);
    const storeys = copy.drafts.filter((d) => d.kind === 'storey');
    expect(storeys.length).toBe(plain.storeys.filter((s) => s.x >= 99 && s.x + s.width <= 125 && s.y >= 39 && s.y + s.height <= 53).length);
    const pasted = pasteArea(copy, [150, 150]);
    expect(pasted.find((d) => d.kind === 'storey')!.at[0]).toBeGreaterThanOrEqual(150);
    const laid = layTogether(pasted);
    expect(laid.why).toBeUndefined();
    const there = laid.map.storeys.filter((s) => s.x >= 150 && s.y >= 150);
    expect(there.map((s) => [s.x - 150 + 99, s.y - 150 + 39, s.width, s.height, s.floor])).toEqual(
      plain.storeys.filter((s) => s.x >= 99 && s.x + s.width <= 125 && s.y >= 39 && s.y + s.height <= 53).map((s) => [s.x, s.y, s.width, s.height, s.floor]),
    );
  });

  it('carries the ground: paths, water, trees and rocks', () => {
    const painted = withEdit(plain, stampEdit({ kind: 'paint', tile: 'water', tiles: [[160, 160], [161, 160]] }, { id: 'w', by: 'T', made: 0 }, creatures) as WorldEdit);
    const copy = copyArea(painted, [159, 159], [162, 161])!;
    expect(copy.drafts).toEqual([{ kind: 'paint', tile: 'water', tiles: [[1, 1], [2, 1]] }]);
    expect(pasteArea(copy, [10, 10])).toEqual([{ kind: 'paint', tile: 'water', tiles: [[11, 11], [12, 11]] }]);
    expect(copyArea(plain, [200, 200], [201, 201])).toBeUndefined();
    void Tile;
  });
});
