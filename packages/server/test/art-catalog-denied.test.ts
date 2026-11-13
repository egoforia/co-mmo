import { describe, expect, it } from 'vitest';
import { ArtCatalog } from '../src/art-studio/catalog.ts';
import type { ArtStudioOptions } from '../src/art-studio/types.ts';

describe('ArtCatalog denied walk clips', () => {
  it('includes denied walk clip in walkerViews even when entry already exists in manifest', async () => {
    const deniedRecord = {
      walkerId: 'player-mara',
      direction: 'front-left' as const,
      at: 1700000000000,
      videoUrl: '/wished-art/walks/raw/player-mara-walk-front-left.mp4',
      problems: ['Frame 2 has more grey than reference'],
      distinctPoses: 14,
    };

    const options = {
      ai: { video: () => undefined },
      store: { content: [] },
      walks: {
        anchorWalker: (id: string) => ({ id, name: id, gear: [], body: 'two-legged' }),
        versions: async () => [],
        deniedClip: async (walker: string, dir: string) => {
          if (walker === 'player-mara' && dir === 'front-left') return deniedRecord;
          return undefined;
        },
        standing: async () => ({ url: '/stand.png' }),
      },
      recipes: {
        current: async () => undefined,
      },
    } as unknown as ArtStudioOptions;

    const catalog = new ArtCatalog(options, {} as any, '/tmp', async () => ({}));

    // Even when shipped has an existing walk strip entry:
    const shipped = {
      'player-mara-walk-front-left': { file: 'art/player-mara-walk-front-left.png', width: 256, height: 256, kind: 'walk' },
    };
    const views = await catalog.walkerViews(shipped as any, {}, 0.05);
    const mara = views.find((v) => v.id === 'player-mara');
    expect(mara).toBeDefined();
    expect(mara?.walks['front-left']).toBeDefined();
    expect(mara?.denied?.['front-left']).toEqual(deniedRecord);
  });
});
