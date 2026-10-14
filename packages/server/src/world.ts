import { OPPOSITE, WORLD_REGIONS, type ClientMessage, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from './region.ts';

export interface SavedPlace {
  regionId: string;
  x: number | null;
  y: number | null;
}

/**
 * All regions, and the moves between them. Today every region runs in this
 * process; the world is the seam where regions move to separate processes.
 */
export class World {
  readonly regions = new Map<string, Region>();
  private readonly where = new Map<string, string>();

  constructor(now: () => number = Date.now, random: () => number = Math.random) {
    for (const def of WORLD_REGIONS) {
      this.regions.set(def.id, new Region(def, {
        worldChat: (m) => this.broadcast(m),
        online: () => this.where.size,
      }, now, random));
    }
  }

  get home(): Region {
    return this.regions.get(WORLD_REGIONS[0]!.id)!;
  }

  region(id: string): Region | undefined {
    return this.regions.get(id);
  }

  regionOf(playerId: string): Region | undefined {
    const id = this.where.get(playerId);
    return id ? this.regions.get(id) : undefined;
  }

  has(playerId: string): boolean {
    return this.where.has(playerId);
  }

  join(info: PlayerInfo, conn: Connection, saved: SavedPlace): void {
    // A second window replaces the first wherever it was.
    const previous = this.regionOf(info.id);
    if (previous && previous.def.id !== saved.regionId) {
      previous.remove(info.id, `${info.name} left.`)?.conn.close('Signed in from another window.');
    }
    const region = this.regions.get(saved.regionId) ?? this.home;
    this.where.set(info.id, region.def.id);
    region.join(info, conn, saved);
  }

  leave(playerId: string): (SavedPlace & { x: number; y: number }) | undefined {
    const region = this.regionOf(playerId);
    if (!region) return undefined;
    const left = region.remove(playerId);
    this.where.delete(playerId);
    return left && { regionId: region.def.id, x: left.x, y: left.y };
  }

  handle(playerId: string, message: ClientMessage): void {
    this.regionOf(playerId)?.handle(playerId, message);
  }

  /** Ticks every region, then moves players who walked off an open edge. */
  tick(): void {
    for (const region of this.regions.values()) {
      for (const { id, side } of region.tick()) {
        const target = this.regions.get(region.def.exits[side] ?? '');
        const arrival = target?.map.entries[OPPOSITE[side]];
        if (!target || !arrival) continue;
        const name = region.nameOf(id) ?? 'Someone';
        const moving = region.remove(id, `${name} set off for ${target.def.name}.`);
        if (!moving) continue;
        this.where.set(id, target.def.id);
        target.join(moving.info, moving.conn, arrival, `${moving.info.name} arrived from ${region.def.name}.`);
      }
    }
  }

  /** Where every online player is, for saving. */
  places(): { id: string; regionId: string; x: number; y: number }[] {
    const result: { id: string; regionId: string; x: number; y: number }[] = [];
    for (const [id, regionId] of this.where) {
      const pos = this.regions.get(regionId)?.position(id);
      if (pos) result.push({ id, regionId, ...pos });
    }
    return result;
  }

  broadcast(message: ServerMessage): void {
    for (const region of this.regions.values()) region.broadcast(message);
  }
}

