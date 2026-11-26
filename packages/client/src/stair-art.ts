import { rampLook, rampMirrored, rampWay, stairHeading, type Stairway } from '@co-mmo/shared';

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
  // A ramp's picture stands on its tiles (rampTexture), not at its ends.
  if (s.kind === 'ramp') return undefined;

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

/**
 * A ramp's picture, standing on its tiles on the floor below, and whether it
 * shows mirrored (a ramp climbing west or east):
 * 1. The land's own, if loaded (`ramp-${biome}-${look}-${length}-${way}`)
 * 2. Its explicit art id, if loaded (`s.art.up`)
 * 3. The look's shared picture, if loaded (`ramp-${look}-${length}-${way}`)
 * Undefined until one is painted: then it shows only its labels.
 */
export function rampTexture(scene: TextureRegistry, biome: string | undefined, s: Stairway): { key: string; mirrored: boolean } | undefined {
  if (s.kind !== 'ramp' || !s.climbs) return undefined;
  const look = rampLook(s) ?? 'stone';
  const length = Math.max(s.width, s.height);
  const way = rampWay(s.climbs);
  const keys = [biome && `ramp-${biome}-${look}-${length}-${way}`, s.art?.up, `ramp-${look}-${length}-${way}`];
  const key = keys.find((k): k is string => !!k && scene.textures.exists(k));
  return key ? { key, mirrored: rampMirrored(s.climbs) } : undefined;
}
