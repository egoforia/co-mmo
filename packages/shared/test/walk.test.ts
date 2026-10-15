import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED } from '../src/constants.ts';
import { BODY_TYPES } from '../src/walk-rig.ts';
import { WALK_DIRECTIONS, walkArtIds, walkDirection, walkFrameRate } from '../src/walk.ts';

describe('walks', () => {
  it('plays one cycle in its cycle time at the player speed, faster for a faster walker', () => {
    expect(walkFrameRate(12, PLAYER_SPEED, 0.6)).toBeCloseTo(20);
    expect(walkFrameRate(12, PLAYER_SPEED / 2, 0.6)).toBeCloseTo(10);
    const body = BODY_TYPES['two-legged']!;
    expect(body.frames / walkFrameRate(body.frames, PLAYER_SPEED, body.cycleSeconds)).toBeCloseTo(body.cycleSeconds);
  });

  it('turns the way the arrow keys point and keeps facing that way when stopped', () => {
    expect(walkDirection(1, 1)).toBe('right');
    expect(walkDirection(0, -1)).toBe('back');
    expect(walkDirection(0, 0, 'left')).toBe('left');
  });

  it('needs a strip for every direction of every walking look', () => {
    expect(walkArtIds()).toHaveLength(2 * WALK_DIRECTIONS.length);
    expect(walkArtIds()).toContain('player-mara-walk-left');
  });
});
