import { stairHeading, type Stairway } from '@co-mmo/shared';

export interface TextureRegistry {
  textures: {
    exists(key: string): boolean;
  };
}

/**
 * Resolves the texture key for stairs or a ladder on a floor:
 * 1. An explicit art id on the stairway if set and loaded (`s.art.up` / `s.art.down`)
 * 2. Directional biome-specific stairs if loaded (`stairs-${biome}-${heading}-${dir}`)
 * 3. Base biome-specific stairs if loaded (`stairs-${biome}-${dir}`)
 * 4. General biome stairs if loaded (`stairs-${biome}`)
 * 5. Directional generic fallback (`stairs-${heading}-${dir}`)
 * 6. Shipped generic fallback (`stairs-up` / `stairs-down`, or `ladder-up` / `ladder-down`)
 */
export function stairTexture(
  scene: TextureRegistry,
  biome: string | undefined,
  s: Stairway,
  isUp: boolean,
): string | undefined {
  const explicit = isUp ? s.art?.up : s.art?.down;
  if (explicit && scene.textures.exists(explicit)) return explicit;

  const heading = stairHeading(s);
  const dir = isUp ? 'up' : 'down';

  if (s.kind === 'ladder') {
    if (biome) {
      const biomeLadderHeading = `ladder-${biome}-${heading}-${dir}`;
      if (scene.textures.exists(biomeLadderHeading)) return biomeLadderHeading;
      const biomeLadder = `ladder-${biome}-${dir}`;
      if (scene.textures.exists(biomeLadder)) return biomeLadder;
    }
    const defaultLadderHeading = `ladder-${heading}-${dir}`;
    if (scene.textures.exists(defaultLadderHeading)) return defaultLadderHeading;
    const defaultLadder = `ladder-${dir}`;
    return scene.textures.exists(defaultLadder) ? defaultLadder : undefined;
  }

  if (biome) {
    const biomeStairsHeading = `stairs-${biome}-${heading}-${dir}`;
    if (scene.textures.exists(biomeStairsHeading)) return biomeStairsHeading;
    const biomeStairs = `stairs-${biome}-${dir}`;
    if (scene.textures.exists(biomeStairs)) return biomeStairs;
    const biomeGeneral = `stairs-${biome}`;
    if (scene.textures.exists(biomeGeneral)) return biomeGeneral;
  }

  const defaultStairsHeading = `stairs-${heading}-${dir}`;
  if (scene.textures.exists(defaultStairsHeading)) return defaultStairsHeading;
  const defaultStairs = `stairs-${dir}`;
  return scene.textures.exists(defaultStairs) ? defaultStairs : undefined;
}
