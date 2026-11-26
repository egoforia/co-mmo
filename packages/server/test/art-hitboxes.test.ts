import { afterEach, describe, expect, it } from 'vitest';
import { applyFit, removeFit } from '@co-mmo/shared';
import { landsWith, watchHitboxes } from '../src/art-studio/hitboxes.ts';

const fake = () => {
  const laid: string[] = [];
  const land = (id: string, assets: string[]) => [id, { def: { id }, map: { landmarks: assets.map((asset) => ({ asset, x: 1, y: 1, footprint: { width: 2, height: 1 } })) } }] as const;
  const world = {
    regions: new Map([land('sanctum', ['sanctum-shrine', 'sanctum-rock']), land('woods', ['woods-arch'])]),
    reshape: async (id: string) => void laid.push(id),
  };
  return { world: world as unknown as Parameters<typeof watchHitboxes>[0], laid };
};

const ids: string[] = [];
afterEach(() => {
  for (const id of ids.splice(0)) removeFit(id);
});
const put = (id: string, at: number, asset: string, blocks?: [number, number][], offset: [number, number] = [0, 0]) => {
  ids.push(id);
  applyFit(id, { at, fit: { asset, offset, ...(blocks ? { blocks } : {}) } });
};

describe('hitboxes laying out their lands again', () => {
  it('finds the lands a picture stands in', () => {
    const { world } = fake();
    expect(landsWith(world, new Set(['woods-arch']))).toEqual(['woods']);
    expect(landsWith(world, new Set(['nowhere']))).toEqual([]);
  });

  it('lays out lands with hitboxes at the start, then only when a hitbox changes', () => {
    put('h1', 1, 'woods-arch', [[0, 0]]);
    const { world, laid } = fake();
    const stop = watchHitboxes(world);
    expect(laid).toEqual(['woods']);
    // A fit that only moves the picture leaves the tiles alone.
    put('h2', 2, 'sanctum-shrine', undefined, [4, 0]);
    expect(laid).toEqual(['woods']);
    put('h3', 3, 'sanctum-shrine', [[1, 0]], [4, 0]);
    expect(laid).toEqual(['woods', 'sanctum']);
    // Undone: the shrine blocks both tiles again.
    removeFit('h3');
    expect(laid).toEqual(['woods', 'sanctum', 'sanctum']);
    stop();
    put('h4', 4, 'woods-arch', [[1, 0]]);
    expect(laid).toEqual(['woods', 'sanctum', 'sanctum']);
  });
});
