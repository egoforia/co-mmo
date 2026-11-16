import { squareTiles, type TileSpot } from './grid.ts';

// Who stands on which tile: one body per tile. A body claims the tile it
// steps onto as the step starts and lets go of the one it leaves, so two
// bodies never end up on one tile and the first to ask wins. Who may pass
// through whom (players through players outside a fight, say) is the
// caller's rule, given as `passes`.

/** Something that stands on tiles: a player, a creature or a person, by id. */
export interface Claimant {
  id: string;
  /** Its square: north-west tile, width and floor. */
  anchor: TileSpot;
  width: number;
  floor: number;
}

const key = (floor: number, tx: number, ty: number) => `${floor}|${tx}|${ty}`;

/** The tiles every body on one land stands on. */
export class TileClaims {
  /** Everyone on each tile, first come first: usually one, more only while someone passable is passed. */
  private readonly standing = new Map<string, string[]>();
  private readonly held = new Map<string, string[]>();

  /** Who stands on a tile of a floor (the first there), if anyone. */
  at(tx: number, ty: number, floor = 0): string | undefined {
    return this.standing.get(key(floor, tx, ty))?.[0];
  }

  /** Everyone on a tile of a floor. */
  allAt(tx: number, ty: number, floor = 0): readonly string[] {
    return this.standing.get(key(floor, tx, ty)) ?? [];
  }

  /** Those, other than `id`, who stand in a square; empty when it is free for them. */
  inTheWay(id: string, anchor: TileSpot, width = 1, floor = 0): string[] {
    const found = new Set<string>();
    for (const t of squareTiles(anchor, width)) for (const who of this.allAt(t.tx, t.ty, floor)) if (who !== id) found.add(who);
    return [...found];
  }

  /**
   * Moves a body's claim to a square, letting go of what it stood on. Refused
   * (false, nothing changed) when someone it may not pass stands there.
   * Bodies it may pass keep their tiles: the mover shares them for a while.
   */
  claim(c: Claimant, passes: (other: string) => boolean = () => false): boolean {
    const blockers = this.inTheWay(c.id, c.anchor, c.width, c.floor);
    if (blockers.some((other) => !passes(other))) return false;
    this.release(c.id);
    const keys: string[] = [];
    for (const t of squareTiles(c.anchor, c.width)) {
      const k = key(c.floor, t.tx, t.ty);
      const here = this.standing.get(k);
      if (here) here.push(c.id);
      else this.standing.set(k, [c.id]);
      keys.push(k);
    }
    this.held.set(c.id, keys);
    return true;
  }

  /** Lets go of every tile a body stands on (it left, fell or was defeated). */
  release(id: string): void {
    for (const k of this.held.get(id) ?? []) {
      const here = this.standing.get(k)?.filter((who) => who !== id);
      if (here?.length) this.standing.set(k, here);
      else this.standing.delete(k);
    }
    this.held.delete(id);
  }

  /** How many bodies hold tiles. */
  get size(): number {
    return this.held.size;
  }
}
