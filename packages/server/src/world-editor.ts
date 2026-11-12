import { randomUUID } from 'node:crypto';
import { BUILDING_STYLES, CREATURES, KIT_HOUSE_FLOORS, PAINT_TILES, SEA_CAVE_PIECES, SPOTS, checkEdit, editWords, generateRegion, isBlocking, stampEdit, tileAt, withEdit, type RegionMap, type WorldEdit, type WorldEditDraft } from '@co-mmo/shared';
import type { Store, WorldEditLog } from './store.ts';
import type { World } from './world.ts';
import { WORKSHOP_BIOMES, exportDrafts, newWorkshopLand, workshopDef } from './workshop-lands.ts';

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
 * New edits are drafts unless made live: the editor sees and checks them on
 * the land as it would be (`editorMap`), players see them once published.
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

  /** The land's edits that no longer fit it and were passed over, by id, drafts included. */
  unlaid(regionId: string): string[] {
    return this.editorMap(regionId)?.unlaid ?? [];
  }

  /** The land as the editor sees it: laid out with its drafts too (the land players see when there are none). */
  editorMap(regionId: string): RegionMap | undefined {
    const region = this.world.region(regionId);
    if (!region) return undefined;
    const { edits } = this.log(regionId);
    if (!edits.some((e) => e.draft)) return region.map;
    return generateRegion({ ...region.def, edits });
  }

  /** Lists all regions and returns the selected region's full map, edits, and tool palettes for the studio. */
  inspectRegion(regionId?: string): {
    regions: { id: string; name: string; biome: string; width: number; height: number; workshop?: boolean }[];
    region: string;
    /** The looks a new workshop land may take. */
    workshopBiomes: string[];
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
      ...(r.def.workshop ? { workshop: true } : {}),
    }));
    const chosenId = regionId && this.world.region(regionId) ? regionId : (regions[0]?.id ?? 'sanctum');
    const reg = this.world.region(chosenId);
    const log = this.log(chosenId);
    return {
      regions,
      region: chosenId,
      workshopBiomes: WORKSHOP_BIOMES,
      map: this.editorMap(chosenId) ?? null,
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
    let currentMap = this.editorMap(regionId)!;
    const steps: PreviewStep[] = [];
    for (const draft of drafts) {
      const why = checkEdit(currentMap, draft, CREATURES);
      if (why) {
        steps.push({ draft, summary: summarizeDraft(draft), valid: false, why });
        continue;
      }
      const next = withEdit(currentMap, this.stamp(draft, by));
      const blocked = blocks(next);
      if (blocked) {
        steps.push({ draft, summary: summarizeDraft(draft), valid: false, why: blocked });
        continue;
      }
      currentMap = next;
      steps.push({ draft, summary: summarizeDraft(draft), valid: true });
    }
    return { ok: steps.some((s) => s.valid), steps };
  }

  /** Applies a batch of validated `WorldEditDraft[]` in one reshape operation. */
  async applyBatch(regionId: string, drafts: WorldEditDraft[], by: string, live = false): Promise<EditResult & { applied?: number }> {
    const region = this.world.region(regionId);
    if (!region) return { ok: false, message: 'There is no land by that name.' };
    if (!Array.isArray(drafts) || !drafts.length) return { ok: false, message: 'Pick at least one edit to apply.' };
    const log = this.log(regionId);
    const workingEdits: WorldEdit[] = [...log.edits];
    let currentMap = this.editorMap(regionId)!;
    let applied = 0;
    for (const draft of drafts) {
      const why = checkEdit(currentMap, draft, CREATURES);
      if (why) continue;
      const edit = this.stamp(draft, by, live);
      const next = withEdit(currentMap, edit);
      if (blocks(next)) continue;
      workingEdits.push(edit);
      currentMap = next;
      applied++;
    }
    if (!applied) return { ok: false, message: 'None of those edits could be laid on this land.' };
    const saved = await this.save(regionId, { edits: workingEdits, undone: [] });
    return saved.ok ? { ...saved, applied } : saved;
  }

  /** Makes a change to a land, when it fits; redo forgets what was taken back. */
  async add(regionId: string, draft: WorldEditDraft, by: string, live = false): Promise<EditResult> {
    return this.addTogether(regionId, [draft], by, live);
  }

  /**
   * Makes changes that belong together (a move is a take-away and a lay-again),
   * all or none: each is checked on the land as the ones before it left it.
   * They share a group, so undo, redo and take out treat them as one step.
   */
  async addTogether(regionId: string, drafts: WorldEditDraft[], by: string, live = false): Promise<EditResult> {
    const region = this.world.region(regionId);
    if (!region) return { ok: false, message: 'There is no land by that name.' };
    if (!drafts.length || drafts.length > MAX_TOGETHER) return { ok: false, message: 'The editor did not understand that change.' };
    const group = drafts.length > 1 ? randomUUID().slice(0, 8) : undefined;
    let map = this.editorMap(regionId)!;
    const made: WorldEdit[] = [];
    for (const draft of drafts) {
      const why = checkEdit(map, draft, CREATURES);
      if (why) return { ok: false, message: why };
      const edit = { ...this.stamp(draft, by, live), ...(group ? { group } : {}) };
      map = withEdit(map, edit);
      made.push(edit);
    }
    const blocked = blocks(map);
    if (blocked) return { ok: false, message: blocked };
    return this.save(regionId, { edits: [...this.log(regionId).edits, ...made], undone: [] });
  }

  /** Takes back the newest edit, or the newest edits made together. */
  async undo(regionId: string): Promise<EditResult> {
    const log = this.log(regionId);
    const step = lastStep(log.edits);
    if (!step.length) return { ok: false, message: 'There is nothing to undo in this land.' };
    return this.save(regionId, { edits: log.edits.slice(0, -step.length), undone: [...log.undone, ...step] });
  }

  /** Makes the newest edit (or edits made together) taken back again. */
  async redo(regionId: string): Promise<EditResult> {
    const log = this.log(regionId);
    const step = lastStep(log.undone);
    if (!step.length) return { ok: false, message: 'There is nothing to redo in this land.' };
    let map = this.editorMap(regionId);
    for (const edit of step) map = map && withEdit(map, edit);
    const blocked = map && blocks(map);
    if (blocked) return { ok: false, message: blocked };
    return this.save(regionId, { edits: [...log.edits, ...step], undone: log.undone.slice(0, -step.length) });
  }

  /** Takes back one edit (with those made together with it), wherever it is in the list; redo brings it back as the newest. */
  async remove(regionId: string, editId: string): Promise<EditResult> {
    const log = this.log(regionId);
    const edit = log.edits.find((e) => e.id === editId);
    if (!edit) return { ok: false, message: 'That edit is not in this land any more.' };
    const gone = log.edits.filter((e) => e === edit || (edit.group && e.group === edit.group));
    return this.save(regionId, { edits: log.edits.filter((e) => !gone.includes(e)), undone: [...log.undone, ...gone] });
  }

  /** Publishes the land's drafts: players see them from now on. */
  async publish(regionId: string): Promise<EditResult> {
    const log = this.log(regionId);
    if (!log.edits.some((e) => e.draft)) return { ok: false, message: 'There are no drafts to publish in this land.' };
    const map = this.editorMap(regionId);
    const blocked = map && blocks(map);
    if (blocked) return { ok: false, message: blocked };
    return this.save(regionId, { edits: log.edits.map(({ draft: _, ...e }) => e as WorldEdit), undone: log.undone });
  }

  /** Throws the land's drafts away; redo brings them back. */
  async discard(regionId: string): Promise<EditResult> {
    const log = this.log(regionId);
    const drafts = log.edits.filter((e) => e.draft);
    if (!drafts.length) return { ok: false, message: 'There are no drafts to throw away in this land.' };
    return this.save(regionId, { edits: log.edits.filter((e) => !e.draft), undone: [...log.undone, ...drafts] });
  }

  /** Makes a blank workshop land to build on (the Owner and Stewards); its id, or why not, in words. */
  createLand(name: unknown, biome: unknown, by: string): { ok: true; region: string } | { ok: false; message: string } {
    const land = newWorkshopLand(name, biome, by, this.world.defs(), this.now());
    if (typeof land === 'string') return { ok: false, message: land };
    if (!this.world.addRegion(workshopDef(land))) return { ok: false, message: 'There is no room for another land just now. Try again.' };
    this.store.setWorldEdits(land.id, { edits: [], undone: [], land });
    return { ok: true, region: land.id };
  }

  /** A land's edits as a file: what it ships with, then the editor's, as drafts any land can take. */
  exportLand(regionId: string): { name: string; biome: string; edits: WorldEditDraft[] } | undefined {
    const region = this.world.region(regionId);
    if (!region) return undefined;
    return { name: region.def.name, biome: region.def.biome, edits: exportDrafts([...(region.def.base ?? []), ...this.log(regionId).edits]) };
  }

  private stamp(draft: WorldEditDraft, by: string, live = false): WorldEdit {
    // Only the fields each kind has are kept, whatever else was sent; a new edit is a draft unless made live.
    return stampEdit(draft, { id: randomUUID().slice(0, 8), by, made: this.now(), ...(live ? {} : { draft: true }) }, CREATURES);
  }

  private async save(regionId: string, log: WorldEditLog): Promise<EditResult> {
    const published = (l: WorldEditLog) => l.edits.filter((e) => !e.draft).map((e) => e.id).join();
    const changed = published(this.log(regionId)) !== published(log);
    this.store.setWorldEdits(regionId, log);
    // Players' land is laid again only when what they see changed.
    if (changed) await this.world.reshape(regionId);
    return { ok: true, log };
  }
}

/** Most edits one step may make together. */
const MAX_TOGETHER = 50;

/** The newest step in a list: its last edit, with those made together with it. */
function lastStep(edits: WorldEdit[]): WorldEdit[] {
  const last = edits.at(-1);
  if (!last?.group) return last ? [last] : [];
  let from = edits.length - 1;
  while (from > 0 && edits[from - 1]!.group === last.group) from--;
  return edits.slice(from);
}

/** Why a land laid out with an edit would shut travellers out (where they arrive is blocked), if it would. */
function blocks(map: RegionMap): string | undefined {
  const arrivals = [map.spawn, ...Object.values(map.entries)];
  return arrivals.some((p) => p && isBlocking(tileAt(map, p.x, p.y)))
    ? 'That would block a spot where players arrive in this land. Leave it open.'
    : undefined;
}

/** One line for a `WorldEditDraft`, as the list of edits words it. */
export function summarizeDraft(draft: WorldEditDraft): string {
  return editWords(draft, CREATURES);
}
