import { describe, expect, it } from 'vitest';
import { swapHands } from '../src/art-ui/hand-editor.ts';

describe('swapping right and left hands', () => {
  const right: ([number, number] | null)[] = [[0.1, 0.5], [0.2, 0.5], null];
  const left: ([number, number] | null)[] = [[0.9, 0.5], null, [0.7, 0.4]];

  it('trades them on one frame only', () => {
    expect(swapHands(right, left, 3, 1)).toEqual({ hands: [[0.1, 0.5], null, null], leftHands: [[0.9, 0.5], [0.2, 0.5], [0.7, 0.4]] });
  });

  it('trades them on every frame, filling missing frames with none', () => {
    expect(swapHands(right, left.slice(0, 1), 3)).toEqual({ hands: [[0.9, 0.5], null, null], leftHands: [[0.1, 0.5], [0.2, 0.5], null] });
  });
});
