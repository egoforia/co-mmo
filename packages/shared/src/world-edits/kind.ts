import type { RegionMap } from '../world.ts';
import type { DraftOf, EditKindId, EditOf, TilePoint } from './types.ts';

// The contract every kind of world edit keeps. One file per kind in kinds/
// implements it; the registry hands it to the server (checks, stamping),
// the browser (tool name, hint, settings, words in the edit list) and the
// AI Map Architect (the draft's shape), so a new kind is one new file.

/** What the editor knows besides the land: the monster kinds there are, with their names and pictures. */
export interface EditContext {
  creatures: Record<string, { name: string; art: string; level?: number }>;
}

/** A setting's value as an editor holds it. */
export type FieldValue = string | number | boolean;

/** Where a tool was used: the tile clicked (or picked up from), the tile it goes to for a move, the start for a road, the tiles a stroke covered, and the thing it was used on. */
export interface ToolUse {
  at: TilePoint;
  to?: TilePoint | null;
  from?: TilePoint;
  tiles?: TilePoint[];
  target?: string;
}

/** A box of tiles an editor outlines: where the tool aims, what is held (picked up, a road's start), or a warning (what goes away). */
export interface Outline {
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: 'aim' | 'held' | 'warn';
}

/** How a tool is used on the world. */
export type EditPointer =
  /** One click lays it. */
  | 'click'
  /** Click or drag over tiles, laid when the pointer is let go. */
  | 'drag'
  /** Click where it starts, then where it ends. */
  | 'two-clicks'
  /** Click a thing to pick it up, then where it goes. */
  | 'pick-then-click';

/** One setting a tool offers beside the world, described so any editor can draw it. */
export type EditField =
  | { key: string; label: string; type: 'choice'; choices: (ctx: EditContext) => { id: string; name: string }[]; default?: (ctx: EditContext) => string }
  | { key: string; label: string; type: 'number'; min: number; max: number; default: number }
  | { key: string; label: string; type: 'flag'; default: boolean }
  | { key: string; label: string; type: 'text'; max: number; default: string };

/** Everything about one kind of edit. */
export interface EditKind<K extends EditKindId> {
  kind: K;
  /** The tool's name in the editor. */
  name: string;
  /** One or two plain sentences on how to use it. */
  hint: string;
  pointer: EditPointer;
  /** True when it works on floors above and below the ground too; the rest work on the ground only, for now. */
  onFloors?: boolean;
  /** When it changes one thing, which the editor may name (`target`) instead of a tile: a building, a set piece or piece of furniture, a person, or any named thing. */
  targets?: 'building' | 'piece' | 'thing' | 'person';
  /** Its settings, drawn the same by every editor. */
  fields: EditField[];
  /** False while it has nothing to offer (set pieces while their kit's wish is off). */
  available?(): boolean;
  /** Lines to show under the settings as they are now: the kit building's shape checks. */
  notes?(values: Record<string, FieldValue>): { ok: boolean; text: string }[];
  /** The tiles to outline under the pointer before it is used (one tile when left out); `use.from` is what was picked up or where a road starts. */
  outline?(map: RegionMap, use: ToolUse & { level: number }, values: Record<string, FieldValue>): Outline[];
  /** The draft a tool makes from where it was used and its settings. */
  make(use: ToolUse, values: Record<string, FieldValue>): DraftOf<K>;
  /** The draft as one JSON line, for the AI Map Architect's prompt. */
  shape: string;
  /** Why it cannot be made on this land, in words for the editor, or undefined when it can. */
  check(map: RegionMap, edit: DraftOf<K>, ctx: EditContext): string | undefined;
  /** Lays it over the land; false when it no longer fits and was passed over. */
  apply(map: RegionMap, edit: EditOf<K>): boolean;
  /** Only the fields this kind has, whatever else was sent, plus what it keeps from the context. */
  keep(draft: DraftOf<K>, ctx: EditContext): DraftOf<K> & { name?: string; asset?: string };
  // The registry keeps `level` and `target` for kinds that take them.
  /** One line for the list of edits. */
  words(edit: DraftOf<K> & { name?: string }, ctx?: EditContext): string;
}
