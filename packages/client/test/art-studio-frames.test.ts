import { describe, expect, it } from 'vitest';
import type { ArtItem, SoundItem, WalkerView } from '../src/art-ui/state.ts';
import type { StudioAsset } from '../src/art-studio/browser.ts';
import { createActions, stateActions } from '../src/art-studio/create-dock.ts';
import { frameStyle, framesHtml, nextFrame, spotStatesHtml } from '../src/art-studio/frame-strip.ts';

const strip = { url: '/art/bear-walk.png', frames: 12, width: 1200, height: 100, cycleSeconds: 1, versions: [] };
const walker = {
  id: 'bear', name: 'Bear', kind: 'monster', place: { tab: 'monsters' }, walks: { 'front-left': strip }, lost: {},
  standing: { 'front-left': { url: '/a.png', versions: [] }, 'front-right': { versions: [] }, 'back-left': { versions: [] }, 'back-right': { versions: [] } },
  estimateUsd: 0, clipUsd: 0.8, viewUsd: 0.04,
} as unknown as WalkerView;
const asset = (id: string, group: string) => ({ id, name: id, group, status: 'painted', place: { tab: group } }) as StudioAsset;

describe('the frame strip', () => {
  it('shows one frame of a sheet and loops through them', () => {
    expect(frameStyle(strip, 0)).toContain('background-position:0% 0');
    expect(frameStyle(strip, 11)).toContain('background-position:100% 0');
    expect(frameStyle(strip, 0)).toContain('background-size:1200% 100%');
    expect(nextFrame(11, 12)).toBe(0);
    expect(nextFrame(3, 12)).toBe(4);
  });

  it('draws a track per way and marks the frame under the playhead', () => {
    const html = framesHtml(walker, 'walk', 'front-left', 4, false);
    expect(html.match(/data-frame=/g)).toHaveLength(12);
    expect(html).toContain('data-frame="4" data-way="front-left"');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html.match(/No clip yet/g)).toHaveLength(3);
    expect(html).toContain('▶ Play');
  });
});

describe('Create with AI', () => {
  const data = {
    walkers: [walker],
    items: [
      { id: 'cup', name: 'Cup', source: 'shipped', place: { tab: 'items', page: 'x' }, estimateUsd: 0.04, repaintable: true, takesNote: true, url: '/cup.png', normalPaintable: true } as ArtItem,
      { id: 'logo', name: 'Logo', source: 'shipped', place: { tab: 'hud', page: 'x' }, estimateUsd: 0.04, repaintable: false, takesNote: false, why: 'Drawn by hand.' } as ArtItem,
    ],
    sounds: [{ id: 'chime', name: 'Chime', kind: 'effect', prompt: '', versions: [], estimateUsd: 0.01, makeable: true } as SoundItem],
  };

  it('offers a picture its paint and normal map', () => {
    const acts = createActions(asset('cup', 'items'), data);
    expect(Array.isArray(acts) && acts.map((a) => a.ask)).toEqual([{ what: 'paint', asset: 'cup' }, { what: 'normal', asset: 'cup' }]);
    expect(createActions(asset('logo', 'hud'), data)).toBe('Drawn by hand.');
  });

  it('offers a walker its four ways, each way, and clips for the ways painted', () => {
    const acts = createActions(asset('bear', 'monsters'), data);
    if (!Array.isArray(acts)) throw new Error(acts);
    expect(acts[0]!.ask).toEqual({ what: 'ways', walker: 'bear' });
    expect(acts.filter((a) => a.ask.what === 'view')).toHaveLength(4);
    expect(acts.filter((a) => a.ask.what === 'clip').map((a) => a.ask)).toEqual([{ what: 'clip', walker: 'bear', body: 'two-legged', direction: 'front-left' }]);
  });

  it('offers a sound to be made', () => {
    expect(createActions(asset('chime', 'sounds'), data)).toEqual([{ label: 'Make it', ask: { what: 'sound', sound: 'chime' }, usd: 0.01, note: true }]);
  });
});

describe('spot state pictures in the Studio', () => {
  const pic = (id: string, url?: string, more: Partial<ArtItem> = {}) => ({ id, name: id, source: url ? 'painted' : 'missing', ...(url ? { url } : {}), place: { tab: 'biomes', page: 'x' }, estimateUsd: 0.04, repaintable: true, takesNote: true, ...more }) as ArtItem;

  it('offers a spot\'s missing states in one review once its Ready picture is painted, and its land\'s', () => {
    const items = [pic('spot-sanctum-sage', '/s.png'), pic('spot-sanctum-sage-picked'), pic('spot-sanctum-sage-growing'), pic('spot-sanctum-flax', '/f.png'), pic('spot-sanctum-flax-picked'), pic('spot-woods-moss-picked')];
    const acts = stateActions('spot-sanctum-sage', items);
    expect(acts.map((a) => [a.ask, Math.round(a.usd * 100)])).toEqual([
      [{ what: 'paint-group', group: 'spot-states:sanctum-sage' }, 8],
      [{ what: 'paint-group', group: 'spot-states:sanctum' }, 12],
    ]);
    expect(stateActions('spot-sanctum-sage', [pic('spot-sanctum-sage'), pic('spot-sanctum-sage-picked')])).toEqual([]);
    expect(stateActions('item-cup', items)).toEqual([]);
  });

  it('shows a spot\'s three states side by side', () => {
    const html = spotStatesHtml('sanctum-sage', [pic('spot-sanctum-sage', '/s.png'), pic('spot-sanctum-sage-picked')]);
    expect(html.match(/<figure/g)).toHaveLength(3);
    expect(html).toContain('src="/s.png"');
    expect(html.match(/Not painted yet/g)).toHaveLength(2);
    expect(html).toContain('Growing');
  });
});
