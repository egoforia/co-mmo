import { describe, expect, it } from 'vitest';
import { CALLINGS, type CallingId } from '@co-mmo/shared';
import { balanceTable, fight } from '../src/balance.ts';

// The balance test (docs/combat.md step 7): real fights on tiles. These are
// the floors no change should break; the full table (npm run balance,
// docs/balance.md) is for reading, and for deciding a balance pass.

const callings = Object.keys(CALLINGS) as CallingId[];

describe('balance on tiles', () => {
  it('every Calling beats one creature of its level alone, and two beat a tough one', { timeout: 60_000 }, () => {
    const results = balanceTable([1, 10, 20], ['solo', 'pair']);
    for (const r of results) expect(r.won, `${r.calling} at ${r.level}, ${r.scene}`).toBe(true);
  });

  it('a Warden comes out of a fight with less hurt than a Duelist', { timeout: 60_000 }, () => {
    for (const level of [10, 20]) {
      const warden = fight('warden', level, 'solo');
      const duelist = fight('duelist', level, 'solo');
      expect(warden.hpLost).toBeLessThan(duelist.hpLost);
    }
  });

  it('fights the same way every time', () => {
    expect(fight('ranger', 10, 'crowd')).toEqual(fight('ranger', 10, 'crowd'));
    expect(callings).toHaveLength(5);
  });
});
