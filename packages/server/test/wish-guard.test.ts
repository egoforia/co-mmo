import { describe, expect, it } from 'vitest';
// @ts-expect-error The guard is a plain script with no type declarations.
import { MAX_LINES, checkArt, checkChanges } from '../../../scripts/wish-guard.mjs';

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

describe('wish guard on art', () => {
  const add = (path: string, text: string) => ({ path, text });

  it('refuses game code that draws pictures', () => {
    const problems = checkArt([
      add('packages/client/src/textures.ts', "  const ctx = canvas.getContext('2d')!;"),
      add('packages/client/src/textures.ts', '  ctx.fillRect(0, 0, 8, 8);'),
      add('packages/client/src/world-scene.ts', '    const slash = this.add.graphics();'),
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/draws art in code.*image model chosen in God's View/);
  });

  it('lets through art loading, tests and God\'s View charts', () => {
    expect(checkArt([
      add('packages/client/src/world-scene.ts', "    this.add.image(x, y, 'fx-slash');"),
      add('packages/client/src/gods-view.ts', '      ctx.arc(x, y, size, 0, Math.PI * 2);'),
      add('packages/server/test/x.test.ts', '  ctx.fillRect(0, 0, 1, 1);'),
      add('packages/shared/src/rpg.ts', '  const filled = items.fill(0);'),
    ])).toEqual([]);
  });
});
