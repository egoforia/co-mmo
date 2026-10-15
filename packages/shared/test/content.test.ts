import { describe, expect, it } from 'vitest';
import {
  CREATURES,
  ITEMS,
  MAX_WISHED_COUNT,
  MAX_WISHED_HEAL,
  MAX_WISHED_LEVEL,
  MAX_REGION_CREATURES,
  MAX_REGION_CREATURE_KINDS,
  REGION_WISH_COST,
  WishError,
  regionCreatureId,
  regionDef,
  regionNpcId,
  wishCost,
  applyContent,
  creatureFromWish,
  removeContent,
  validateDefinition,
  type ContentEntry,
  type CreatureWish,
  type NpcWish,
} from '../src/index.ts';

const look = { hook: 'a big hat', body: 'small', color: '#2C7FA8', mood: 'jolly' };

describe('wished content', () => {
  it('clamps a creature to the balance limits and drops unknown or bound items', () => {
    const d = validateDefinition({ kind: 'creature', name: 'Doom Goat', behavior: 'chase', level: 99, count: 40, drops: ['tonic', 'bible', 'gold-mountain'], look });
    expect(d).toMatchObject({ kind: 'creature', level: MAX_WISHED_LEVEL, count: MAX_WISHED_COUNT, drops: ['tonic'] });
    expect((d as CreatureWish).look.color).toBe('#2c7fa8');
  });

  it('caps healing, and only consumables heal', () => {
    expect(validateDefinition({ kind: 'item', name: 'Elixir', itemKind: 'consumable', heal: 9999, look })).toMatchObject({ heal: MAX_WISHED_HEAL });
    expect(validateDefinition({ kind: 'item', name: 'Ring', itemKind: 'trinket', heal: 30, look })).not.toHaveProperty('heal');
  });

  it('fills a missing look and greeting, and rejects nameless or unknown wishes', () => {
    const npc = validateDefinition({ kind: 'npc', name: 'Old Pell' });
    expect(npc).toMatchObject({ greeting: expect.stringContaining('Old Pell') });
    expect((npc as NpcWish).look.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(() => validateDefinition({ kind: 'item' })).toThrow(WishError);
    expect(() => validateDefinition({ kind: 'spell', name: 'Fireball' })).toThrow(WishError);
  });

  it('derives creature stats from level alone', () => {
    const weak = creatureFromWish('a', validateDefinition({ kind: 'creature', name: 'A', level: 1, look }) as any);
    const strong = creatureFromWish('b', validateDefinition({ kind: 'creature', name: 'B', level: 5, look }) as any);
    expect(strong.hp).toBeGreaterThan(weak.hp);
    expect(strong.xp).toBeGreaterThan(weak.xp);
    expect(weak.art).toBe('wished-a');
  });

  it('registers granted content and removes it when rolled back', () => {
    const entry: ContentEntry = {
      id: 'wtest', wisher: { id: 'p', name: 'Mara' }, regionId: 'sanctum', at: 0, tier: 'minor',
      title: 'Hat', summary: 'A hat.', status: 'granted', favor: 2,
      definition: validateDefinition({ kind: 'item', name: 'Hat', look }),
    };
    applyContent(entry);
    expect(ITEMS.wtest?.name).toBe('Hat');
    applyContent({ ...entry, status: 'rolled-back' });
    expect(ITEMS.wtest).toBeUndefined();
    applyContent({ ...entry, id: 'wbug', definition: validateDefinition({ kind: 'creature', name: 'Bug', look }) });
    expect(CREATURES.wbug?.name).toBe('Bug');
    removeContent({ ...entry, id: 'wbug' });
    expect(CREATURES.wbug).toBeUndefined();
  });
});

describe('wished regions', () => {
  const raw = {
    kind: 'region', name: 'Frostfang Vale', description: 'Snow and pines.', biome: 'frostpeak', danger: 40, trees: 9, rocks: -2,
    creatures: [
      { existing: 'walking-mushroom', count: 99 },
      { existing: 'no-such-thing', count: 3 },
      { name: 'Ice Wisp', description: 'A cold light.', behavior: 'chase', count: 3, look },
      { name: 'Third', description: 'Too many.', behavior: 'wander', count: 3, look },
    ],
    npc: { name: 'Old Hermit', description: 'Lives in the snow.', greeting: 'Brr.', look },
  };

  it('keeps a region within the limits', () => {
    const d = validateDefinition(raw);
    expect(d).toMatchObject({ kind: 'region', biome: 'frostpeak', danger: MAX_WISHED_LEVEL, trees: 3, rocks: 0, water: 1 });
    if (d.kind !== 'region') throw new Error('not a region');
    expect(d.creatures).toHaveLength(MAX_REGION_CREATURE_KINDS);
    expect(d.creatures[0]).toEqual({ existing: 'walking-mushroom', count: MAX_REGION_CREATURES });
    expect(d.creatures[1]).toMatchObject({ name: 'Ice Wisp', behavior: 'chase', count: 3 });
    expect(d.npc?.name).toBe('Old Hermit');
    expect(wishCost(d)).toBe(REGION_WISH_COST);
  });

  it('refuses a second Sanctum, unknown lands and lands with nothing living there', () => {
    expect(() => validateDefinition({ ...raw, biome: 'sanctum' })).toThrow(WishError);
    expect(() => validateDefinition({ ...raw, biome: 'moon' })).toThrow(WishError);
    expect(() => validateDefinition({ ...raw, creatures: [{ existing: 'dragon' }] })).toThrow(WishError);
  });

  it('registers the region, its creature and its person, and forgets them on rollback', () => {
    const definition = validateDefinition(raw);
    const entry: ContentEntry = {
      id: 'wvale', wisher: { id: 'p1', name: 'Mara' }, regionId: 'woods', at: 0, tier: 'moderate', title: 'Frostfang Vale',
      summary: '', status: 'granted', favor: 12, definition, cell: { x: -2, y: 0 },
    };
    applyContent(entry);
    expect(regionDef('wvale')).toMatchObject({ name: 'Frostfang Vale', at: { x: -2, y: 0 }, wild: { wisher: 'Mara', danger: 6 } });
    expect(CREATURES[regionCreatureId('wvale', 1)]).toMatchObject({ name: 'Ice Wisp', level: 6 });
    expect(regionDef('wvale')!.wild!.creatures.map((c) => c.kind)).toEqual(['walking-mushroom', regionCreatureId('wvale', 1)]);
    expect(regionDef('wvale')!.wild!.npc?.id).toBe(regionNpcId('wvale'));
    removeContent(entry);
    expect(regionDef('wvale')).toBeUndefined();
    expect(CREATURES[regionCreatureId('wvale', 1)]).toBeUndefined();
    expect(CREATURES['walking-mushroom']).toBeDefined();
  });
});
