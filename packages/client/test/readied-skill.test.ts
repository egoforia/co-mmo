import { describe, expect, it } from 'vitest';
import { ReadiedSkill, readyKey } from '../src/readied-skill.ts';

const press = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('the keys that ready a skill', () => {
  it('Ctrl or Shift with 1 to 6, by where the key is', () => {
    expect(readyKey(press('Digit1', { ctrlKey: true }))).toBe(1);
    expect(readyKey(press('Digit6', { shiftKey: true }))).toBe(6);
    expect(readyKey(press('Numpad3', { ctrlKey: true }))).toBe(3);
  });

  it('not a plain number, a number past the hotbar, Alt or Meta', () => {
    expect(readyKey(press('Digit1'))).toBeUndefined();
    expect(readyKey(press('Digit7', { ctrlKey: true }))).toBeUndefined();
    expect(readyKey(press('Digit0', { shiftKey: true }))).toBeUndefined();
    expect(readyKey(press('Digit2', { ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(readyKey(press('Digit2', { metaKey: true }))).toBeUndefined();
    expect(readyKey(press('KeyQ', { ctrlKey: true }))).toBeUndefined();
  });
});

describe('a readied skill', () => {
  it('readies, swaps, and puts down on the same key again', () => {
    const seen: (string | undefined)[] = [];
    const r = new ReadiedSkill((id) => seen.push(id));
    r.toggle('ember-lance');
    r.toggle('frost-ward');
    r.toggle('frost-ward');
    r.clear();
    expect(r.current).toBeUndefined();
    expect(seen).toEqual(['ember-lance', 'frost-ward', undefined]);
  });
});
