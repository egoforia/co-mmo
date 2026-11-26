import { describe, expect, it } from 'vitest';
import { REGROW_MS } from '../src/gathering.ts';
import { growsBackWords, readyAt, regrowKey, setRegrow, spotState, spotStateArt } from '../src/spot-states.ts';

describe('spot states', () => {
  it('is Picked first, Growing past half way and Ready once grown back', () => {
    const at = 1_000_000 + REGROW_MS;
    expect(spotState(undefined, 1_000_000)).toBe('ready');
    expect(spotState(at, 1_000_000)).toBe('picked');
    expect(spotState(at, 1_000_000 + REGROW_MS * 0.4)).toBe('picked');
    expect(spotState(at, 1_000_000 + REGROW_MS * 0.6)).toBe('growing');
    expect(spotState(at, at)).toBe('ready');
  });

  it('names each state\'s picture after the Ready one', () => {
    expect(spotStateArt('sanctum-sage', 'ready')).toBe('spot-sanctum-sage');
    expect(spotStateArt('sanctum-sage', 'picked')).toBe('spot-sanctum-sage-picked');
    expect(spotStateArt('nothing', 'picked')).toBeUndefined();
  });

  it('keeps timers by land and spot on the character, letting go of those passed', () => {
    const c: { regrow?: Record<string, number> } = {};
    setRegrow(c, 'sanctum', 'sage-0', 500, 100);
    setRegrow(c, 'woods', 'sage-0', 900, 600);
    expect(c.regrow).toEqual({ [regrowKey('woods', 'sage-0')]: 900 });
    expect(readyAt(c, 'woods', 'sage-0', 600)).toBe(900);
    expect(readyAt(c, 'sanctum', 'sage-0', 600)).toBeUndefined();
    expect(readyAt(c, 'woods', 'sage-0', 900)).toBeUndefined();
  });

  it('says when a spot grows back', () => {
    expect(growsBackWords(undefined, 0)).toBe('Ready to gather');
    expect(growsBackWords(60_000, 0)).toBe('Grows back in about 1 minute');
    expect(growsBackWords(150_000, 0)).toBe('Grows back in about 3 minutes');
  });
});
