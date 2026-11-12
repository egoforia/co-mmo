import { MAX_FLOORS } from '../floors.ts';
import type { RegionMap } from '../world.ts';
import type { EditContext, EditKind } from './kind.ts';
import { BOOKMARK } from './kinds/bookmark.ts';
import { CLEAR } from './kinds/clear.ts';
import { FLOORS } from './kinds/floors.ts';
import { FOOTPRINT } from './kinds/footprint.ts';
import { FURNITURE } from './kinds/furniture.ts';
import { HOUSE } from './kinds/house.ts';
import { KIT } from './kinds/kit.ts';
import { LAND } from './kinds/land.ts';
import { LIGHT } from './kinds/light.ts';
import { MOVE } from './kinds/move.ts';
import { MONSTERS } from './kinds/monsters.ts';
import { PAINT } from './kinds/paint.ts';
import { PATROL_PATH } from './kinds/patrol.ts';
import { PERSON } from './kinds/person.ts';
import { QUEST } from './kinds/quest.ts';
import { PIECE } from './kinds/piece.ts';
import { REMOVE } from './kinds/remove.ts';
import { SCENERY } from './kinds/scenery.ts';
import { RESTYLE } from './kinds/restyle.ts';
import { ROAD } from './kinds/road.ts';
import { SPAWN } from './kinds/spawn.ts';
import { SPOT } from './kinds/spot.ts';
import { STAIRS } from './kinds/stairs.ts';
import { STOREY } from './kinds/storey.ts';
import { nameThings } from './names.ts';
import type { EditKindId, EditStamp, WorldEdit, WorldEditDraft } from './types.ts';

// Every kind of world edit, by name. The server, the browser and the AI Map
// Architect look a kind up here and never switch on kinds themselves, so a
// new kind is one file in kinds/ and one line below.

/** Every kind of edit, in the order the editors offer their tools. */
export const EDIT_KINDS: { [K in EditKindId]: EditKind<K> } = {
  paint: PAINT,
  scenery: SCENERY,
  move: MOVE,
  road: ROAD,
  house: HOUSE,
  kit: KIT,
  restyle: RESTYLE,
  floors: FLOORS,
  piece: PIECE,
  spawn: SPAWN,
  monsters: MONSTERS,
  patrol: PATROL_PATH,
  person: PERSON,
  quest: QUEST,
  clear: CLEAR,
  spot: SPOT,
  light: LIGHT,
  footprint: FOOTPRINT,
  storey: STOREY,
  stairs: STAIRS,
  furniture: FURNITURE,
  remove: REMOVE,
  bookmark: BOOKMARK,
  land: LAND,
};

/** A kind by its name, when there is one. */
export function editKind(kind: unknown): EditKind<EditKindId> | undefined {
  return typeof kind === 'string' && Object.hasOwn(EDIT_KINDS, kind) ? (EDIT_KINDS[kind as EditKindId] as unknown as EditKind<EditKindId>) : undefined;
}

/**
 * Lays a land's edits over it, in order, naming what each lays after it.
 * Edits that no longer fit (the land changed under them) are passed over and
 * listed in `map.unlaid`.
 */
export function applyEdits(map: RegionMap, edits: readonly WorldEdit[]): void {
  for (const edit of edits) applyEdit(map, edit);
}

/** Lays one edit over a land; false when it no longer fits and was passed over. */
export function applyEdit(map: RegionMap, edit: WorldEdit): boolean {
  const laid = editKind(edit.kind)?.apply(map, edit as never) ?? false;
  if (!laid) (map.unlaid ??= []).push(edit.id);
  nameThings(map, edit.id);
  return laid;
}

/**
 * A copy of a laid-out land with one more edit on it, without laying the
 * whole land again: for checking an edit (does it block where players
 * arrive?) and for previews. The land itself is laid in full when saved.
 */
export function withEdit(map: RegionMap, edit: WorldEdit): RegionMap {
  const { def, ...rest } = map;
  const copy: RegionMap = { ...structuredClone(rest), def };
  applyEdit(copy, edit);
  return copy;
}

/**
 * Why an edit cannot be made on this land, in words for the editor, or
 * undefined when it can. `creatures` says which monster kinds exist.
 */
export function checkEdit(map: RegionMap, edit: WorldEditDraft, creatures: EditContext['creatures']): string | undefined {
  const kind = editKind(edit?.kind);
  if (!kind) return 'The editor does not know that kind of change.';
  const floor = edit.level ?? 0;
  if (!Number.isInteger(floor) || floor > MAX_FLOORS.up || floor < -MAX_FLOORS.down) return `Floors go from ${MAX_FLOORS.down} below the ground to ${MAX_FLOORS.up} above it.`;
  if (floor && !kind.onFloors) return `The ${kind.name} tool works on the ground floor for now.`;
  if (edit.target !== undefined && (!kind.targets || typeof edit.target !== 'string')) return 'The editor did not understand which thing to change.';
  return kind.check(map, edit as never, { creatures });
}

/** A checked draft as it is saved: only its kind's fields, with who made it and when. */
export function stampEdit(draft: WorldEditDraft, stamp: EditStamp, creatures: EditContext['creatures']): WorldEdit {
  const kind = editKind(draft.kind)!;
  // A tool that works on floors keeps the floor it was used on, the ground too, so a clear made on the ground clears only the ground.
  const level = kind.onFloors && Number.isInteger(draft.level) ? { level: draft.level } : {};
  const target = kind.targets && typeof draft.target === 'string' ? { target: draft.target } : {};
  return { ...kind.keep(draft as never, { creatures }), ...level, ...target, ...stamp } as WorldEdit;
}

/** One line for an edit in the list of edits. */
export function editWords(edit: WorldEditDraft & { name?: string }, creatures: EditContext['creatures'] = {}): string {
  return editKind(edit.kind)?.words(edit as never, { creatures }) ?? 'A change the editor does not know';
}

/** The shape of every kind of draft, one per line, for the AI Map Architect's prompt. */
export function editShapes(): string[] {
  return Object.values(EDIT_KINDS).map((k) => `- ${k.shape}`);
}
