import { describe, expect, it } from 'vitest';
import { CREATURES, HOME_LANDS, ITEMS, NPC_NAMES, QUESTS, SHOPS, WORLD_REGIONS, generateRegion, linkRegions } from '../src/index.ts';

describe('the home lands beyond the launch four', () => {
  it('stand north of the Sanctum and west of the Woods, joined both ways', () => {
    const frostpeak = WORLD_REGIONS.find((r) => r.id === 'frostpeak')!;
    const hollow = WORLD_REGIONS.find((r) => r.id === 'mushroom-hollow')!;
    expect(frostpeak).toMatchObject({ biome: 'frostpeak', at: { x: 0, y: -1 } });
    expect(hollow).toMatchObject({ biome: 'mushroom-hollow', at: { x: -2, y: 0 } });
    const links = linkRegions(WORLD_REGIONS);
    expect(links.get('sanctum')).toMatchObject({ north: 'frostpeak' });
    expect(links.get('woods')).toMatchObject({ west: 'mushroom-hollow' });
  });

  it('meet their neighbours on the same road across each border', () => {
    const map = (id: string) => generateRegion(WORLD_REGIONS.find((r) => r.id === id)!);
    const [sanctum, frostpeak, woods, hollow] = ['sanctum', 'frostpeak', 'woods', 'mushroom-hollow'].map(map);
    expect(sanctum!.entries.north!.x).toBe(frostpeak!.entries.south!.x);
    expect(woods!.entries.west!.y).toBe(hollow!.entries.east!.y);
  });

  it.each(HOME_LANDS.map((l) => [l.biome, l] as const))('%s: everything it lays out is in the shared tables', (biome, land) => {
    const def = WORLD_REGIONS.find((r) => r.biome === biome)!;
    const map = generateRegion(def);
    for (const c of map.creatures) expect(CREATURES[c.kind], c.kind).toBeDefined();
    for (const n of map.npcs) expect(NPC_NAMES[n.id], n.id).toBe(n.name);
    for (const c of Object.values(land.creatures)) for (const d of c.drops) expect(ITEMS[d.item], d.item).toBeDefined();
    for (const [id, quest] of Object.entries(land.quests)) {
      expect(QUESTS[id]).toBe(quest);
      expect(land.people[quest.giver], id).toBeDefined();
      if (quest.goal.kind === 'defeat') expect(map.creatures.some((c) => c.kind === (quest.goal as { creature: string }).creature)).toBe(true);
      for (const r of quest.reward.items ?? []) expect(ITEMS[r.item], r.item).toBeDefined();
    }
    for (const id of Object.keys(land.people)) for (const sale of SHOPS[id]?.sells ?? []) expect(ITEMS[sale.item]).toBeDefined();
  });

  it('each have one boss that drops its key item and takes a long while to come back', () => {
    const bosses = { frostpeak: ['hoarfrost-roc', 'roc-plume'], 'mushroom-hollow': ['rootless-king', 'kings-mycelium'] } as const;
    for (const [biome, [boss, key]] of Object.entries(bosses)) {
      const map = generateRegion(WORLD_REGIONS.find((r) => r.biome === biome)!);
      expect(map.creatures.filter((c) => c.kind === boss)).toHaveLength(1);
      expect(CREATURES[boss]!.drops.some((d) => d.item === key)).toBe(true);
      expect(CREATURES[boss]!.respawnSeconds).toBeGreaterThanOrEqual(600);
      expect(ITEMS[key]!.rarity).toBe('rare');
    }
  });
});
