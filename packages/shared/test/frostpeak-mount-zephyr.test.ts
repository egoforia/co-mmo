import { describe, expect, it } from 'vitest';
import { WORLD_REGIONS, generateRegion, stairwayAt, storeyAt } from '../src/index.ts';
import { FROSTPEAK } from '../src/home-lands/frostpeak.ts';

describe('Mount Zephyr, Whiteledge, and The Eyrie of the First Watch', () => {
  const frostpeakDef = WORLD_REGIONS.find((r) => r.id === 'frostpeak')!;
  const map = generateRegion(frostpeakDef);

  it('generates the 8-storey Eyrie and 4-storey Sunken Drafts', () => {
    // Check above-ground storeys (+1 to +8)
    for (let f = 1; f <= 8; f++) {
      const storeys = map.storeys.filter((s) => s.floor === f);
      expect(storeys.length, `Expected at least one storey on floor ${f}`).toBeGreaterThan(0);
    }

    // Check open terraces/balconies
    for (const f of [4, 5, 7, 8]) {
      const storey = map.storeys.find((s) => s.floor === f);
      expect(storey?.open, `Expected floor ${f} to be an open terrace/balcony`).toBe(true);
    }

    // Check subterranean storeys (-1 to -4)
    for (let f = -1; f >= -4; f--) {
      const storeys = map.storeys.filter((s) => s.floor === f);
      expect(storeys.length, `Expected at least one storey on underground floor ${f}`).toBeGreaterThan(0);
    }
  });

  it('connects all 13 vertical levels with stairways or ladders', () => {
    // Verify a stairway connects every adjacent pair of floors from -4 up to 8
    for (let f = -4; f < 8; f++) {
      const way = map.stairways.find((s) => s.lower === f && s.upper === f + 1);
      expect(way, `Expected stairway connecting floor ${f} and ${f + 1}`).toBeDefined();
      expect(way!.bottom).toBeDefined();
      expect(way!.top).toBeDefined();
    }
  });

  it('places NPCs on their designated floors', () => {
    const npcsByFloor = new Map<string, number>();
    for (const npc of map.npcs) {
      npcsByFloor.set(npc.id, npc.floor ?? 0);
    }

    expect(npcsByFloor.get('ysolde')).toBe(0);
    expect(npcsByFloor.get('kaen')).toBe(0);
    expect(npcsByFloor.get('kip')).toBe(-1);
    expect(npcsByFloor.get('sula')).toBe(2);
    expect(npcsByFloor.get('aurius')).toBe(6);
    expect(npcsByFloor.get('vail')).toBe(8);
  });

  it('spawns subterranean monsters on floors -1 through -4', () => {
    const undergroundCreatures = map.creatures.filter((c) => (c.floor ?? 0) < 0);
    expect(undergroundCreatures.length).toBeGreaterThan(15);

    const kinds = new Set(undergroundCreatures.map((c) => c.kind));
    expect(kinds.has('ice-wisp')).toBe(true);
    expect(kinds.has('rime-stalker')).toBe(true);
    expect(kinds.has('deep-matriarch')).toBe(true);

    // Deep Crag Matriarchs should be on Floor -3
    const matriarchs = undergroundCreatures.filter((c) => c.kind === 'deep-matriarch');
    expect(matriarchs.every((c) => c.floor === -3)).toBe(true);

    // Rime Stalkers prowl floors -2 and -4
    const stalkers = undergroundCreatures.filter((c) => c.kind === 'rime-stalker');
    expect(stalkers.every((c) => c.floor === -2 || c.floor === -4)).toBe(true);
  });

  it('has a complete extended quest chain from Ysolde to the Hoarfrost Roc', () => {
    const quests = FROSTPEAK.quests;
    expect(quests['frostpeak-wisps']).toBeDefined();
    expect(quests['frostpeak-sunken-drafts']).toBeDefined();
    expect(quests['frostpeak-feather-mantle']).toBeDefined();
    expect(quests['frostpeak-roc-vigil']).toBeDefined();

    // Verify quest requirement dependencies
    expect(quests['frostpeak-sunken-drafts'].requires).toBe('frostpeak-wisps');
    expect(quests['frostpeak-feather-mantle'].requires).toBe('frostpeak-sunken-drafts');
    expect(quests['frostpeak-roc-vigil'].requires).toBe('frostpeak-feather-mantle');

    // Verify givers
    expect(quests['frostpeak-wisps'].giver).toBe('ysolde');
    expect(quests['frostpeak-sunken-drafts'].giver).toBe('kip');
    expect(quests['frostpeak-feather-mantle'].giver).toBe('sula');
    expect(quests['frostpeak-roc-vigil'].giver).toBe('vail');
  });
});
