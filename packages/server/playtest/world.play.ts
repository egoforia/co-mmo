// The robot walks the whole world: every road between regions, there and
// back, and checks each region can be walked: people, roads, doors and
// creatures all within reach.

import { describe, expect, it } from 'vitest';
import { WISHED_REGIONS, WORLD_REGIONS, generateRegion, type RegionDef } from '@co-mmo/shared';
import { unreachable } from './checks.ts';
import { playWorld } from './harness.ts';

describe('the robot walks the world', () => {
  it('crosses every road between regions and can reach everything in each', async () => {
    const world = await playWorld();
    const bot = await world.bot('Wanderer');
    const regions = (): RegionDef[] => [...WORLD_REGIONS, ...WISHED_REGIONS.values()];
    const visited = new Set<string>();
    const look = () => {
      if (visited.has(bot.region.id)) return;
      visited.add(bot.region.id);
      bot.problems.push(...unreachable(bot.map, bot.at));
    };
    look();
    // Every road, both ways: out from each region and back again.
    for (const def of regions()) {
      if (!(await bot.travelTo(def.id))) continue;
      look();
      for (const side of Object.keys(def.exits) as (keyof RegionDef['exits'])[]) {
        const there = def.exits[side]!;
        if (!(await bot.travelTo(def.id))) break;
        if (!(await bot.cross(side!))) continue;
        expect.soft(bot.region.id, `the road ${side} from ${def.name}`).toBe(there);
        look();
      }
    }
    await bot.travelTo('sanctum');
    expect.soft([...visited].sort()).toEqual(regions().map((r) => r.id).sort());
    expect(world.problems()).toEqual([]);
  });

  it('lands every wished region where a player can walk it', () => {
    // A wished land is laid out from its seed and how wild it is: try many.
    const problems: string[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const level = (seed % 6) + 1;
      const amount = (n: number) => (seed * n) % 4;
      const def: RegionDef = {
        id: `wished-${seed}`,
        name: `Wished Land ${seed}`,
        biome: 'whispering-woods',
        seed: seed * 7919,
        at: { x: 2, y: 0 },
        exits: { west: 'shore', north: 'north-land', south: 'south-land', east: 'east-land' },
        wild: {
          danger: level,
          trees: amount(1),
          rocks: amount(3),
          water: amount(5),
          creatures: [{ kind: 'walking-mushroom', name: 'Walking Mushroom', asset: 'woods-mushroom', count: 6 }],
          npc: { id: `wished-npc-${seed}`, name: 'A Wished Guide', asset: 'sanctum-pilgrim' },
          wisher: 'Robot',
        },
      };
      const map = generateRegion(def);
      problems.push(...unreachable(map, map.spawn).map((p) => `${p} (trees ${def.wild!.trees}, rocks ${def.wild!.rocks}, water ${def.wild!.water})`));
    }
    expect(problems).toEqual([]);
  });
});
