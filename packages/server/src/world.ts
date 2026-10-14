import {
  WEAKENED_MS,
  WORLD_REGIONS,
  arrivalPoint,
  maxHp,
  type Character,
  type ClientMessage,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from './region.ts';

export interface SavedPlace {
  regionId: string;
  x: number | null;
  y: number | null;
}

/** Where a player is and who they are, for saving. */
export interface Place {
  id: string;
  regionId: string;
  x: number;
  y: number;
  character: Character;
}

/**
 * All regions, and the moves between them. Today every region runs in this
 * process; the world is the seam where regions move to separate processes.
 */
export class World {
  readonly regions = new Map<string, Region>();
  private readonly where = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now, random: () => number = Math.random) {
    for (const def of WORLD_REGIONS) {
      this.regions.set(def.id, new Region(def, {
        worldChat: (m) => this.broadcast(m),
        online: () => this.where.size,
        creatorFavor: (wisher, amount) => this.creatorFavor(wisher, amount),
        event: (type, playerId, data) => this.onEvent?.(type, playerId, data),
      }, now, random));
    }
  }

  /** Events for scripted rules: set by whoever runs them (the app, or a rule's test run). */
  onEvent?: (type: 'use' | 'interact' | 'defeat' | 'enter' | 'join', playerId: string, data: Record<string, string | number>) => void;

  /** Credits Favor to a player who is not online (set by the app, which owns storage). */
  offlineFavor?: (playerId: string, amount: number) => void;

  private creatorFavor(wisher: string, amount: number): void {
    const region = this.regionOf(wisher);
    if (!region) return this.offlineFavor?.(wisher, amount);
    region.updateCharacter(wisher, (c) => {
      c.favor += amount;
    });
  }

  /** Sends one player a message, wherever they are. */
  sendTo(playerId: string, message: ServerMessage): void {
    this.regionOf(playerId)?.send(playerId, message);
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

  join(info: PlayerInfo, conn: Connection, saved: SavedPlace, character: Character): void {
    // A second window replaces the first wherever it was, keeping its progress.
    const previous = this.regionOf(info.id);
    character = previous?.character(info.id) ?? character;
    if (previous && previous.def.id !== saved.regionId) {
      previous.remove(info.id, `${info.name} left.`)?.conn.close('Signed in from another window.');
    }
    const region = this.regions.get(saved.regionId) ?? this.home;
    this.where.set(info.id, region.def.id);
    region.join(info, conn, saved, character);
  }

  leave(playerId: string): Place | undefined {
    const region = this.regionOf(playerId);
    if (!region) return undefined;
    const left = region.remove(playerId);
    this.where.delete(playerId);
    return left && { id: playerId, regionId: region.def.id, x: left.x, y: left.y, character: left.character };
  }

  handle(playerId: string, message: ClientMessage): void {
    this.regionOf(playerId)?.handle(playerId, message);
  }

  /** Ticks every region, then moves players who walked off an open edge or fell. */
  tick(): void {
    for (const region of this.regions.values()) {
      for (const departure of region.tick()) {
        const name = region.nameOf(departure.id) ?? 'Someone';
        if (departure.died) {
          // Respawn at the shrine, Weakened for a while; nothing is lost.
          const home = this.home;
          const fallen = region.remove(departure.id, `${name} fell in ${region.def.name}.`);
          if (!fallen) continue;
          fallen.character.hp = maxHp(fallen.character);
          fallen.character.weakenedUntil = this.now() + WEAKENED_MS;
          this.where.set(departure.id, home.def.id);
          home.join(fallen.info, fallen.conn, home.map.spawn, fallen.character, `${name} woke at the shrine of ${home.def.name}.`);
          fallen.conn.send({ t: 'notice', text: `You fell, and woke at the shrine. You are Weakened for ${WEAKENED_MS / 1000} seconds.` });
          continue;
        }
        const target = this.regions.get(region.def.exits[departure.side] ?? '');
        // Keep the player's place along the edge, so crossing feels like one more step.
        const at = region.position(departure.id);
        const arrival = target && at && arrivalPoint(target.map, departure.side, at);
        if (!target || !arrival) continue;
        const moving = region.remove(departure.id, `${name} set off for ${target.def.name}.`);
        if (!moving) continue;
        this.where.set(departure.id, target.def.id);
        target.join(moving.info, moving.conn, arrival, moving.character, `${name} arrived from ${region.def.name}.`);
        this.onEvent?.('enter', departure.id, { region: target.def.id });
      }
    }
  }

  /** Where every online player is, for saving. */
  places(): Place[] {
    const result: Place[] = [];
    for (const [id, regionId] of this.where) {
      const region = this.regions.get(regionId);
      const pos = region?.position(id);
      const character = region?.character(id);
      if (pos && character) result.push({ id, regionId, ...pos, character });
    }
    return result;
  }

  broadcast(message: ServerMessage): void {
    for (const region of this.regions.values()) region.broadcast(message);
  }
}

