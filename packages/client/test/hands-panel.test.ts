import { describe, expect, it } from 'vitest';
import { handsHtml } from '../src/art-ui/walkers.ts';
import { artState, type WalkerView } from '../src/art-ui/state.ts';

const strip = { url: '/art/strip.png', frames: 2, width: 256, height: 192, cycleSeconds: 1, versions: [] };

describe('the hand finder panel', () => {
  it('shows where the hands were found in every animation, each facing its ways', () => {
    const mara = { id: 'player-mara', name: 'Mara', walks: { 'front-left': strip }, runs: { 'front-left': strip, 'front-right': strip }, attacks: { 'back-right': strip } } as unknown as WalkerView;
    artState.data = { items: [] } as unknown as typeof artState.data;
    artState.questions = (['front-left', 'front-right', 'back-right'] as const).map((facing) => ({ facing, prompt: 'Where are the hands?', usual: 'Where are the hands?', own: false, system: '' })) as unknown as typeof artState.questions;
    artState.points = { 'player-mara-run-front-left': { hands: [[0.5, 0.5], null], leftHands: [null, null] } };
    const html = handsHtml(mara);
    expect([...html.matchAll(/<h4>(\w+)<\/h4>/g)].map((m) => m[1])).toEqual(['Walking', 'Running', 'Attacking']);
    expect([...html.matchAll(/data-art-id="([^"]+)"/g)].map((m) => m[1])).toEqual(['player-mara-walk-front-left', 'player-mara-run-front-left', 'player-mara-run-front-right', 'player-mara-attack-back-right']);
    // A run can take the hands of the run facing the other way, but never a walk's.
    expect(html).toContain("Use the towards us, left run's hands, mirrored");
    expect(html).not.toContain("walk's hands, mirrored");
    // Each way's question is shown once, not under every animation.
    expect(html.match(/data-facing="front-left"/g)).toHaveLength(1);
    expect(html).toContain('Find again for every animation of Mara');
  });
});
