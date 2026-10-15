import { describe, expect, it } from 'vitest';
import { WALK_DIRECTIONS, WALK_FRAMES, walkArt, walkArtIds, walkDirection } from '../src/index.ts';

describe('walking', () => {
  it('has a sheet of eight frames for each of four directions of each look', () => {
    expect(WALK_FRAMES).toBe(8);
    expect(WALK_DIRECTIONS).toEqual(['front', 'right', 'left', 'back']);
    expect(walkArtIds()).toContain(walkArt('player-mara', 'back'));
    expect(new Set(walkArtIds()).size).toBe(8);
  });

  it('faces the way the hero walks, sideways winning on a diagonal', () => {
    expect(walkDirection(0, 1)).toBe('front');
    expect(walkDirection(0, -1)).toBe('back');
    expect(walkDirection(1, 0)).toBe('right');
    expect(walkDirection(-1, -1)).toBe('left');
  });

  it('keeps facing the same way when standing still', () => {
    expect(walkDirection(0, 0, 'back')).toBe('back');
    expect(walkDirection(0, 0)).toBe('front');
  });
});
