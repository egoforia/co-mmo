import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

const { HouseArt } = await import('../src/kit-house-view.ts');

/** A picture that loads when the test says so. */
class SlowImage {
  static waiting: (() => void)[] = [];
  src = '';
  decode(): Promise<void> {
    return new Promise((done) => SlowImage.waiting.push(done));
  }
}

/** Just enough of a Phaser scene's textures to see what is added and removed. */
function fakeScene() {
  const textures = new Map<string, unknown>();
  const removed: string[] = [];
  const scene = {
    textures: {
      exists: (key: string) => textures.has(key),
      remove: (key: string) => (removed.push(key), textures.delete(key)),
      addImage: (key: string, img: unknown) => textures.set(key, img),
    },
  };
  return { scene, textures, removed };
}

const info = { key: 'temple-stone-6x9-abc', views: { outside: { picture: '/p.png', normal: '/n.png' } } };

describe('kit house pictures', () => {
  it('loads a house look once when two regions ask for it at the same time', async () => {
    vi.stubGlobal('Image', SlowImage);
    const { scene, textures, removed } = fakeScene();
    const art = new HouseArt(scene as never);
    const first = art.view(info as never, 'outside');
    const second = art.view(info as never, 'outside');
    // Let every load finish, a step at a time (the normal map goes first, then the picture).
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 0));
      SlowImage.waiting.splice(0).forEach((done) => done());
    }
    expect(await first).toBe('kit-house-temple-stone-6x9-abc-outside');
    expect(await second).toBe('kit-house-temple-stone-6x9-abc-outside');
    expect(removed, 'a picture in use was swapped out').toEqual([]);
    expect([...textures.keys()].sort()).toEqual(['kit-house-temple-stone-6x9-abc-outside', 'kit-house-temple-stone-6x9-abc-outside-normal']);
    vi.unstubAllGlobals();
  });
});
