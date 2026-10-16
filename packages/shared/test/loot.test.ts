import { describe, expect, it } from 'vitest';
import {
  MAX_WISHED_CHANCE,
  MAX_WISHED_DROP_QTY,
  MAX_WISHED_DROPS,
  WishError,
  applyContent,
  chanceText,
  checkDraft,
  contentTier,
  lootTable,
  validateDefinition,
  validateLoot,
  worldLines,
  type ContentEntry,
  type LootWish,
} from '../src/index.ts';

const entry = (id: string, at: number, definition: LootWish, status: ContentEntry['status'] = 'granted'): ContentEntry => ({
  id, wisher: { id: 'p1', name: 'Mara' }, regionId: 'sanctum', at, tier: 'moderate', title: definition.name, summary: '', status, favor: 6, definition,
});

describe('creature loot', () => {
  it('keeps a wish to what can be traded, at most a 1 in 2 chance, three at a time and four things', () => {
    const d = validateDefinition({
      kind: 'loot', creature: 'walking-mushroom',
      drops: [{ item: 'tonic', chance: 0.9, qty: 9 }, 'goat-horn', { item: 'bible' }, { item: 'gold-mountain' }, 'tonic', 'crab-shell', 'scarab-shell', 'mushroom-cap'],
    }) as LootWish;
    expect(d).toMatchObject({ kind: 'loot', mode: 'add', name: 'Walking Mushroom loot', creature: 'walking-mushroom' });
    expect(d.drops[0]).toEqual({ item: 'tonic', chance: MAX_WISHED_CHANCE, qty: MAX_WISHED_DROP_QTY });
    expect(d.drops[1]).toEqual({ item: 'goat-horn', chance: 0.25, qty: 1 });
    expect(d.drops.map((x) => x.item)).not.toContain('bible');
    expect(d.drops).toHaveLength(MAX_WISHED_DROPS);
    expect(contentTier(d)).toBe('moderate');
    expect(() => validateDefinition({ kind: 'loot', creature: 'nobody', drops: ['tonic'] })).toThrow(WishError);
    expect(() => validateDefinition({ kind: 'loot', creature: 'walking-mushroom', drops: ['bible'] })).toThrow(/Choose something/);
  });

  it("lets God's View set any loot, even none", () => {
    expect(validateLoot({ creature: 'crab-knight', drops: [{ item: 'bible', chance: 1, qty: 40 }] }, true)).toMatchObject({ mode: 'set', drops: [{ item: 'bible', chance: 1, qty: 40 }] });
    expect(validateLoot({ creature: 'crab-knight', drops: [] }, true)).toMatchObject({ drops: [], description: 'The Crab Knight drops nothing.' });
  });

  it('works out what a creature drops from its own list and the changes that stand, in order', () => {
    const own = lootTable('sun-scarab').map((l) => l.item);
    expect(own).toEqual(['scarab-shell', 'goat-horn', 'tonic']);
    const wish = validateDefinition({ kind: 'loot', creature: 'sun-scarab', drops: [{ item: 'tonic', chance: 0.5 }, 'crab-shell'] }) as LootWish;
    applyContent(entry('wloot1', 1, wish));
    expect(lootTable('sun-scarab')).toEqual([
      { item: 'scarab-shell', chance: 0.45 }, { item: 'goat-horn', chance: 0.25 },
      { item: 'tonic', chance: 0.5, qty: 1, from: 'wloot1' }, { item: 'crab-shell', chance: 0.25, qty: 1, from: 'wloot1' },
    ]);
    const set = validateLoot({ creature: 'sun-scarab', drops: [{ item: 'goat-horn', chance: 1 }] }, true);
    applyContent(entry('wloot2', 2, set));
    expect(lootTable('sun-scarab')).toEqual([{ item: 'goat-horn', chance: 1, qty: 1, from: 'wloot2' }]);
    // Undoing God's View's change brings the wished loot back; undoing the wish brings the creature's own.
    applyContent(entry('wloot2', 2, set, 'rolled-back'));
    expect(lootTable('sun-scarab').map((l) => l.item)).toEqual(['scarab-shell', 'goat-horn', 'tonic', 'crab-shell']);
    applyContent(entry('wloot1', 1, wish, 'rolled-back'));
    expect(lootTable('sun-scarab').map((l) => l.item)).toEqual(own);
  });

  it('can be shaped in the Workshop and says what it changes', () => {
    const checked = checkDraft({ category: 'living', sub: 'loot', fields: { creature: 'crab-knight', drops: ['tonic'], chance: 40, qty: 2 } });
    expect(checked.problems).toEqual([]);
    expect(checked.definition).toMatchObject({ kind: 'loot', drops: [{ item: 'tonic', chance: 0.4, qty: 2 }] });
    expect(worldLines(checked.definition!)[0]).toBe('Every Crab Knight may drop 2 × Tonic (40% of the time).');
    expect(checkDraft({ category: 'living', sub: 'loot', fields: {} }).problems).toContain('Choose which creature.');
    expect(chanceText(1)).toBe('always');
  });
});
