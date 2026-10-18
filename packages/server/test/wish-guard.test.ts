import { describe, expect, it } from 'vitest';
// @ts-expect-error The guard is a plain script with no type declarations.
import { MAX_LINES, checkArt, checkChanges, checkMod } from '../../../scripts/wish-guard.mjs';

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

  it('keeps the building kit core, so wishes add buildings as data', () => {
    expect(checkChanges([file('packages/shared/src/building-kit/checks.ts')])[0]).toMatch(/the building kit and its checks/);
    expect(checkChanges([file('packages/shared/src/land-buildings.ts')])).toEqual([]);
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

  it('lets only pose guides and the doorway sketch draw on the server', () => {
    expect(checkArt([
      add('packages/server/src/assets/pose-guide.ts', '    shapes.push(`<circle cx="1" cy="1" r="2"/>`);'),
      add('packages/server/src/assets/building-art.ts', '<rect width="100%" height="100%"/>'),
    ])).toEqual([]);
    expect(checkArt([add('packages/server/src/assets/wish-art.ts', '  const svg = `<svg><circle r="4"/></svg>`;')])[0]).toMatch(/wish-art\.ts draws art in code/);
  });
});

describe('wish guard on switches', () => {
  const add = (path: string, text: string) => ({ path, text });
  const files = [file('packages/client/src/lights.ts', 30), file('packages/client/test/lights.test.ts', 40)];

  it('asks new game code to check its own switch', () => {
    expect(checkMod(files, [add('packages/client/src/lights.ts', 'const glow = 1;')], 59)[0]).toMatch(/modOn\(engineModId\(59\)\)/);
    expect(checkMod(files, [add('packages/client/src/lights.ts', '  if (!modOn(engineModId(59))) return;')], 59)).toEqual([]);
    expect(checkMod(files, [add('packages/shared/src/light.ts', "export const LIGHT_MOD = 'wish-59';")], 59)).toEqual([]);
    // Another wish's switch does not count.
    expect(checkMod(files, [add('packages/client/src/lights.ts', 'modOn(engineModId(60))')], 59)).toHaveLength(1);
  });

  it('lets an undo take code out without a switch, and leaves branches that are not wishes alone', () => {
    expect(checkMod([file('packages/client/src/lights.ts', 2, 30)], [add('packages/client/src/lights.ts', 'x')], 61)).toEqual([]);
    expect(checkMod(files, [], undefined)).toEqual([]);
  });
});
