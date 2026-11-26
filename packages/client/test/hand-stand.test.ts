import { describe, expect, it } from 'vitest';
import { getStripForKind, workbenchArt } from '../src/art-ui/hand-editor.ts';
import type { WalkerView } from '../src/art-ui/state.ts';

describe('the hand workbench on standing pictures', () => {
  it('edits the points of each way\'s standing picture', () => {
    expect(workbenchArt('sylvan-cervid', 'stand', 'back-left')).toBe('sylvan-cervid-stand-back-left');
    expect(workbenchArt('sylvan-cervid', 'walk', 'back-left')).toBe('sylvan-cervid-walk-back-left');
  });

  it('shows a standing picture as a strip of one frame, none when unpainted', () => {
    const w = { standing: { 'front-left': { url: '/art/x.png', versions: [] }, 'back-left': { versions: [] } } } as unknown as WalkerView;
    expect(getStripForKind(w, 'stand', 'front-left')).toMatchObject({ url: '/art/x.png', frames: 1 });
    expect(getStripForKind(w, 'stand', 'back-left')).toBeUndefined();
  });
});
