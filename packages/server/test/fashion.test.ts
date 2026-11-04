import { afterEach, describe, expect, it } from 'vitest';
import { account, app, joined, start, stop } from './helpers.ts';

afterEach(stop);

const look = { hook: 'a fur trim', body: 'a hood', color: '#888888', mood: 'cosy' };

describe('garment wishes', () => {
  it('take the wisher’s region style when they name none, and send rare ones to the Stewards', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara');
    await joined(ws, p.token);
    const card = (definition: object) => app!.wishes.cardFor(p.id, { tier: 'minor', title: 'Hood', summary: '', definition }, 'the Sanctum') as { card: { tier: string }; definition?: { style?: string; materials?: unknown[] } };

    const common = card({ kind: 'item', name: 'Hood', description: 'A plain hood.', itemKind: 'head', rarity: 'common', look });
    expect(common.card.tier).toBe('minor');
    expect(common.definition).toMatchObject({ style: 'pilgrim' });
    expect(common.definition?.materials?.length).toBeGreaterThan(0);

    const rare = card({ kind: 'item', name: 'Hood', description: 'A fine hood.', itemKind: 'head', rarity: 'rare', style: 'windfelt', look });
    expect(rare.card.tier).toBe('major');
  });
});
