import { TUNE_LEVELS } from '../../creature-tune.ts';
import { BEHAVIORS, ITEMS, type Behavior } from '../../rpg.ts';
import type { Active } from '../../sky.ts';
import type { CreatureSpawn, RegionMap } from '../../world.ts';
import type { EditField, FieldValue } from '../kind.ts';
import type { TilePoint } from '../types.ts';

// What the Monsters and Change monsters tools share: a spawn's level, its
// ways and its hours, chosen in the editor ("its own" keeps its kind's), and
// finding the spawn a monster's home belongs to.

/** A spawn's level, ways and hours as an edit carries them: 0 and 'own' are its kind's. */
export interface MonsterWays {
  /** Named apart from an edit's `level`, which is its floor. */
  monsterLevel: number;
  behavior: Behavior | 'own';
  active: Active | 'own';
  /** An item they may leave besides their kind's ('none' for no more), and the chance in a hundred. */
  loot: string;
  lootChance: number;
}

const BEHAVIOR_NAMES: Record<Behavior, string> = {
  wander: 'Wanders, fights only when struck',
  guard: 'Guards its spot',
  chase: 'Chases anyone it sees',
  patrol: 'Walks rounds (or a patrol path)',
  timid: 'Timid: runs from everyone',
  pack: 'Hunts in a pack',
};
const ACTIVE_NAMES: Record<Active, string> = { always: 'Day and night', day: 'By day, asleep at night', night: 'By night, asleep by day' };

/** The editor's settings for a spawn's level, ways and hours. */
export const WAYS_FIELDS: EditField[] = [
  { key: 'monsterLevel', label: 'Level (0 keeps its own)', type: 'number', min: 0, max: TUNE_LEVELS.max, default: 0 },
  { key: 'behavior', label: 'Ways', type: 'choice', choices: () => [{ id: 'own', name: 'Its own' }, ...BEHAVIORS.map((b) => ({ id: b, name: BEHAVIOR_NAMES[b] }))] },
  { key: 'active', label: 'Up and about', type: 'choice', choices: () => [{ id: 'own', name: 'Its own hours' }, ...(Object.keys(ACTIVE_NAMES) as Active[]).map((a) => ({ id: a, name: ACTIVE_NAMES[a] }))] },
  { key: 'loot', label: 'Also leaves', type: 'choice', choices: () => [{ id: 'none', name: 'Only its own loot' }, ...lootable().map((id) => ({ id, name: ITEMS[id]!.name }))] },
  { key: 'lootChance', label: 'Chance of it, in 100', when: (v) => v.loot !== 'none', type: 'number', min: 1, max: 100, default: 25 },
];

/** Items a monster may leave: any the game knows that are not bound to their owner, by name. */
function lootable(): string[] {
  return Object.entries(ITEMS).filter(([, d]) => !d.bound && !d.copy).map(([id]) => id).sort((a, b) => ITEMS[a]!.name.localeCompare(ITEMS[b]!.name));
}

/** The settings as an edit carries them. */
export function waysFrom(v: Record<string, FieldValue>): MonsterWays {
  return {
    monsterLevel: Number(v.monsterLevel) || 0,
    behavior: String(v.behavior ?? 'own') as MonsterWays['behavior'],
    active: String(v.active ?? 'own') as MonsterWays['active'],
    loot: String(v.loot ?? 'none'),
    lootChance: Number(v.lootChance) || 25,
  };
}

/** Why an edit's level, ways or hours cannot be, in words, or undefined. */
export function waysProblem(w: Partial<MonsterWays>): string | undefined {
  const l = w.monsterLevel;
  if (l !== undefined && (!Number.isInteger(l) || (l !== 0 && (l < TUNE_LEVELS.min || l > TUNE_LEVELS.max)))) return `A monster's level is ${TUNE_LEVELS.min} to ${TUNE_LEVELS.max} (0 keeps its own).`;
  if (w.behavior !== undefined && w.behavior !== 'own' && !BEHAVIORS.includes(w.behavior)) return 'The game does not know those ways.';
  if (w.active !== undefined && w.active !== 'own' && !(w.active in ACTIVE_NAMES)) return 'Pick day, night, or day and night.';
  if (w.loot !== undefined && w.loot !== 'none' && (!ITEMS[w.loot] || ITEMS[w.loot]!.bound)) return 'They cannot leave that: pick an item from the list.';
  if (w.lootChance !== undefined && (!Number.isInteger(w.lootChance) || w.lootChance < 1 || w.lootChance > 100)) return 'The chance of loot is 1 to 100 in a hundred.';
  return undefined;
}

/** Sets (or, for 0 and 'own', takes back) a monster's level, ways and hours. */
export function setWays(c: CreatureSpawn, w: Partial<MonsterWays>): void {
  if (w.monsterLevel !== undefined) w.monsterLevel ? (c.level = w.monsterLevel) : delete c.level;
  if (w.behavior !== undefined) w.behavior !== 'own' ? (c.behavior = w.behavior) : delete c.behavior;
  if (w.active !== undefined) w.active !== 'own' ? (c.active = w.active) : delete c.active;
  if (w.loot !== undefined) w.loot !== 'none' ? (c.loot = [{ item: w.loot, chance: (w.lootChance ?? 25) / 100 }]) : delete c.loot;
}

/** Only the ways an edit changes, to keep: 0, 'own' and 'none' (and a chance with no loot) are left out of a new spawn. */
export function keptWays(w: Partial<MonsterWays>, all: boolean): Partial<MonsterWays> {
  const out: Partial<MonsterWays> = {};
  for (const k of ['monsterLevel', 'behavior', 'active', 'loot'] as const) if (w[k] !== undefined && (all || (w[k] !== 0 && w[k] !== 'own' && w[k] !== 'none'))) (out as Record<string, unknown>)[k] = w[k];
  if (out.loot !== undefined && out.loot !== 'none' && w.lootChance !== undefined) out.lootChance = w.lootChance;
  return out;
}

/** The monster whose home is on a tile of a floor, and every monster of its spawn (or it alone, from the land's own layout). */
export function spawnAt(map: RegionMap, [x, y]: TilePoint, floor: number): CreatureSpawn[] {
  const home = map.creatures.find((c) => (c.floor ?? 0) === floor && Math.floor(c.x) === x && Math.floor(c.y) === y);
  if (!home) return [];
  return home.spawn ? map.creatures.filter((c) => c.spawn === home.spawn) : [home];
}
