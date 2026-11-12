import { BUILDING_STYLES } from '../../buildings.ts';
import { KitBuilding } from '../../building-kit/building.ts';
import { shapeChecks } from '../../building-kit/checks.ts';
import type { Corner } from '../../building-kit/crown.ts';
import { BAY_TILES } from '../../building-kit/houses.ts';
import type { Side } from '../../building-kit/sizes.ts';
import { openingsOf, type BuildingSpec, type Opening, type StoreyLayout } from '../../building-kit/spec.ts';
import { buildFloors } from '../../floors.ts';
import { Tile, building, set } from '../../world.ts';
import type { EditKind, FieldValue } from '../kind.ts';
import { footprint, inside, overlaps } from '../tiles.ts';

// The kit building designer: a building as the kit builds it (BuildingSpec),
// chosen in the editor (bays across and deep, storeys, doorway, windows,
// roof, battlements, towers, dome, chimney) and checked live with the kit's
// shape checks before it is laid. Laid, it is a walled building of a kit
// look whose kit house is built from this spec instead of its style's.

/** Most bays a kit building may be across or deep, and most storeys. */
export const KIT_LIMITS = { bays: 10, storeys: 4 };

const SIDES: Side[] = ['front', 'right', 'back', 'left'];
const TOWERS: Record<string, Corner[]> = { none: [], front: ['front-left', 'front-right'], back: ['back-left', 'back-right'], all: ['front-left', 'front-right', 'back-left', 'back-right'] };
const TOWER_NAMES: Record<string, string> = { none: 'None', front: 'Two at the front', back: 'Two at the back', all: 'One at every corner' };
const WINDOWS: Record<string, string> = { 'every-other': 'Every other bay', every: 'Every bay', none: 'None' };
/** The bays at each corner a tower takes, by the walls meeting there (as houses.ts). */
const TOWER_ENDS: Record<Corner, [Side, 'start' | 'end'][]> = {
  'front-left': [['front', 'start'], ['left', 'end']],
  'front-right': [['front', 'end'], ['right', 'start']],
  'back-right': [['right', 'end'], ['back', 'start']],
  'back-left': [['back', 'end'], ['left', 'start']],
};

/** Building styles with a kit look, which the designer can build in. */
function kitStyles(): { id: string; name: string }[] {
  return Object.values(BUILDING_STYLES).filter((s) => s.kit).map((s) => ({ id: s.id, name: s.name }));
}

/** The bays along a wall: a, the front and back, runs deep (W); b, the left (with the door) and right, runs across (D). */
const runOf = (spec: Pick<BuildingSpec, 'W' | 'D'>, side: Side) => (side === 'front' || side === 'back' ? spec.W : spec.D);

/** A building's spec from the designer's settings. */
export function designSpec(v: Record<string, FieldValue>): BuildingSpec {
  const D = Number(v.across);
  const W = Number(v.deep);
  const door = Math.min(Number(v.door), D - 1);
  const towers = TOWERS[String(v.towers)] ?? [];
  const flat = v.roof === 'flat';
  const windows = (n: number, skip?: number): Record<number, Opening> => {
    const out: Record<number, Opening> = {};
    if (v.windows === 'none') return out;
    // Every bay, or bays 1, 3, 5...; never the doorway's.
    for (let j = 0; j < n; j++) if (j !== skip && (v.windows === 'every' || j % 2 === 1)) out[j] = 'window';
    return out;
  };
  const storeys: StoreyLayout[] = [];
  for (let s = 0; s < Number(v.storeys); s++) {
    const layout: Record<Side, Record<number, Opening>> = { front: windows(W), right: windows(D), back: windows(W), left: s ? windows(D) : { ...windows(D, door), [door]: 'door' } };
    // A tower takes the bays at its corner.
    for (const corner of towers) for (const [side, end] of TOWER_ENDS[corner]) if (layout[side][end === 'start' ? 0 : runOf({ W, D }, side) - 1] !== 'door') delete layout[side][end === 'start' ? 0 : runOf({ W, D }, side) - 1];
    storeys.push(layout);
  }
  return {
    W,
    D,
    storeys,
    roof: flat ? 'flat' : true,
    ...(flat && v.battlements ? { battlements: true } : {}),
    ...(towers.length ? { towers: towers.map((corner) => ({ corner, ...(flat ? { top: 'flat' as const } : { top: 'cone' as const }) })) } : {}),
    ...(flat && v.dome ? { dome: {} } : {}),
    ...(!flat && v.chimney ? { chimney: W >= D ? [Math.round(W * 7) / 10, D / 2 + 0.25] as const : [W / 2 + 0.25, Math.round(D * 7) / 10] as const } : {}),
  };
}

/** Why a spec cannot be built in the game, in words, or undefined; its shape checks are asked for separately. */
function specProblem(spec: BuildingSpec): string | undefined {
  const bays = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= KIT_LIMITS.bays;
  if (!spec || !bays(spec.W) || !bays(spec.D)) return `A kit building is 1 to ${KIT_LIMITS.bays} bays across and deep.`;
  if (!Array.isArray(spec.storeys) || spec.storeys.length < 1 || spec.storeys.length > KIT_LIMITS.storeys) return `A kit building has 1 to ${KIT_LIMITS.storeys} storeys.`;
  let doors = 0;
  for (const [i, layout] of spec.storeys.entries()) {
    for (const side of SIDES) {
      for (const [bay, what] of openingsOf(layout?.[side])) {
        if (!Number.isInteger(bay) || bay < 0 || bay >= runOf(spec, side) || (what !== 'door' && what !== 'window')) return 'A doorway or window is outside its wall.';
        if (what === 'door') {
          // The game's doorway is in the south wall, on the ground.
          if (i !== 0 || side !== 'left') return 'Its only doorway goes in the south wall of the ground storey.';
          doors++;
        }
      }
    }
  }
  return doors === 1 ? undefined : 'It needs one doorway, in the south wall of the ground storey.';
}

/** The kit's shape checks on a spec: those that failed, in words (none when it holds together). */
export function kitProblems(spec: BuildingSpec): string[] {
  const why = specProblem(spec);
  if (why) return [why];
  try {
    return shapeChecks(new KitBuilding(spec)).filter((c) => !c.ok).map((c) => `${c.check}${c.detail ? `: ${c.detail}` : ''}`);
  } catch (err) {
    return [`The kit could not build it: ${(err as Error).message}`];
  }
}

/** The doorway's bay along the south wall. */
const doorBay = (spec: BuildingSpec) => openingsOf(spec.storeys[0]?.left).find(([, what]) => what === 'door')?.[0] ?? 0;

/** The rectangle of walls a kit building with its walls' top-left corner at `at` stands on. */
const wallsOf = (at: [number, number], spec: Pick<BuildingSpec, 'W' | 'D'>) => ({ x: at[0], y: at[1], width: spec.D * BAY_TILES + 2, height: spec.W * BAY_TILES + 2 });

/** A building of a kit look, built to a spec chosen in the editor. */
export const KIT: EditKind<'kit'> = {
  kind: 'kit',
  name: 'Kit building',
  hint: 'Choose its size, storeys, doorway, windows and roof; the shape checks below say whether it holds together. Click where its north-west corner goes.',
  pointer: 'click',
  fields: [
    { key: 'style', label: 'Look', type: 'choice', choices: kitStyles },
    { key: 'across', label: 'Bays across', type: 'number', min: 1, max: KIT_LIMITS.bays, default: 3 },
    { key: 'deep', label: 'Bays deep', type: 'number', min: 1, max: KIT_LIMITS.bays, default: 3 },
    { key: 'storeys', label: 'Storeys', type: 'number', min: 1, max: KIT_LIMITS.storeys, default: 1 },
    { key: 'door', label: 'Doorway bay (from the west)', type: 'number', min: 0, max: KIT_LIMITS.bays - 1, default: 1 },
    { key: 'windows', label: 'Windows', type: 'choice', choices: () => Object.entries(WINDOWS).map(([id, name]) => ({ id, name })) },
    { key: 'roof', label: 'Roof', type: 'choice', choices: () => [{ id: 'gable', name: 'Gable' }, { id: 'flat', name: 'Flat, behind a parapet' }] },
    { key: 'battlements', label: 'Battlements (flat roof)', type: 'flag', default: false },
    { key: 'towers', label: 'Towers', type: 'choice', choices: () => Object.entries(TOWER_NAMES).map(([id, name]) => ({ id, name })) },
    { key: 'dome', label: 'Dome (flat roof)', type: 'flag', default: false },
    { key: 'chimney', label: 'Chimney (gable roof)', type: 'flag', default: true },
  ],
  shape: '{"kind":"kit","at":[x,y],"style":"<style with a kit look>","spec":{"W":3,"D":3,"storeys":[{"left":{"1":"door"},"front":{"1":"window"}}],"roof":true}}',
  notes(v) {
    const problems = kitProblems(designSpec(v));
    return problems.length ? problems.slice(0, 4).map((text) => ({ ok: false, text })) : [{ ok: true, text: 'Shape checks: every part meets, nothing floats.' }];
  },
  outline(_map, { at }, v) {
    const spec = designSpec(v);
    const walls = wallsOf(at, spec);
    return [{ x: walls.x, y: walls.y, w: walls.width, h: walls.height, ...(kitProblems(spec).length ? { tone: 'warn' as const } : {}) }, { x: at[0] + 1 + doorBay(spec) * BAY_TILES, y: walls.y + walls.height - 1, w: 2, h: 1, tone: 'held' }];
  },
  make: (use, v) => ({ kind: 'kit', at: use.at, style: String(v.style), spec: designSpec(v) }),
  check(map, edit) {
    if (!BUILDING_STYLES[edit.style]?.kit) return 'Pick a look the building kit can build.';
    const problems = kitProblems(edit.spec);
    if (problems.length) return `It does not hold together: ${problems[0]}.`;
    const walls = wallsOf(edit.at, edit.spec);
    if (!inside(map, edit.at) || !inside(map, [walls.x + walls.width, walls.y + walls.height])) return 'It would stand off the edge of this land.';
    const room = { x: walls.x - 1, y: walls.y - 1, width: walls.width + 2, height: walls.height + 2 };
    return map.buildings.some((b) => overlaps(room, b)) ? 'Another building stands there. Leave a tile of room around it.' : undefined;
  },
  apply(map, edit) {
    if (!BUILDING_STYLES[edit.style]?.kit || specProblem(edit.spec)) return false;
    const walls = wallsOf(edit.at, edit.spec);
    const room = { x: walls.x - 1, y: walls.y - 1, width: walls.width + 2, height: walls.height + 2 };
    if (map.buildings.some((b) => overlaps(room, b))) return false;
    map.landmarks = map.landmarks.filter((l) => {
      const f = footprint(l);
      return !overlaps(room, { x: f.left, y: f.top, width: f.width, height: f.height });
    });
    const b = building(map, edit.at[0], edit.at[1], edit.spec.D * BAY_TILES, edit.spec.W * BAY_TILES, edit.style);
    // The doorway where the spec has it, in place of the middle one.
    for (const x of [b.door.x, b.door.x + 1]) set(map, x, b.door.y, Tile.Wall);
    b.door = { x: b.x + 1 + doorBay(edit.spec) * BAY_TILES, y: b.door.y };
    for (const x of [b.door.x, b.door.x + 1]) set(map, x, b.door.y, Tile.Door);
    b.kit = structuredClone(edit.spec);
    map.buildings.push(b);
    // Its upper storeys are floors to walk on, joined by stairs.
    if (edit.spec.storeys.length > 1) buildFloors(map, b, edit.spec.storeys.length - 1, 0);
    return true;
  },
  keep: (d) => ({ kind: 'kit', at: d.at, style: d.style, spec: d.spec }),
  words: (e) => `${BUILDING_STYLES[e.style]?.name ?? 'A kit building'}, ${e.spec.D} × ${e.spec.W} bays, ${e.spec.storeys.length} storey${e.spec.storeys.length === 1 ? '' : 's'}, at ${e.at.join(', ')}`,
};
