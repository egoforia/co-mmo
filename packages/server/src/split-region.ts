import type { Character, ClientMessage, NpcPlacement, PlayerInfo, RegionDef, RegionInfo, RegionMap, ServerMessage, Tile } from '@co-mmo/shared';
import type { CharacterOp, OpResult } from './character-ops.ts';
import { findSpots, type Carry, type Cell, type Connection, type Departure, type Ghosts, type Leaving } from './region.ts';
import type { Placement, RegionHandle } from './region-link.ts';

/** A cell is never narrower than this many tiles, so a region splits into at most four. */
export const MIN_CELL_WIDTH = 16;

/** The strips a region of this width splits into, left to right. */
export function cellsFor(def: RegionDef, width: number, count: number): Cell[] {
  const n = Math.max(1, Math.min(count, Math.floor(width / MIN_CELL_WIDTH)));
  return Array.from({ length: n }, (_, index) => ({
    key: `${def.id}~${index}`,
    index,
    count: n,
    x0: index === 0 ? -Infinity : Math.round((width * index) / n),
    x1: index === n - 1 ? Infinity : Math.round((width * (index + 1)) / n),
  }));
}

/** True when x lies in a cell's strip. */
export const inCell = (cell: Cell, x: number): boolean => x >= cell.x0 && x < cell.x1;

/** The wished things that stand in one cell; creatures keep their numbers so their ids match across cells. */
export function placementsFor(placements: Placement[], cell: Cell): Placement[] {
  return placements.flatMap((p): Placement[] => {
    if (p.kind === 'npc') return inCell(cell, p.npc.x) ? [p] : [];
    const spots = p.spots.map((s, n) => ({ ...s, n })).filter((s) => inCell(cell, s.x));
    return spots.length ? [{ ...p, spots }] : [];
  });
}

/**
 * A crowded region split into cells side by side (design doc, Scaling
 * without a cap: crowded regions are subdivided instead of turning anyone
 * away). To the world it is one region; each cell runs its own strip, here
 * or on a region server. Players walk from cell to cell without noticing,
 * and each cell shows its players what the cells beside it show near the
 * border. Fights, trades and talk stay within a cell.
 */
export class SplitRegion implements RegionHandle {
  readonly map: RegionMap;
  readonly host = 'cells';
  /** Players walking between two cells: where they are going, and their inputs meanwhile. */
  private readonly crossing = new Map<string, { done: Promise<void>; inputs: ClientMessage[] }>();
  /** Set once the region is set up again elsewhere: crossings still under way stop. */
  private closed = false;

  constructor(
    readonly def: RegionDef,
    map: RegionMap,
    readonly cells: RegionHandle[],
    /** Keeps moves under way, so closing waits for them. */
    private readonly track: (p: Promise<unknown>) => void = () => {},
  ) {
    this.map = map;
  }

  get key(): string {
    return this.def.id;
  }

  get info(): RegionInfo {
    return { id: this.def.id, name: this.def.name, def: this.def };
  }

  get online(): number {
    return this.cells.reduce((n, c) => n + c.online, 0) + this.crossing.size;
  }

  playerIds(): string[] {
    return this.cells.flatMap((c) => c.playerIds());
  }

  has(id: string): boolean {
    return this.crossing.has(id) || this.cells.some((c) => c.has(id));
  }

  /** The cell a player is in now. */
  private of(id: string): RegionHandle | undefined {
    return this.cells.find((c) => c.has(id));
  }

  /** The cell whose strip holds x. */
  private at(x: number): RegionHandle {
    return this.cells.find((c) => inCell(c.cell!, x)) ?? this.cells[0]!;
  }

  nameOf(id: string): string | undefined {
    return this.of(id)?.nameOf(id);
  }

  position(id: string): { x: number; y: number } | undefined {
    return this.of(id)?.position(id);
  }

  character(id: string): Character | undefined {
    return this.of(id)?.character(id);
  }

  creatureIds(): string[] {
    return this.cells.flatMap((c) => c.creatureIds());
  }

  creature(id: string): { kind: string; x: number; y: number; hp: number; alive: boolean } | undefined {
    for (const c of this.cells) {
      const found = c.creature(id);
      if (found) return found;
    }
    return undefined;
  }

  findSpots(x: number, y: number, count: number, min?: number, max?: number): { x: number; y: number }[] {
    return findSpots(this.map, x, y, count, min, max);
  }

  nearTile(id: string, tile: Tile, radius: number): boolean {
    return this.of(id)?.nearTile(id, tile, radius) ?? false;
  }

  async nearby(id: string): Promise<string[]> {
    await this.crossing.get(id)?.done;
    return (await this.of(id)?.nearby(id)) ?? [];
  }

  async change(id: string, op: CharacterOp): Promise<OpResult> {
    await this.crossing.get(id)?.done;
    return (await this.of(id)?.change(id, op)) ?? { ok: false };
  }

  tell(id: string, text: string): void {
    this.of(id)?.tell(id, text);
  }

  announce(text: string): void {
    for (const c of this.cells) c.announce(text);
  }

  send(id: string, message: ServerMessage): void {
    this.of(id)?.send(id, message);
  }

  broadcast(message: ServerMessage): void {
    for (const c of this.cells) c.broadcast(message);
  }

  addCreatures(kind: string, spots: { x: number; y: number; n?: number }[]): void {
    for (const c of this.cells) {
      const mine = spots.map((s, i) => ({ ...s, n: s.n ?? i })).filter((s) => inCell(c.cell!, s.x));
      if (mine.length) c.addCreatures(kind, mine);
    }
  }

  addNpc(npc: NpcPlacement): void {
    this.at(npc.x).addNpc(npc);
  }

  removeWish(id: string): void {
    for (const c of this.cells) c.removeWish(id);
  }

  setExits(exits: RegionDef['exits']): void {
    this.def.exits = exits;
    for (const c of this.cells) c.setExits(exits);
  }

  welcomeAll(): void {
    for (const c of this.cells) c.welcomeAll();
  }

  join(info: PlayerInfo, conn: Connection, at: { x: number | null; y: number | null }, character: Character, announce?: string, carry?: Carry, handoff?: boolean): void {
    this.at(at.x ?? this.map.spawn.x).join(info, conn, at, character, announce, carry, handoff);
  }

  remove(id: string, announce?: string): Leaving | undefined | Promise<Leaving | undefined> {
    const crossing = this.crossing.get(id);
    // Halfway between two cells: let them arrive, then take them out.
    if (crossing) return crossing.done.then(() => this.remove(id, announce));
    return this.of(id)?.remove(id, announce);
  }

  handle(id: string, message: ClientMessage): void {
    const crossing = this.crossing.get(id);
    if (crossing) crossing.inputs.push(message);
    else this.of(id)?.handle(id, message);
  }

  /** Ticks the cells here, walks players over borders, and shows each cell what is across them. */
  tick(): Departure[] {
    const out: Departure[] = [];
    this.cells.forEach((c, i) => {
      for (const d of c.tick()) {
        if (d.cell !== undefined) this.cross(d.id, i, d.cell);
        else out.push(d);
      }
      const edge = (c as { edge?: () => Ghosts }).edge;
      // A cell on a region server sends its border itself (see edgeFrom).
      if (edge && c.host === 'gateway') this.edgeFrom(i, edge.call(c));
    });
    return out;
  }

  /** A cell's border, for the cells either side of it. */
  edgeFrom(index: number, ghosts: Ghosts): void {
    for (const n of [index - 1, index + 1]) this.cells[n]?.seeAcross?.(index, ghosts);
  }

  /**
   * Players a cell on a region server let go of: over a border into the next
   * cell, or out of the region (an edge, or a fall), which `onward` handles.
   */
  departed(key: string, list: (Departure & { x: number; y: number })[], onward: (d: Departure) => void): void {
    const index = this.cells.findIndex((c) => c.key === key);
    const cell = this.cells[index];
    if (!cell) return;
    for (const d of list) {
      if (!cell.has(d.id)) continue;
      (cell as { moved?: (id: string, x: number, y: number) => void }).moved?.(d.id, d.x, d.y);
      if (d.cell !== undefined) this.cross(d.id, index, d.cell);
      else onward(d);
    }
  }

  /** Walks a player over a border: out of one cell and into the next, keeping their steps. */
  private cross(id: string, from: number, to: number): void {
    const source = this.cells[from];
    const target = this.cells[to];
    if (!source || !target || this.crossing.has(id)) return;
    const inputs: ClientMessage[] = [];
    const done = (async () => {
      const left = await source.remove(id, '');
      if (!left || this.closed) return;
      target.join(left.info, left.conn, { x: left.x, y: left.y }, left.character, '', left.carry, true);
      // Steps taken on the way over follow them in.
      for (const m of inputs) target.handle(id, m);
    })().finally(() => this.crossing.delete(id));
    this.crossing.set(id, { done, inputs });
    this.track(done);
  }

  /**
   * Takes everyone out of every cell, to set the region up again (split
   * differently, merged, or moved). A cell on `gone`, a server that stopped,
   * cannot answer, so its players are moved from what they were last sent.
   */
  async takeAll(gone?: string): Promise<Leaving[]> {
    await Promise.all([...this.crossing.values()].map((c) => c.done));
    this.closed = true;
    const all: Leaving[] = [];
    for (const c of this.cells) {
      const remote = c as { drop?: (reachable: boolean) => Promise<Leaving[]> };
      if (remote.drop) all.push(...(await remote.drop(c.host !== gone)));
      else for (const id of c.playerIds()) {
        const left = await c.remove(id, '');
        if (left) all.push(left);
      }
    }
    return all;
  }
}
