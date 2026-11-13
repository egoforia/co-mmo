import { describe, expect, it, vi } from 'vitest';
import { artPage } from '../src/art-ui.ts';
import { artState, type ArtContext, type ArtOverview } from '../src/art-ui/state.ts';

describe('AI Art Studio client caching', () => {
  it('skips fetching overview when artState.data is populated and force is false', async () => {
    (globalThis as any).location = { hash: '#now' };
    (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const apiMock = vi.fn().mockImplementation((path: string) => {
      if (path === 'art') {
        return Promise.resolve({
          items: [],
          groups: [],
          walkers: [],
          bodies: [],
          sounds: [],
          sheets: [],
          jobs: [],
          budget: { spentUsd: 0, monthlyUsd: 100, warn: false },
          imageModel: 'gemini',
          videoModel: 'veo',
          effectsModel: null,
          musicModel: null,
        } as unknown as ArtOverview);
      }
      if (path === 'art/hands') return Promise.resolve({ questions: [] });
      if (path === 'art/hands/status') return Promise.resolve({ running: false, done: 0, total: 0, waiting: 0 });
      if (path === 'art/queue') return Promise.resolve({ items: [] });
      return Promise.resolve({});
    });

    const context: ArtContext = {
      api: apiMock as any,
      toast: () => {},
      rerender: () => {},
    };

    artState.data = null;

    // First call when artState.data is null should fetch from API
    await artPage(context, false);
    expect(apiMock).toHaveBeenCalledWith('art');

    apiMock.mockClear();

    // Subsequent navigation call (force=false) uses cached artState.data (0 API calls to 'art')
    await artPage(context, false);
    expect(apiMock).not.toHaveBeenCalledWith('art');

    // Mutation or explicit reload (force=true) forces refetch
    await artPage(context, true);
    expect(apiMock).toHaveBeenCalledWith('art');
  });
});
