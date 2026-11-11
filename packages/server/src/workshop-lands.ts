import { WORLD_REGIONS, hashString, editKind, type RegionDef, type WorldEdit, type WorldEditDraft } from '@co-mmo/shared';
import type { WorkshopLand } from './store.ts';

// Workshop lands (world editor v2): blank lands the Owner and Stewards make
// in the editor to build on, off the world grid, reached by teleport. Each is
// kept with its edits in the store (WorldEditLog.land) and set up again at
// start. A land's edits go out as a file and come back in on another land.

/** Workshop lands stand on this row of the world grid, two squares apart, so none is beside another land. */
const ROW = 100;

/** The looks a workshop land may take: the biomes of the lands the game ships with. */
export const WORKSHOP_BIOMES = [...new Set(WORLD_REGIONS.map((r) => r.biome))];

/** The land's definition: blank ground in its biome's look, off the grid. */
export function workshopDef(land: WorkshopLand): RegionDef {
  return { id: land.id, name: land.name, biome: land.biome, seed: land.seed, at: { ...land.at }, exits: {}, layout: 'blank', workshop: true };
}

/** A new workshop land's record, or why it cannot be made, in words. */
export function newWorkshopLand(name: unknown, biome: unknown, by: string, defs: RegionDef[], made: number): WorkshopLand | string {
  const words = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (words.length < 2 || words.length > 40) return 'Give the land a name of 2 to 40 letters.';
  if (!WORKSHOP_BIOMES.includes(biome as WorkshopLand['biome'])) return 'Pick one of the looks on offer for the land.';
  const slug = words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'land';
  const id = `workshop-${slug}`;
  if (defs.some((d) => d.id === id || d.name.toLowerCase() === words.toLowerCase())) return 'A land of that name is already there. Pick another name.';
  const taken = new Set(defs.map((d) => `${d.at.x},${d.at.y}`));
  let x = 0;
  while (taken.has(`${x},${ROW}`)) x += 2;
  return { id, name: words, biome: biome as WorkshopLand['biome'], seed: hashString(id), at: { x, y: ROW }, by, made };
}

/** A land's edits as drafts, for a file: who made them and when are left out, so they can be laid on any land. */
export function exportDrafts(edits: readonly WorldEdit[]): WorldEditDraft[] {
  return edits.filter((e) => editKind(e.kind)).map((e) => {
    const { id: _, by: __, made: ___, ...draft } = e;
    // A spawn's monster name and picture are taken again from the monster when the file is laid.
    if (draft.kind === 'spawn') {
      delete draft.name;
      delete draft.asset;
    }
    return draft as WorldEditDraft;
  });
}
