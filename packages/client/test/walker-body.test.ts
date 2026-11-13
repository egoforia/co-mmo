import { beforeEach, describe, expect, it } from 'vitest';
import { artChange } from '../src/art-ui.ts';
import { artState, type ArtOverview, type WalkerView } from '../src/art-ui/state.ts';
import { walkerHtml } from '../src/art-ui/walkers.ts';

describe('walker body dropdown in AI Art Studio', () => {
  const testWalker: WalkerView = {
    id: 'sylvan-cervid',
    name: 'Sylvan Cervid',
    kind: 'npc',
    body: 'two-legged',
    place: { tab: 'characters', page: 'Cervid' },
    standing: {
      'front-left': { url: '/art/sylvan-cervid.png', versions: [] },
      'front-right': { url: '/art/sylvan-cervid.png', versions: [] },
      'back-left': { url: '/art/sylvan-cervid.png', versions: [] },
      'back-right': { url: '/art/sylvan-cervid.png', versions: [] },
    },
    walks: {},
    runs: {},
    attacks: {},
    lost: {},
    estimateUsd: 0.1,
    clipUsd: 0.05,
    viewUsd: 0.04,
  };

  beforeEach(() => {
    artState.data = {
      items: [],
      walkers: [{ ...testWalker }],
      sounds: [],
      music: [],
      recipes: [],
      budget: { spentUsd: 0, balanceUsd: 0, pendingUsd: 0, daySpentUsd: 0, dayClipsUsed: 0 },
      bodies: [
        { id: 'two-legged', name: 'Two-legged, 3 heads tall' },
        { id: 'four-legged', name: 'Four-legged, 2 heads tall' },
        { id: 'six-legged', name: 'Six-legged crawler' },
      ],
      ai: {} as any,
    } as unknown as ArtOverview;
  });

  it('renders four-legged 2 heads tall option in the body dropdown', () => {
    const html = walkerHtml(artState.data!.walkers[0]!);
    expect(html).toContain('<select name="body">');
    expect(html).toContain('<option value="two-legged" selected>Two-legged, 3 heads tall</option>');
    expect(html).toContain('<option value="four-legged">Four-legged, 2 heads tall</option>');
    expect(html).toContain('<option value="six-legged">Six-legged crawler</option>');
  });

  it('selects four-legged when the walker body is four-legged', () => {
    artState.data!.walkers[0]!.body = 'four-legged';
    const html = walkerHtml(artState.data!.walkers[0]!);
    expect(html).toContain('<option value="four-legged" selected>Four-legged, 2 heads tall</option>');
  });

  it('updates w.body on artChange when the body dropdown changes', () => {
    const mockSelect = {
      name: 'body',
      value: 'four-legged',
      dataset: {},
      closest: (selector: string) => {
        if (selector === '.walker') {
          return { dataset: { walker: 'sylvan-cervid' } } as unknown as HTMLElement;
        }
        return null;
      },
    } as unknown as HTMLSelectElement;

    const handled = artChange(mockSelect);
    expect(handled).toBe(true);
    expect(artState.data!.walkers[0]!.body).toBe('four-legged');
  });
});
