import { describe, expect, it } from 'vitest';
import {
  EVERYWHERE_REGION,
  ITEMS,
  MATERIAL_FAMILIES,
  MATERIAL_TRAITS,
  WORLD_REGIONS,
  itemFromWish,
  materialHomes,
  materialWords,
  materials,
  regionDef,
  regionMaterials,
  validateDefinition,
  type ItemWish,
} from '../src/index.ts';

describe('materials as data', () => {
  it('tags every material the game ships with', () => {
    const untagged = Object.entries(ITEMS).filter(([, d]) => d.kind === 'material' && !d.material).map(([id]) => id);
    expect(untagged).toEqual([]);
    for (const [id, d] of materials()) {
      expect(MATERIAL_FAMILIES, id).toContain(d.material.family);
      expect(d.material.homes.length, id).toBeGreaterThan(0);
      for (const home of d.material.homes) expect(regionDef(home), `${id} ${home}`).toBeDefined();
      expect(d.material.traits.length, id).toBeLessThanOrEqual(1);
      for (const t of d.material.traits) expect(MATERIAL_TRAITS).toContain(t);
      expect(d.value, id).toBeGreaterThan(0);
      // Tier 3 is for what only bosses give.
      if (d.material.tier === 3) expect(d.material.source, id).toBe('boss');
    }
  });

  it('works out each region\'s materials from them', () => {
    for (const def of WORLD_REGIONS) expect(regionMaterials(def.id).length, def.id).toBeGreaterThanOrEqual(3);
    expect(regionMaterials('frostpeak').sort()).toEqual(['frost-pine', 'ice-crystal', 'mountain-wool', 'roc-plume', 'silver-ore', 'snow-hare-fur', 'snowbell']);
    expect(regionMaterials('mushroom-hollow')).toContain('kings-mycelium');
    expect(materialHomes('pearl')).toEqual(['shore']);
    expect(materialHomes('tonic')).toEqual([]);
  });

  it('says a material in plain words', () => {
    expect(materialWords(ITEMS['snow-hare-fur']!)).toBe('Hide, common, warm. From Frostpeak.');
    expect(materialWords(ITEMS['moth-dust']!)).toBe('Wishstuff, common, shimmering. Counts as every land\'s.');
    expect(materialWords(ITEMS.tonic!)).toBe('');
  });

  it('makes a wished material fill the fields, within the limits', () => {
    const wish = (material?: unknown) => validateDefinition({ kind: 'item', name: 'Frost Silk', description: 'A shimmering thread spun by ice spiders.', itemKind: 'material', material, look: {} }) as ItemWish;
    expect(wish({ family: 'fibre', tier: 2, traits: ['light'], homes: ['frostpeak'] }).material).toEqual({ family: 'fibre', homes: ['frostpeak'], source: 'creature', tier: 2, traits: ['light'] });
    // Tier 3 is never wished; one trait at most; made-up families, traits and lands are dropped.
    expect(wish({ family: 'stardust', tier: 3, traits: ['warm', 'light', 'glowing'], homes: ['nowhere'] }).material).toEqual({ family: 'fibre', homes: [EVERYWHERE_REGION], source: 'creature', tier: 2, traits: ['warm'] });
    expect(wish().material).toMatchObject({ family: 'fibre', tier: 1, traits: [] });
    // Gear has no material data.
    expect((validateDefinition({ kind: 'item', name: 'Hat', description: 'A hat.', itemKind: 'head', look: {} }) as ItemWish).material).toBeUndefined();
  });

  it('gives a material wished before materials had data its own from its words', () => {
    const old: ItemWish = { kind: 'item', name: 'Ember Pelt', description: 'A smouldering fur.', itemKind: 'material', look: {} as ItemWish['look'] };
    const def = itemFromWish('wish-1', old);
    expect(def.material).toMatchObject({ family: 'hide', tier: 1, homes: [EVERYWHERE_REGION] });
    expect(def.value).toBe(6);
  });
});
