import { describe, expect, it } from 'vitest';
import { addStorey, building, type RegionMap } from '@co-mmo/shared';
import { MAP_ZOOMS, MAP_ZOOM_START, floorsAt, mapCaption, mapTransform, nextZoom, onMap, peekStep } from '../src/mini-map-plan.ts';
import { ISOMETRIC } from '../src/projection.ts';

/** A small land with a house of two floors up and a cellar, and a wider cave under the east. */
function land(): RegionMap {
  const map: RegionMap = {
    def: { id: 'test', name: 'Test', biome: 'sanctum', seed: 1, exits: {}, at: { x: 0, y: 0 } },
    width: 32, height: 32, seed: 1, tiles: new Uint8Array(32 * 32), spawn: { x: 16, y: 28 }, entries: {},
    landmarks: [], buildings: [], storeys: [], stairways: [], npcs: [], creatures: [],
  };
  const house = building(map, 4, 4, 10, 8, 'sanctum-arcanum');
  map.buildings.push(house);
  for (const f of [1, 2, -1]) addStorey(map, house, f, house.style);
  addStorey(map, { x: 18, y: 4, width: 12, height: 20 }, -1, house.style);
  return map;
}

describe('the mini map', () => {
  it('lists the floors over the tile you stand on, highest first', () => {
    const map = land();
    expect(floorsAt(map, 6.5, 6.5, 0)).toEqual([2, 1, 0, -1]);
    expect(floorsAt(map, 20.5, 10.5, -1)).toEqual([0, -1]);
    // Out in the open there is only the ground.
    expect(floorsAt(map, 16.5, 28.5, 0)).toEqual([0]);
  });

  it('steps one floor up or down among them, and stops at the top and bottom', () => {
    const floors = [2, 1, 0, -1];
    expect(peekStep(floors, 0, 1)).toBe(1);
    expect(peekStep(floors, 1, 1)).toBe(2);
    expect(peekStep(floors, 2, 1)).toBe(2);
    expect(peekStep(floors, 0, -1)).toBe(-1);
    expect(peekStep(floors, -1, -1)).toBe(-1);
    // A gap (no floor 1 here) is stepped over.
    expect(peekStep([2, 0], 0, 1)).toBe(2);
  });

  it('says which floor it shows, and where you are when looking at another', () => {
    expect(mapCaption(0, 0)).toBe('The ground floor');
    expect(mapCaption(2, 0)).toBe('Floor 2 (you are on the ground floor)');
    expect(mapCaption(-1, 1)).toBe('Underground floor 1 (you are on floor 1)');
  });

  it('zooms within its steps', () => {
    expect(MAP_ZOOMS[MAP_ZOOM_START]).toBeDefined();
    expect(nextZoom(0, -1)).toBe(0);
    expect(nextZoom(MAP_ZOOMS.length - 1, 1)).toBe(MAP_ZOOMS.length - 1);
    expect(nextZoom(2, 1)).toBe(3);
  });

  it('turns with the isometric camera, so each way on the map is the same way on screen', () => {
    const t = mapTransform('diamond', 4, 10, 20, 200);
    const mid = onMap(t, 10, 20);
    expect(mid.x).toBeCloseTo(100);
    expect(mid.y).toBeCloseTo(100);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const map = onMap(t, 10 + dx, 20 + dy);
      const a = ISOMETRIC.toScreen(10, 20);
      const b = ISOMETRIC.toScreen(10 + dx, 20 + dy);
      // The same direction, and the same squash, as the camera's.
      expect(Math.atan2(map.y - mid.y, map.x - mid.x)).toBeCloseTo(Math.atan2(b.y - a.y, b.x - a.x));
    }
  });
});
