import { afterEach, describe, expect, it } from 'vitest';
import { GALLEON_ART, GALLEON_MOD, GALLEON_PIECES, switchMod } from '@co-mmo/shared';
import { BIOME_KIT } from '../src/assets/kit.ts';
import { GALLEON_KIT, galleonBox } from '../src/assets/galleon-kit.ts';
import { kitPieces } from '../src/assets/sea-cave-kit.ts';
import { pictureName } from '../src/assets/names.ts';
import { TILE_FRAMING, buildPrompt } from '../src/assets/style.ts';

describe('the Sunken Galleon pictures', () => {
  afterEach(() => switchMod(GALLEON_MOD, true));

  it('describes every tile the decks are drawn in and every prop on them', () => {
    expect(GALLEON_KIT.filter((a) => a.kind === 'tile').map((a) => a.id).sort()).toEqual(Object.values(GALLEON_ART).sort());
    for (const p of Object.values(GALLEON_PIECES)) {
      const asset = GALLEON_KIT.find((a) => a.id === p.id)!;
      expect(asset).toMatchObject({ kind: 'prop', biome: 'sunlit-shore', name: p.name });
      expect(buildPrompt(asset)).toContain(asset.silhouetteHook);
    }
    expect(GALLEON_KIT.filter((a) => BIOME_KIT.some((b) => b.id === a.id))).toEqual([]);
  });

  it('paints the hull side seen from the front, and the deck as ground', () => {
    const face = buildPrompt(GALLEON_KIT.find((a) => a.id === 'galleon-hull-face')!);
    expect(face).toContain('the upright side of a wooden ship hull seen straight on from the front');
    expect(face).not.toContain(TILE_FRAMING);
    expect(buildPrompt(GALLEON_KIT.find((a) => a.id === 'galleon-deck')!)).toContain(TILE_FRAMING);
  });

  it('fits tiles as the biome kit does and props by the tiles they stand on', () => {
    expect(galleonBox('galleon-deck')).toEqual({ width: 128, height: 128 });
    expect(galleonBox('galleon-cannon')).toEqual({ width: 192, height: 160 });
    expect(galleonBox('galleon-lantern')).toEqual({ width: 128, height: 192 });
    expect(galleonBox('shore-rock')).toBeUndefined();
  });

  it('lists the pieces in the Art tab only while the wish is on', () => {
    expect(kitPieces().filter((a) => a.id.startsWith('galleon-'))).toHaveLength(GALLEON_KIT.length);
    expect(pictureName('galleon-chest')).toBe("Captain's chest");
    switchMod(GALLEON_MOD, false);
    expect(kitPieces().filter((a) => a.id.startsWith('galleon-'))).toEqual([]);
  });
});
