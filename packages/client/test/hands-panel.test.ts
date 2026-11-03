import { beforeEach, describe, expect, it } from 'vitest';
import { artState, type ArtOverview, type WalkerView } from '../src/art-ui/state.ts';
import { handsHtml, triedHtml } from '../src/art-ui/walkers.ts';

const strip = { url: 'art/bramble-ursine-walk-front-left.png', frames: 2, width: 256, height: 192, cycleSeconds: 1 };
const bramble = {
  id: 'bramble-ursine', name: 'Bramble Ursine', place: { tab: 'characters', page: 'Bramble Ursine' },
  walks: { 'front-left': strip, 'front-right': { ...strip, url: 'art/bramble-ursine-walk-front-right.png' } },
} as unknown as WalkerView;
const bow = { id: 'held-bow', name: 'Bow', url: 'art/held-bow.png', place: { tab: 'items', page: 'Weapons' } };

beforeEach(() => {
  artState.data = { items: [bow], walkers: [bramble] } as unknown as ArtOverview;
  artState.points = {};
  artState.mirrored = {};
  artState.tryOn = {};
  artState.sizes = new Map();
});

describe('where the hands were found, on a character page', () => {
  it('shows a row for each isometric walk, with the hands found on every frame', () => {
    artState.points = { 'bramble-ursine-walk-front-left': { hands: [[0.3, 0.5], null], leftHands: [[0.7, 0.5], [0.6, 0.5]] } };
    const html = handsHtml(bramble);
    expect(html).toContain('Where the hands were found');
    expect(html).toContain('data-art-id="bramble-ursine-walk-front-left"');
    expect(html).toContain('data-art-id="bramble-ursine-walk-front-right"');
    expect(html).toContain('towards us, left');
    expect(html.match(/class="dot right"/g)).toHaveLength(1);
    expect(html.match(/class="dot left"/g)).toHaveLength(2);
    // The walk facing the other way has hands, so this one can borrow them mirrored.
    expect(html).toContain('Use the towards us, left walk\'s hands, mirrored');
  });

  it('is left out for a character with no walks yet', () => {
    expect(handsHtml({ ...bramble, walks: {} } as WalkerView)).toBe('');
  });

  it('mirrors a tried item whenever the walker faces left, halfway or fully', () => {
    artState.tryOn = { right: 'held-bow' };
    artState.points = { 'held-bow': { grip: [0.2, 0.8] } };
    artState.sizes.set('art/held-bow.png', [100, 200]);
    expect(triedHtml('front-left', 'right', [0.5, 0.5], 96)).toContain('scaleX(-1)');
    expect(triedHtml('front-right', 'right', [0.5, 0.5], 96)).not.toContain('scaleX(-1)');
  });
});
