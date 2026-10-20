import { randomUUID } from 'node:crypto';
import { CREATURES, checkEdit, generateRegion, isBlocking, tileAt, type RegionMap, type WorldEdit, type WorldEditDraft } from '@co-mmo/shared';
import type { Store, WorldEditLog } from './store.ts';
import type { World } from './world.ts';

/** What an edit, undo or redo came to: the land's edits now, or why it could not be done, in words. */
export type EditResult = { ok: true; log: WorldEditLog } | { ok: false; message: string };

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
