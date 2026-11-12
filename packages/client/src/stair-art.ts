import type { Stairway } from '@co-mmo/shared';

export interface TextureRegistry {
  textures: {
    exists(key: string): boolean;
  };
}

/**
 * Resolves the texture key for stairs or a ladder on a floor:
 * 1. An explicit art id on the stairway if set and loaded (`s.art.up` / `s.art.down`)
 * 2. Biome-specific stairs if loaded (`stairs-${biome}-up` / `stairs-${biome}-down`)
 * 3. General biome stairs if loaded (`stairs-${biome}`)
 * 4. Shipped generic fallback (`stairs-up` / `stairs-down`, or `ladder-up` / `ladder-down`)
 */
export function stairTexture(
  scene: TextureRegistry,
  biome: string | undefined,
  s: Stairway,
  isUp: boolean,
): string | undefined {
  const explicit = isUp ? s.art?.up : s.art?.down;
  if (explicit && scene.textures.exists(explicit)) return explicit;

  if (s.kind === 'ladder') {
    if (biome) {
      const biomeLadder = isUp ? `ladder-${biome}-up` : `ladder-${biome}-down`;
      if (scene.textures.exists(biomeLadder)) return biomeLadder;
    }
    const defaultLadder = isUp ? 'ladder-up' : 'ladder-down';
    return scene.textures.exists(defaultLadder) ? defaultLadder : undefined;
  }

  if (biome) {
    const biomeStairs = isUp ? `stairs-${biome}-up` : `stairs-${biome}-down`;
    if (scene.textures.exists(biomeStairs)) return biomeStairs;
    const biomeGeneral = `stairs-${biome}`;
    if (scene.textures.exists(biomeGeneral)) return biomeGeneral;
  }

  const defaultStairs = isUp ? 'stairs-up' : 'stairs-down';
  return scene.textures.exists(defaultStairs) ? defaultStairs : undefined;
}
