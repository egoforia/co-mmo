import { describe, expect, it, vi } from 'vitest';
import type { RegionMap } from '@co-mmo/shared';
import type { DrawnRegion } from '../src/world-scene/types.ts';

vi.mock('phaser', () => ({ default: { Tilemaps: { TilemapLayer: class {} } } }));

const { floorViewKey } = await import('../src/world-scene/floor-view.ts');

/** A drawn region on the ground with one closed building and one chunk of ground. */
function region(): DrawnRegion {
  return {
    objects: [{}, {}],
    floors: [],
    stairs: [],
    lamps: [],
    chunks: new Map([[0, {}]]),
    buildings: [{ open: false, outside: [{}], inside: [{}], building: { x: 0, y: 0, width: 4, height: 4 } }],
  } as unknown as DrawnRegion;
}

const map = {} as RegionMap;
const at = { x: 10.5, y: 10.5 };

describe('the floor view key', () => {
  it('stays the same while nothing it depends on changes', () => {
    const drawn = new Map([['sanctum', region()]]);
    const key = floorViewKey(drawn, 'sanctum', map, at, 0);
    expect(floorViewKey(drawn, 'sanctum', map, { x: 10.6, y: 10.4 }, 0)).toBe(key);
  });

  it('changes when a building opens, a chunk comes in or things are added', () => {
    const r = region();
    const drawn = new Map([['sanctum', r]]);
    const key = floorViewKey(drawn, 'sanctum', map, at, 0);
    r.buildings[0]!.open = true;
    const opened = floorViewKey(drawn, 'sanctum', map, at, 0);
    expect(opened).not.toBe(key);
    r.chunks.set(1, {} as never);
    const chunked = floorViewKey(drawn, 'sanctum', map, at, 0);
    expect(chunked).not.toBe(opened);
    r.objects.push({} as never);
    expect(floorViewKey(drawn, 'sanctum', map, at, 0)).not.toBe(chunked);
  });

  it('changes when a region is drawn again or we move to another', () => {
    const drawn = new Map([['sanctum', region()]]);
    const key = floorViewKey(drawn, 'sanctum', map, at, 0);
    drawn.set('sanctum', region());
    const redrawn = floorViewKey(drawn, 'sanctum', map, at, 0);
    expect(redrawn).not.toBe(key);
    expect(floorViewKey(drawn, 'woods', map, at, 0)).not.toBe(redrawn);
  });
});
