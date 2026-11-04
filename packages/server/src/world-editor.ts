import { randomUUID } from 'node:crypto';
import { BUILDING_STYLES, CREATURES, KIT_HOUSE_FLOORS, PAINT_TILES, SEA_CAVE_PIECES, SPOTS, checkEdit, generateRegion, isBlocking, tileAt, type RegionMap, type WorldEdit, type WorldEditDraft } from '@co-mmo/shared';
import type { Store, WorldEditLog } from './store.ts';
import type { World } from './world.ts';

/** What an edit, undo or redo came to: the land's edits now, or why it could not be done, in words. */
export type EditResult = { ok: true; log: WorldEditLog } | { ok: false; message: string };

/** One step in an AI Map Architect dry-run preview. */
export interface PreviewStep {
  draft: WorldEditDraft;
  summary: string;
  valid: boolean;
  why?: string;
}

/**
 * The world editor (Owner and Stewards): keeps each land's edits in the
 * store with an undo and redo list, and has the world lay the land out
 * again wherever it runs whenever they change. Edits are data on the land
 * (shared world-edits.ts), so the server and every browser lay them the same.
 */
export class WorldEditor {
  constructor(
    private readonly store: Store,
    private readonly world: World,
    private readonly now: () => number = Date.now,
  ) {}

  /** A land's edits and those taken back. */
  log(regionId: string): WorldEditLog {
    return this.store.worldEdits(regionId);
  }

  /** Lists all regions and returns the selected region's full map, edits, and tool palettes for the studio. */
  inspectRegion(regionId?: string): {
    regions: { id: string; name: string; biome: string; width: number; height: number }[];
    region: string;
    map: RegionMap | null;
    edits: WorldEdit[];
    undone: number;
    palettes: {
      tiles: typeof PAINT_TILES;
      houses: { id: string; name: string; biome: string }[];
      houseFloors: typeof KIT_HOUSE_FLOORS;
      pieces: { id: string; name: string; footprint: { width: number; height: number } }[];
      spots: { id: string; name: string; biome: string; art: string }[];
      creatures: { id: string; name: string; art: string; level: number }[];
    };
  } {
    const regions = [...this.world.regions.values()].map((r) => ({
      id: r.def.id,
      name: r.def.name,
      biome: r.def.biome,
      width: r.map.width,
      height: r.map.height,
    }));
    const chosenId = regionId && this.world.region(regionId) ? regionId : (regions[0]?.id ?? 'sanctum');
    const reg = this.world.region(chosenId);
    const log = this.log(chosenId);
    return {
      regions,
      region: chosenId,
      map: reg?.map ?? null,
      edits: log.edits,
      undone: log.undone.length,
      palettes: {
        tiles: PAINT_TILES,
        houses: Object.values(BUILDING_STYLES).map((s) => ({ id: s.id, name: s.name, biome: s.biome })),
        houseFloors: KIT_HOUSE_FLOORS,
        pieces: SEA_CAVE_PIECES.map((p) => ({ id: p.id, name: p.name, footprint: p.footprint })),
        spots: Object.entries(SPOTS).map(([id, s]) => ({ id, name: s.name, biome: s.biome, art: s.art })),
        creatures: Object.entries(CREATURES).map(([id, c]) => ({ id, name: c.name, art: c.art, level: c.level })),
      },
    };
  }

  /** Dry-runs a sequence of `WorldEditDraft[]` on a cloned map without persisting changes. */
  previewBatch(regionId: string, drafts: WorldEditDraft[], by: string): {
    ok: boolean;
    steps: PreviewStep[];
  } {
    const region = this.world.region(regionId);
    if (!region) {
      return { ok: false, steps: drafts.map((d) => ({ draft: d, summary: summarizeDraft(d), valid: false, why: 'There is no land by that name.' })) };
    }
    const log = this.log(regionId);
    const workingEdits: WorldEdit[] = [...log.edits];
    let currentMap = generateRegion({ ...region.def, edits: workingEdits });
    const steps: PreviewStep[] = [];
    for (const draft of drafts) {
      const why = checkEdit(currentMap, draft, CREATURES);
      if (why) {
        steps.push({ draft, summary: summarizeDraft(draft), valid: false, why });
        continue;
      }
      const edit = this.stamp(draft, by);
      const blocked = this.blocks(region.def, [...workingEdits, edit]);
      if (blocked) {
        steps.push({ draft, summary: summarizeDraft(draft), valid: false, why: blocked });
        continue;
      }
      workingEdits.push(edit);
      currentMap = generateRegion({ ...region.def, edits: workingEdits });
      steps.push({ draft, summary: summarizeDraft(draft), valid: true });
    }
    return { ok: steps.some((s) => s.valid), steps };
  }

  /** Applies a batch of validated `WorldEditDraft[]` in one reshape operation. */
  async applyBatch(regionId: string, drafts: WorldEditDraft[], by: string): Promise<EditResult & { applied?: number }> {
    const region = this.world.region(regionId);
    if (!region) return { ok: false, message: 'There is no land by that name.' };
    if (!Array.isArray(drafts) || !drafts.length) return { ok: false, message: 'Pick at least one edit to apply.' };
    const log = this.log(regionId);
    const workingEdits: WorldEdit[] = [...log.edits];
    let currentMap = generateRegion({ ...region.def, edits: workingEdits });
    let applied = 0;
    for (const draft of drafts) {
      const why = checkEdit(currentMap, draft, CREATURES);
      if (why) continue;
      const edit = this.stamp(draft, by);
      const blocked = this.blocks(region.def, [...workingEdits, edit]);
      if (blocked) continue;
      workingEdits.push(edit);
      currentMap = generateRegion({ ...region.def, edits: workingEdits });
      applied++;
    }
    if (!applied) return { ok: false, message: 'None of those edits could be laid on this land.' };
    const saved = await this.save(regionId, { edits: workingEdits, undone: [] });
    return saved.ok ? { ...saved, applied } : saved;
  }

  /** Makes a change to a land, when it fits; redo forgets what was taken back. */
  async add(regionId: string, draft: WorldEditDraft, by: string): Promise<EditResult> {
    const region = this.world.region(regionId);
    if (!region) return { ok: false, message: 'There is no land by that name.' };
    const why = checkEdit(region.map, draft, CREATURES);
    if (why) return { ok: false, message: why };
    const edit = this.stamp(draft, by);
    const log = this.log(regionId);
    const blocked = this.blocks(region.def, [...log.edits, edit]);
    if (blocked) return { ok: false, message: blocked };
    return this.save(regionId, { edits: [...log.edits, edit], undone: [] });
  }

  /** Takes back the newest edit. */
  async undo(regionId: string): Promise<EditResult> {
    const log = this.log(regionId);
    const last = log.edits.at(-1);
    if (!last) return { ok: false, message: 'There is nothing to undo in this land.' };
    return this.save(regionId, { edits: log.edits.slice(0, -1), undone: [...log.undone, last] });
  }

  /** Makes the newest edit taken back again. */
  async redo(regionId: string): Promise<EditResult> {
    const log = this.log(regionId);
    const next = log.undone.at(-1);
    if (!next) return { ok: false, message: 'There is nothing to redo in this land.' };
    const region = this.world.region(regionId);
    const blocked = region && this.blocks(region.def, [...log.edits, next]);
    if (blocked) return { ok: false, message: blocked };
    return this.save(regionId, { edits: [...log.edits, next], undone: log.undone.slice(0, -1) });
  }

  /** Takes back one edit, wherever it is in the list; redo brings it back as the newest. */
  async remove(regionId: string, editId: string): Promise<EditResult> {
    const log = this.log(regionId);
    const edit = log.edits.find((e) => e.id === editId);
    if (!edit) return { ok: false, message: 'That edit is not in this land any more.' };
    return this.save(regionId, { edits: log.edits.filter((e) => e !== edit), undone: [...log.undone, edit] });
  }

  private stamp(draft: WorldEditDraft, by: string): WorldEdit {
    const stamp = { id: randomUUID().slice(0, 8), by, made: this.now() };
    // Only the fields each kind has are kept, whatever else was sent.
    switch (draft.kind) {
      case 'paint': return { kind: 'paint', tile: draft.tile, tiles: draft.tiles.map(([x, y]) => [x, y]), ...stamp };
      case 'move': return { kind: 'move', from: draft.from, to: draft.to, ...stamp };
      case 'road': return { kind: 'road', from: draft.from, to: draft.to, ...stamp };
      case 'house': return { kind: 'house', at: draft.at, floor: draft.floor, style: draft.style, ...stamp };
      case 'clear': return { kind: 'clear', at: draft.at, radius: draft.radius, ...stamp };
      case 'piece': return { kind: 'piece', piece: draft.piece, at: draft.at, ...stamp };
      case 'floors': return { kind: 'floors', at: draft.at, up: draft.up, down: draft.down, ...(draft.ladders ? { ladders: true } : {}), ...stamp };
      case 'footprint': return { kind: 'footprint', at: draft.at, footprint: [draft.footprint[0], draft.footprint[1]], ...stamp };
      case 'spot': return { kind: 'spot', spot: draft.spot, at: draft.at, ...stamp };
      case 'spawn': {
        const def = CREATURES[draft.creature]!;
        return { kind: 'spawn', creature: draft.creature, at: draft.at, count: draft.count, name: def.name, asset: def.art, ...stamp };
      }
    }
  }

  /** Why these edits would shut travellers out of the land (where they arrive is blocked), if they would. */
  private blocks(def: RegionMap['def'], edits: WorldEdit[]): string | undefined {
    const map = generateRegion({ ...def, edits });
    const arrivals = [map.spawn, ...Object.values(map.entries)];
    return arrivals.some((p) => p && isBlocking(tileAt(map, p.x, p.y)))
      ? 'That would block a spot where players arrive in this land. Leave it open.'
      : undefined;
  }

  private async save(regionId: string, log: WorldEditLog): Promise<EditResult> {
    this.store.setWorldEdits(regionId, log);
    await this.world.reshape(regionId);
    return { ok: true, log };
  }
}

/** Human-readable one-line summary of a `WorldEditDraft`. */
export function summarizeDraft(draft: WorldEditDraft): string {
  switch (draft.kind) {
    case 'paint':
      return `Paint ${draft.tiles.length} ${draft.tile} tile${draft.tiles.length === 1 ? '' : 's'}`;
    case 'move':
      return draft.to
        ? `Move (${draft.from[0]}, ${draft.from[1]}) → (${draft.to[0]}, ${draft.to[1]})`
        : `Remove object at (${draft.from[0]}, ${draft.from[1]})`;
    case 'road':
      return `Lay road (${draft.from[0]}, ${draft.from[1]}) → (${draft.to[0]}, ${draft.to[1]})`;
    case 'house':
      return `Build ${BUILDING_STYLES[draft.style]?.name ?? draft.style} (${draft.floor[0]}×${draft.floor[1]}) at (${draft.at[0]}, ${draft.at[1]})`;
    case 'floors':
      return `Set floors (+${draft.up} up, -${draft.down} down) at (${draft.at[0]}, ${draft.at[1]})`;
    case 'piece':
      return `Place set piece ${draft.piece} at (${draft.at[0]}, ${draft.at[1]})`;
    case 'spot':
      return draft.spot
        ? `Place gathering spot ${SPOTS[draft.spot]?.name ?? draft.spot} at (${draft.at[0]}, ${draft.at[1]})`
        : `Clear gathering spot at (${draft.at[0]}, ${draft.at[1]})`;
    case 'footprint':
      return `Resize footprint at (${draft.at[0]}, ${draft.at[1]}) to ${draft.footprint[0]}×${draft.footprint[1]}`;
    case 'spawn':
      return `Spawn ${draft.count}× ${CREATURES[draft.creature]?.name ?? draft.creature} at (${draft.at[0]}, ${draft.at[1]})`;
    case 'clear':
      return `Clear monsters within ${draft.radius} tiles of (${draft.at[0]}, ${draft.at[1]})`;
  }
}
