import { afterEach, describe, expect, it } from 'vitest';
import { SEA_CAVE_MOD, SEA_CAVE_PIECES, switchMod } from '@co-mmo/shared';
import { BIOME_KIT } from '../src/assets/kit.ts';
import { pictureName } from '../src/assets/names.ts';
import { SEA_CAVE_KIT, kitPieces, seaCaveBox } from '../src/assets/sea-cave-kit.ts';
import { buildPrompt } from '../src/assets/style.ts';

describe("the Smugglers' Sea Cave Art Kit pictures", () => {
  afterEach(() => switchMod(SEA_CAVE_MOD, true));

  it('describes cavern tiles and a picture for every prop the editor places', () => {
    expect(SEA_CAVE_KIT.filter((a) => a.kind === 'tile').map((a) => a.id)).toEqual(['sea-cave-floor', 'sea-cave-wall', 'sea-cave-planks']);
    for (const p of SEA_CAVE_PIECES) {
      const asset = SEA_CAVE_KIT.find((a) => a.id === p.id)!;
      expect(asset).toMatchObject({ kind: 'prop', biome: 'sunlit-shore', name: p.name });
      expect(buildPrompt(asset)).toContain(asset.silhouetteHook);
    }
    // No piece shares an id with the shipped kit, so nothing shipped is painted over.
    expect(SEA_CAVE_KIT.filter((a) => BIOME_KIT.some((b) => b.id === a.id))).toEqual([]);
  });

  it('fits tiles as the biome kit does and props by the tiles they stand on', () => {
    expect(seaCaveBox('sea-cave-floor')).toEqual({ width: 128, height: 128 });
    expect(seaCaveBox('sea-cave-boulder')).toEqual({ width: 192, height: 160 });
    expect(seaCaveBox('sea-cave-lantern')).toEqual({ width: 128, height: 192 });
    expect(seaCaveBox('shore-rock')).toBeUndefined();
  });

  it('lists the kit with the scenery only while the wish is on', () => {
    expect(kitPieces()).toHaveLength(BIOME_KIT.length + SEA_CAVE_KIT.length);
    expect(pictureName('sea-cave-crates')).toBe("Smugglers' crates");
    switchMod(SEA_CAVE_MOD, false);
    expect(kitPieces()).toBe(BIOME_KIT);
    expect(pictureName('sea-cave-crates')).toBe('sea-cave-crates');
  });
});
