import { describe, expect, it } from 'vitest';
import {
  ITEMS,
  RECIPES,
  WishError,
  applyContent,
  garmentMaterials,
  regionStyle,
  validateDefinition,
  validateRule,
  type ContentEntry,
  type ItemWish,
} from '../src/index.ts';

const look = { hook: 'a fur trim', body: 'a hood', color: '#888888', mood: 'cosy' };
const hood = (over: Record<string, unknown> = {}) => validateDefinition({ kind: 'item', name: 'Snow Hood', description: 'A warm hood.', itemKind: 'head', look, ...over }) as ItemWish;

describe('wished garments', () => {
  it('must belong to a region style, named or in their words', () => {
    expect(() => hood()).toThrow(WishError);
    expect(hood({ style: 'windfelt' }).style).toBe('windfelt');
    expect(hood({ name: 'Windfelt Snood' }).style).toBe('windfelt');
    // Weapons, charms and the rest need none.
    expect((validateDefinition({ kind: 'item', name: 'Stick', description: 'A stick.', itemKind: 'weapon', look }) as ItemWish).style).toBeUndefined();
    // A scripted rule's own items are reviewed with the rule.
    expect(() => validateRule({ name: 'Hats', script: 'export default {}', items: { cap: { name: 'Cap', description: 'A cap.', itemKind: 'head', look } } })).not.toThrow();
  });

  it('are made only from their style region’s materials', () => {
    expect(hood({ style: 'windfelt', materials: [{ item: 'mountain-wool', qty: 3 }, { item: 'pearl', qty: 1 }, { item: 'flax', qty: 9 }] }).materials)
      .toEqual([{ item: 'mountain-wool', qty: 3 }, { item: 'flax', qty: 6 }]);
    // None fit: it takes what the style's own hood takes.
    expect(garmentMaterials([{ item: 'pearl', qty: 2 }], 'windfelt', 'head')).toEqual(RECIPES['windfelt-hood']!.materials);
  });

  it('bring their recipe, and take it with them when the wish is switched off', () => {
    const definition = hood({ style: 'windfelt', rarity: 'uncommon' });
    const entry = { id: 'wish-hood', status: 'granted', definition, wisher: { id: 'p1', name: 'Ysa' }, at: 0 } as unknown as ContentEntry;
    applyContent(entry);
    expect(ITEMS['wish-hood']).toMatchObject({ slot: 'head', style: 'windfelt' });
    expect(RECIPES['wish-hood']).toMatchObject({ craft: 'tailoring', level: 6, result: { item: 'wish-hood', qty: 1 } });
    applyContent({ ...entry, off: { by: 'steward', at: 1 } });
    expect(RECIPES['wish-hood']).toBeUndefined();
    expect(ITEMS['wish-hood']?.style).toBeUndefined();
  });

  it('take the style of the region the wisher stands in', () => {
    expect(regionStyle('frostpeak')).toBe('windfelt');
    expect(regionStyle('sanctum')).toBe('pilgrim');
    expect(regionStyle('nowhere')).toBeUndefined();
  });
});
