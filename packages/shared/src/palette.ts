// Placeholder palette (ENDESGA 32) for the Tier 0 art drawn in code. Generated
// art is colour-graded toward each biome's key palette instead (see biomes.ts
// and the Style Bible); nearestPaletteColor maps a wished-for colour to a
// named one.
export const PALETTE = [
  0xbe4a2f, 0xd77643, 0xead4aa, 0xe4a672, 0xb86f50, 0x733e39, 0x3e2731, 0xa22633,
  0xe43b44, 0xf77622, 0xfeae34, 0xfee761, 0x63c74d, 0x3e8948, 0x265c42, 0x193c3e,
  0x124e89, 0x0099db, 0x2ce8f5, 0xffffff, 0xc0cbdc, 0x8b9bb4, 0x5a6988, 0x3a4466,
  0x262b44, 0x181425, 0xff0044, 0x68386c, 0xb55088, 0xf6757a, 0xe8b796, 0xc28569,
] as const;

/** Colours players' outfits are drawn from (bright, readable on grass). */
export const PLAYER_COLORS = [
  0xe43b44, 0xf77622, 0xfee761, 0x0099db, 0x2ce8f5, 0xb55088, 0xf6757a, 0xffffff,
  0x68386c, 0x124e89,
] as const;

/** Nearest palette colour by squared RGB distance. */
export function nearestPaletteColor(rgb: number): number {
  let best: number = PALETTE[0];
  let bestDist = Infinity;
  for (const c of PALETTE) {
    const dr = ((c >> 16) & 0xff) - ((rgb >> 16) & 0xff);
    const dg = ((c >> 8) & 0xff) - ((rgb >> 8) & 0xff);
    const db = (c & 0xff) - (rgb & 0xff);
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}
