import { describe, expect, it } from 'vitest';
import { REGION_SIZE, WORLD_REGIONS } from '@co-mmo/shared';
import { PROJECTION } from '../src/projection.ts';
import { GROUND_DEPTH, LABEL_DEPTH, floorDepthOffset, roomFloorDepth, wallCapDepth } from '../src/world-scene/depth.ts';

/** Depth of something standing with its feet at world (x, y) on `floor`, as avatars.ts sorts it. */
const standing = (x: number, y: number, floor = 0) => floorDepthOffset(floor) + PROJECTION.depth(x, y);

/** Every launch region's square in world tiles. */
const squares = WORLD_REGIONS.map((r) => ({ id: r.id, left: r.at.x * REGION_SIZE, top: r.at.y * REGION_SIZE }));

describe('isometric depth sorting across world coordinates', () => {
  it('has launch regions on both sides of the origin, so negative depths are really tested', () => {
    expect(squares.some((s) => s.left + s.top < 0)).toBe(true);
    expect(squares.some((s) => s.left + s.top + 2 * REGION_SIZE > 0)).toBe(true);
  });

  it('keeps the ground under every shadow, trunk and avatar in every region', () => {
    for (const s of squares) {
      // The north corner has the lowest x + y of the region, the south corner the highest.
      const lowest = standing(s.left, s.top);
      const highest = standing(s.left + REGION_SIZE, s.top + REGION_SIZE, 8);
      expect(lowest - 2, `shadow at ${s.id}'s north corner`).toBeGreaterThan(GROUND_DEPTH);
      expect(highest, `top storey at ${s.id}'s south corner`).toBeLessThan(LABEL_DEPTH - 2);
    }
  });

  it('keeps a room floor over the ground and its wall caps over the floor, wherever the room is', () => {
    for (const s of squares) {
      for (const floor of [-2, -1, 0, 1, 3]) {
        const room = roomFloorDepth(s.left, s.top, floor);
        expect(room, `${s.id} floor ${floor}`).toBeGreaterThan(GROUND_DEPTH);
        expect(wallCapDepth(s.left, s.top, floor, false)).toBeGreaterThan(room);
        expect(wallCapDepth(s.left, s.top, floor, true)).toBeGreaterThan(wallCapDepth(s.left, s.top, floor, false));
      }
    }
  });

  it('draws everyone and everything inside a room over its floor and wall caps', () => {
    // A 10 x 6 room at the Frostpeak spot where the bug was first seen (world x + y < 0).
    const [left, top, w, h] = [88, 152 - REGION_SIZE, 10, 6];
    for (const floor of [0, 1]) {
      const cap = wallCapDepth(left, top, floor, true);
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const feet = standing(left + dx + 0.5, top + dy + 0.5, floor);
          expect(feet - 2, `shadow at (${dx}, ${dy}) on floor ${floor}`).toBeGreaterThan(roomFloorDepth(left, top, floor));
          expect(feet - 1, `furniture at (${dx}, ${dy}) on floor ${floor}`).toBeGreaterThan(cap);
        }
      }
    }
  });

  it('draws an upper storey over whatever stands on the floor below it, near and far', () => {
    for (const s of squares) {
      for (let floor = 1; floor <= 8; floor++) {
        // A storey at the region's north corner against someone 20 tiles further south-east on the floor below.
        expect(roomFloorDepth(s.left, s.top, floor)).toBeGreaterThan(standing(s.left + 20, s.top + 20, floor - 1));
      }
    }
  });
});
