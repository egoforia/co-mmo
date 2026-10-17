// Checks the robot playtester runs on what it sees, beyond "did it work":
// can a player actually reach everything a region holds?

import { ATTACK_RANGE, TALK_RANGE, type RegionMap } from '@co-mmo/shared';
import { canReach, reachable, type Point } from './paths.ts';

/**
 * What in a region a player standing at `from` cannot walk to: its people,
 * its roads out, its building doors, its creatures' homes, and its spawn
 * point. Each line is a finding in plain words.
 */
export function unreachable(map: RegionMap, from: Point): string[] {
  const tiles = reachable(map, from);
  const name = map.def.name;
  const where = (p: Point) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
  const found: string[] = [];
  for (const npc of map.npcs) {
    if (!canReach(map, tiles, npc, TALK_RANGE * 0.9)) found.push(`Nobody can walk up to ${npc.name} in ${name}: they stand at ${where(npc)}.`);
  }
  for (const [side, entry] of Object.entries(map.entries)) {
    if (!canReach(map, tiles, entry, 0.5)) found.push(`The road ${side} out of ${name} cannot be reached on foot: it starts at ${where(entry)}.`);
  }
  for (const b of map.buildings) {
    const door = { x: b.door.x + 1, y: b.door.y + 1.5 };
    if (!canReach(map, tiles, door, 1)) found.push(`The door of the ${b.style} in ${name} cannot be reached: it is at ${where(b.door)}.`);
  }
  for (const c of map.creatures) {
    if (!canReach(map, tiles, c, ATTACK_RANGE)) found.push(`A ${c.name} in ${name} lives where no player can reach it, at ${where(c)}.`);
  }
  if (!canReach(map, tiles, map.spawn, 1)) found.push(`${name}'s spawn point ${where(map.spawn)} is cut off from the rest.`);
  return found;
}
