import { describe, expect, it } from 'vitest';
import { RAMP_ARTS, artFootprint } from '@co-mmo/shared';
import { RAMP_KIT, rampBox } from '../src/assets/ramp-kit.ts';
import { kitPieces } from '../src/assets/sea-cave-kit.ts';
import { pictureName } from '../src/assets/names.ts';
import { SPRITE_FRAMING, buildPrompt } from '../src/assets/style.ts';

describe('the ramp pictures', () => {
  it('are 12: three looks, two lengths, rising away or toward the camera', () => {
    expect(RAMP_KIT.map((a) => a.id)).toEqual(RAMP_ARTS.map((r) => r.id));
    expect(RAMP_KIT).toHaveLength(12);
    expect(RAMP_KIT.map((a) => a.id)).toContain('ramp-wood-2-toward');
    expect(pictureName('ramp-stone-3-away')).toBe('Stone ramp, 3 long, rising away');
  });

  it('are painted standing on their tiles, 1 across and their length deep, low end and high end where the game puts them', () => {
    expect(artFootprint('ramp-earth-2-away')).toEqual({ width: 1, height: 2 });
    expect(artFootprint('ramp-woods-stone-3-toward')).toEqual({ width: 1, height: 3 });
    const away = buildPrompt(RAMP_KIT.find((a) => a.id === 'ramp-stone-3-away')!, artFootprint('ramp-stone-3-away'));
    expect(away).toContain(SPRITE_FRAMING);
    expect(away).toContain('A straight ramp 3 tiles long and one tile wide');
    expect(away).toContain('Its low end is at the front corner');
    expect(away).toContain('Footprint: it stands on a diamond-shaped patch of ground one tile from the left corner down to the front corner, and 3 tiles from the front corner up to the right corner.');
    expect(buildPrompt(RAMP_KIT.find((a) => a.id === 'ramp-stone-3-toward')!)).toContain('Its high end is at the front corner');
  });

  it('are listed in the Art tab, waiting to be painted', () => {
    expect(kitPieces().filter((a) => a.id.startsWith('ramp-'))).toHaveLength(12);
    expect(rampBox('ramp-wood-3-away')).toEqual({ width: 192, height: 224 });
    expect(rampBox('galleon-deck')).toBeUndefined();
  });
});
