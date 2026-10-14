import { describe, expect, it } from 'vitest';
import { Tile, collides, generateSanctum, isBlocking, step, tileAt, PLAYER_SPEED, TICK_SECONDS } from '../src/index.ts';

describe('generateSanctum', () => {
  it('is deterministic for a seed', () => {
    expect(generateSanctum(42).tiles).toEqual(generateSanctum(42).tiles);
    expect(generateSanctum(42).tiles).not.toEqual(generateSanctum(43).tiles);
  });

  it('puts the shrine in the middle and a walkable spawn beside it', () => {
    for (const seed of [1, 1337, 99999]) {
      const map = generateSanctum(seed);
      expect(tileAt(map, map.shrine.x, map.shrine.y)).toBe(Tile.Shrine);
      expect(collides(map, map.spawn.x, map.spawn.y)).toBe(false);
    }
  });

  it('connects the spawn to every edge of the region', () => {
    const map = generateSanctum(1337);
    const seen = new Uint8Array(map.width * map.height);
    const queue = [[Math.floor(map.spawn.x), Math.floor(map.spawn.y)]];
    const edges = new Set<string>();
    while (queue.length) {
      const [x, y] = queue.pop()!;
      if (x! < 0 || y! < 0 || x! >= map.width || y! >= map.height) continue;
      const i = y! * map.width + x!;
      if (seen[i] || isBlocking(map.tiles[i] as Tile)) continue;
      seen[i] = 1;
      if (x === 0) edges.add('west');
      if (y === 0) edges.add('north');
      if (x === map.width - 1) edges.add('east');
      if (y === map.height - 1) edges.add('south');
      queue.push([x! + 1, y!], [x! - 1, y!], [x!, y! + 1], [x!, y! - 1]);
    }
    expect([...edges].sort()).toEqual(['east', 'north', 'south', 'west']);
  });
});

describe('step', () => {
  const map = generateSanctum(1337);

  it('moves at player speed and normalises diagonals', () => {
    const start = map.spawn;
    const right = step(map, start, 1, 0);
    expect(right.x - start.x).toBeCloseTo(PLAYER_SPEED * TICK_SECONDS);
    const diag = step(map, start, 1, 1);
    expect(Math.hypot(diag.x - start.x, diag.y - start.y)).toBeCloseTo(PLAYER_SPEED * TICK_SECONDS);
  });

  it('stops at blocking tiles', () => {
    // Walk north from the spawn into the shrine.
    let pos = map.spawn;
    for (let i = 0; i < 100; i++) pos = step(map, pos, 0, -1);
    expect(collides(map, pos.x, pos.y)).toBe(false);
    expect(pos.y).toBeGreaterThan(map.shrine.y + 1);
  });

  it('never leaves the region', () => {
    let pos = map.spawn;
    for (let i = 0; i < 1000; i++) pos = step(map, pos, 0, 1);
    expect(pos.y).toBeLessThan(map.height);
  });
});
