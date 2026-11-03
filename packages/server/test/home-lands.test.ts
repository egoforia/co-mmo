import { describe, expect, it } from 'vitest';
import { CREATURE_HEIGHTS, WORLD_REGIONS, generateRegion, type RegionDef } from '@co-mmo/shared';
import { ANCHORS } from '../src/assets/anchors.ts';
import { HOME_LAND_ANCHORS, homeLandBox, homeLandKit } from '../src/assets/home-land-art.ts';
import { kitPieces } from '../src/assets/sea-cave-kit.ts';
import { World } from '../src/world.ts';

describe('Frostpeak and Mushroom Hollow', () => {
  it('run in the world from the start', () => {
    const world = new World();
    expect(world.regions.has('frostpeak')).toBe(true);
    expect(world.regions.has('mushroom-hollow')).toBe(true);
    expect(world.regions.get('sanctum')!.def.exits.north).toBe('frostpeak');
  });

  it('send a wished region already on their square to the nearest free one', () => {
    const world = new World();
    expect(world.cellFree({ x: 0, y: -1 })).toBe(false);
    const cell = world.freeCellNear({ x: 0, y: -1 });
    expect(world.cellFree(cell)).toBe(true);
    expect(Math.abs(cell.x) + Math.abs(cell.y + 1)).toBe(1);
    const land: RegionDef = { id: 'wished-north', name: 'North', biome: 'frostpeak', seed: 9, at: cell, exits: {}, wild: { danger: 2, trees: 1, rocks: 1, water: 1, creatures: [], wisher: 'Mara' } };
    expect(world.addRegion(land)).toBe(true);
    expect(world.cellFree(world.freeCellNear({ x: 0, y: -1 }))).toBe(true);
  });

  it('have every picture they show ready to paint the first time from the Art tab', () => {
    for (const id of ['frostpeak', 'mushroom-hollow']) {
      const map = generateRegion(WORLD_REGIONS.find((r) => r.id === id)!);
      const own = [...map.creatures, ...map.npcs].map((t) => t.asset).filter((a) => a.startsWith('frostpeak-') || a.startsWith('hollow-'));
      expect(own.length).toBeGreaterThan(0);
      for (const asset of own) expect(homeLandBox(asset), asset).toBeDefined();
    }
    for (const a of HOME_LAND_ANCHORS) expect(ANCHORS).toContain(a);
    for (const a of homeLandKit()) expect(kitPieces().map((k) => k.id)).toContain(a.id);
    expect(homeLandKit()).toHaveLength(10);
    expect(homeLandBox('frostpeak-ground')).toEqual({ width: 128, height: 128 });
    expect(homeLandBox('frostpeak-tree-a')).toEqual({ width: 192, height: 256 });
    expect(homeLandBox('hollow-mother-morel')).toEqual({ width: 128, height: 192 });
    expect(homeLandBox('frostpeak-hoarfrost-roc')!.height).toBe(CREATURE_HEIGHTS.colossal);
    expect(homeLandBox('woods-rock')).toBeUndefined();
  });
});
