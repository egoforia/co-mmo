import { describe, expect, it } from 'vitest';
import { BELL_ART, EFFECT_ARTS, STATUSES, THREAD_ART, hitArt, statusArt, statusTag, type StatusId } from '../src/index.ts';

describe('skill pictures', () => {
  it("shows a thread's burst where a Wishweaver's spell strikes, and a bell's where a Bellkeeper's does", () => {
    expect(hitArt('ember-bolt')).toBe(THREAD_ART.ember);
    expect(hitArt('chime')).toBe(BELL_ART);
    expect(hitArt('shield-bash')).toBeUndefined();
    expect(hitArt(undefined)).toBeUndefined();
    expect(new Set(EFFECT_ARTS).size).toBe(EFFECT_ARTS.length);
  });

  it('names only the statuses whose icons are not painted yet', () => {
    const painted = (key: string) => key === statusArt('slowed');
    expect(statusTag('Wolf', ['slowed', 'marked'], painted)).toBe('Wolf · Marked');
    expect(statusTag('Wolf', ['slowed'], painted)).toBe('Wolf');
    expect(statusTag('Wolf', undefined, () => false)).toBe('Wolf');
    expect(new Set((Object.keys(STATUSES) as StatusId[]).map(statusArt)).size).toBe(Object.keys(STATUSES).length);
  });
});
