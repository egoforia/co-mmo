import type { RegionMap } from '../world.ts';
import type { DraftOf, EditKindId, EditOf } from './types.ts';

// The contract every kind of world edit keeps. One file per kind in kinds/
// implements it; the registry hands it to the server (checks, stamping),
// the browser (tool name, hint, settings, words in the edit list) and the
// AI Map Architect (the draft's shape), so a new kind is one new file.

/** What the editor knows besides the land: the monster kinds there are, with their names and pictures. */
export interface EditContext {
  creatures: Record<string, { name: string; art: string }>;
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
  | { key: string; label: string; type: 'choice'; choices: (ctx: EditContext) => { id: string; name: string }[] }
  | { key: string; label: string; type: 'number'; min: number; max: number; default: number }
  | { key: string; label: string; type: 'flag'; default: boolean };

/** Everything about one kind of edit. */
export interface EditKind<K extends EditKindId> {
  kind: K;
  /** The tool's name in the editor. */
  name: string;
  /** One or two plain sentences on how to use it. */
  hint: string;
  pointer: EditPointer;
  /** Its settings; filled by the editors in step 4 of the editor plan. */
  fields: EditField[];
  /** The draft as one JSON line, for the AI Map Architect's prompt. */
  shape: string;
  /** Why it cannot be made on this land, in words for the editor, or undefined when it can. */
  check(map: RegionMap, edit: DraftOf<K>, ctx: EditContext): string | undefined;
  /** Lays it over the land; passes over quietly when it no longer fits. */
  apply(map: RegionMap, edit: EditOf<K>): void;
  /** Only the fields this kind has, whatever else was sent, plus what it keeps from the context. */
  keep(draft: DraftOf<K>, ctx: EditContext): DraftOf<K> & { name?: string; asset?: string };
  /** One line for the list of edits. */
  words(edit: DraftOf<K> & { name?: string }, ctx?: EditContext): string;
}
