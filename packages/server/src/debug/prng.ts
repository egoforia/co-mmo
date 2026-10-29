/**
 * Mulberry32 seeded pseudo-random number generator.
 * Produces a deterministic sequence of floating-point numbers in [0, 1),
 * conforming to `() => number` (the same signature as `Math.random`).
 *
 * @param seed - 32-bit integer seed.
 * @returns PRNG function returning numbers in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function random(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
