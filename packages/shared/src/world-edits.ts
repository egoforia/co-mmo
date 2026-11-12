// The Owner and Stewards edit the world in the game: move a tree or a set
// piece, paint ground, water, trees and rocks, lay a road, build a house and
// say where monsters live. Each change is a small piece of data kept on its
// land's definition (RegionDef.edits) and laid over the generated land in
// order, the same on the server and in every browser, so an edit is never
// drawn one way and walked another. Taking one out (undo) lays the land out
// again without it.
//
// This file is the face of world-edits/: types.ts (the shapes), kind.ts (the
// contract each kind keeps), tiles.ts (reading a land), names.ts (what
// stands on a land, by name), kinds/ (one file per
// kind of edit) and registry.ts (every kind, and what the server, the browser
// and the AI Map Architect call). Add a kind in kinds/ and the registry.

export * from './world-edits/types.ts';
export type { EditContext, EditField, EditKind, EditPointer } from './world-edits/kind.ts';
export { buildingAt, landmarkAt } from './world-edits/tiles.ts';
export { nameThings, thingById, type Thing, type ThingKind } from './world-edits/names.ts';
export { EDIT_KINDS, applyEdit, applyEdits, checkEdit, editKind, editShapes, editWords, stampEdit, withEdit } from './world-edits/registry.ts';
