import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED } from '../src/constants.ts';
import { BODY_TYPES } from '../src/walk-rig.ts';
import { FACINGS, ISO_WAYS, TURNED, facingSide, isFacing, isRetiredArt, movingArt, walkFrameRate, walkStandArt } from '../src/walk.ts';

describe('walks', () => {
  it('plays one cycle in its cycle time at the player speed, faster for a faster walker', () => {
    expect(walkFrameRate(12, PLAYER_SPEED, 0.6)).toBeCloseTo(20);
    expect(walkFrameRate(12, PLAYER_SPEED / 2, 0.6)).toBeCloseTo(10);
    const body = BODY_TYPES['two-legged']!;
    expect(body.frames / walkFrameRate(body.frames, PLAYER_SPEED, body.cycleSeconds)).toBeCloseTo(body.cycleSeconds);
  });

  it('defines body types for walking including four-legged 2 heads tall', () => {
    expect(BODY_TYPES['four-legged']).toEqual({
      id: 'four-legged',
      name: 'Four-legged, 2 heads tall',
      frames: 12,
      cycleSeconds: 0.6,
    });
    expect(BODY_TYPES['4-legged']).toBe(BODY_TYPES['four-legged']);
    const bodies = Object.values(BODY_TYPES);
    expect(bodies.map((b) => b.id)).toEqual(['two-legged', 'four-legged', 'six-legged']);
  });

  it('faces only the isometric ways, each turned to one side', () => {
    expect(FACINGS).toEqual(ISO_WAYS);
    expect(ISO_WAYS.every(isFacing)).toBe(true);
    expect(['front', 'back', 'left', 'right', 'sideways'].some(isFacing)).toBe(false);
    expect(FACINGS.map(facingSide)).toEqual(['left', 'right', 'left', 'right']);
    expect(FACINGS.map((f) => TURNED[TURNED[f]])).toEqual([...FACINGS]);
    expect(FACINGS.every((f) => facingSide(TURNED[f]) !== facingSide(f))).toBe(true);
    expect(walkStandArt('desert-scarab', 'back-right')).toBe('desert-scarab-stand-back-right');
  });

  it('reads whose walk, run, attack or standing picture an art id is, and tells retired ways apart', () => {
    expect(movingArt('bramble-ursine-run-back-left')).toEqual({ look: 'bramble-ursine', noun: 'run', facing: 'back-left' });
    expect(movingArt('desert-scarab-stand-front-right')).toEqual({ look: 'desert-scarab', noun: 'stand', facing: 'front-right' });
    expect(movingArt('player-mara-walk-front')).toBeUndefined();
    expect(movingArt('player-mara')).toBeUndefined();
    expect(isRetiredArt('player-mara-walk-front')).toBe(true);
    expect(isRetiredArt('woods-mushroom-walk-left')).toBe(true);
    expect(isRetiredArt('player-mara-walk-front-left')).toBe(false);
    expect(isRetiredArt('player-mara')).toBe(false);
    expect(isRetiredArt('item-sword')).toBe(false);
  });
});
