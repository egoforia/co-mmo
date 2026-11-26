import { describe, expect, it } from 'vitest';
import { handsHtml, inspectorHtml } from '../src/art-studio/inspector.ts';
import { studioKey } from '../src/art-studio/keys.ts';
import type { StudioAsset } from '../src/art-studio/browser.ts';

const walker = { id: 'sylvan-cervid', name: 'Sylvan Cervid', group: 'characters', status: 'painted', place: { tab: 'characters', page: 'Mushroom Hollow', walker: 'sylvan-cervid' } } as StudioAsset;

describe('the Inspector\'s Hands and gear', () => {
  it('leads a walker to its hand workbench', () => {
    const html = handsHtml(walker);
    expect(html).toContain('Hands and gear');
    expect(html).toContain('data-hands-focus="sylvan-cervid"');
    expect(html).toContain('data-hands-to="workbench"');
    expect(html).toContain('href="#art/characters/Mushroom%20Hollow?walker=sylvan-cervid"');
    expect(inspectorHtml(walker)).toContain('Edit hands and try gear (H)');
  });

  it('is left out for things that do not walk', () => {
    expect(handsHtml({ ...walker, group: 'pieces', place: { tab: 'scenery', asset: 'x' } } as StudioAsset)).toBe('');
  });

  it('opens with H', () => {
    expect(studioKey({ key: 'h', ctrlKey: false, altKey: false, metaKey: false }, false)).toEqual({ hands: true });
    expect(studioKey({ key: 'h', ctrlKey: false, altKey: false, metaKey: false }, true)).toBeUndefined();
  });
});
