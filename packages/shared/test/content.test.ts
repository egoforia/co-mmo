import { describe, expect, it } from 'vitest';
import {
  CREATURES,
  ITEMS,
  MAX_WISHED_COUNT,
  MAX_WISHED_HEAL,
  MAX_WISHED_LEVEL,
  WishError,
  applyContent,
  creatureFromWish,
  removeContent,
  validateDefinition,
  type ContentEntry,
} from '../src/index.ts';

const look = { hook: 'a big hat', body: 'small', color: '#2C7FA8', mood: 'jolly' };

describe('wished content', () => {
  it('clamps a creature to the balance limits and drops unknown or bound items', () => {
    const d = validateDefinition({ kind: 'creature', name: 'Doom Goat', behavior: 'chase', level: 99, count: 40, drops: ['tonic', 'bible', 'gold-mountain'], look });
    expect(d).toMatchObject({ kind: 'creature', level: MAX_WISHED_LEVEL, count: MAX_WISHED_COUNT, drops: ['tonic'] });
    expect(d.look.color).toBe('#2c7fa8');
  });

  it('caps healing, and only consumables heal', () => {
    expect(validateDefinition({ kind: 'item', name: 'Elixir', itemKind: 'consumable', heal: 9999, look })).toMatchObject({ heal: MAX_WISHED_HEAL });
    expect(validateDefinition({ kind: 'item', name: 'Ring', itemKind: 'trinket', heal: 30, look })).not.toHaveProperty('heal');
  });

  it('fills a missing look and greeting, and rejects nameless or unknown wishes', () => {
    const npc = validateDefinition({ kind: 'npc', name: 'Old Pell' });
    expect(npc).toMatchObject({ greeting: expect.stringContaining('Old Pell') });
    expect(npc.look.color).toMatch(/^#[0-9a-f]{6}$/);
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
