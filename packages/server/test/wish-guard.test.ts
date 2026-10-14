import { describe, expect, it } from 'vitest';
// @ts-expect-error The guard is a plain script with no type declarations.
import { MAX_LINES, checkChanges } from '../../../scripts/wish-guard.mjs';

const file = (path: string, added = 10, removed = 0) => ({ path, added, removed });

describe('wish guard', () => {
  it('passes a small change to game code', () => {
    expect(checkChanges([file('packages/server/src/region.ts'), file('packages/server/test/region.test.ts')])).toEqual([]);
  });

  it('refuses core files unless the Owner allowed them', () => {
    const files = [file('packages/server/src/store.ts'), file('packages/server/package.json')];
    expect(checkChanges(files)).toHaveLength(2);
    expect(checkChanges(files)[0]).toMatch(/accounts, roles/);
    expect(checkChanges(files, { allowCore: true })).toEqual([]);
  });

  it('never lets a wish change the workflows or the guard itself', () => {
    expect(checkChanges([file('.github/workflows/ci.yml'), file('scripts/wish-guard.mjs'), file('.env')], { allowCore: true })).toHaveLength(3);
  });

  it('refuses a change too big for one review, not counting the lockfile', () => {
    expect(checkChanges([file('packages/client/src/main.ts', MAX_LINES + 1)])[0]).toMatch(/Split the wish/);
    expect(checkChanges([file('package-lock.json', 5000)], { allowCore: true })).toEqual([]);
  });
});
