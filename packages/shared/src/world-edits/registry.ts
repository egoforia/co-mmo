import type { RegionMap } from '../world.ts';
import type { EditContext, EditKind } from './kind.ts';
import { CLEAR } from './kinds/clear.ts';
import { FLOORS } from './kinds/floors.ts';
import { FOOTPRINT } from './kinds/footprint.ts';
import { HOUSE } from './kinds/house.ts';
import { MOVE } from './kinds/move.ts';
import { PAINT } from './kinds/paint.ts';
import { PIECE } from './kinds/piece.ts';
import { ROAD } from './kinds/road.ts';
import { SPAWN } from './kinds/spawn.ts';
import { SPOT } from './kinds/spot.ts';
import type { EditKindId, EditStamp, WorldEdit, WorldEditDraft } from './types.ts';

// Every kind of world edit, by name. The server, the browser and the AI Map
// Architect look a kind up here and never switch on kinds themselves, so a
// new kind is one file in kinds/ and one line below.

/** Every kind of edit, in the order the editors offer their tools. */
export const EDIT_KINDS: { [K in EditKindId]: EditKind<K> } = {
  paint: PAINT,
  move: MOVE,
  road: ROAD,
  house: HOUSE,
  floors: FLOORS,
  piece: PIECE,
  spawn: SPAWN,
  clear: CLEAR,
  spot: SPOT,
  footprint: FOOTPRINT,
};

/** A kind by its name, when there is one. */
export function editKind(kind: unknown): EditKind<EditKindId> | undefined {
  return typeof kind === 'string' && Object.hasOwn(EDIT_KINDS, kind) ? (EDIT_KINDS[kind as EditKindId] as unknown as EditKind<EditKindId>) : undefined;
}

/** Lays a land's edits over it, in order. Edits that no longer fit (the land changed under them) are passed over. */
export function applyEdits(map: RegionMap, edits: readonly WorldEdit[]): void {
  for (const edit of edits) applyEdit(map, edit);
}

/** Lays one edit over a land. */
export function applyEdit(map: RegionMap, edit: WorldEdit): void {
  editKind(edit.kind)?.apply(map, edit as never);
}

/**
 * Why an edit cannot be made on this land, in words for the editor, or
 * undefined when it can. `creatures` says which monster kinds exist.
 */
export function checkEdit(map: RegionMap, edit: WorldEditDraft, creatures: EditContext['creatures']): string | undefined {
  const kind = editKind(edit?.kind);
  return kind ? kind.check(map, edit as never, { creatures }) : 'The editor does not know that kind of change.';
}

/** A checked draft as it is saved: only its kind's fields, with who made it and when. */
export function stampEdit(draft: WorldEditDraft, stamp: EditStamp, creatures: EditContext['creatures']): WorldEdit {
  return { ...editKind(draft.kind)!.keep(draft as never, { creatures }), ...stamp } as WorldEdit;
}

/** One line for an edit in the list of edits. */
export function editWords(edit: WorldEditDraft & { name?: string }, creatures: EditContext['creatures'] = {}): string {
  return editKind(edit.kind)?.words(edit as never, { creatures }) ?? 'A change the editor does not know';
}

/** The shape of every kind of draft, one per line, for the AI Map Architect's prompt. */
export function editShapes(): string[] {
  return Object.values(EDIT_KINDS).map((k) => `- ${k.shape}`);
}
