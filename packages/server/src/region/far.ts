import type { BodyState, CreatureState, EntityState, NpcState } from '@co-mmo/shared';

// Fewer updates for far things (docs/scale.md, Smooth play on any
// connection). With compression on, snapshots are cheap enough that the
// crowd rule (fewer snapshots for everything, see snapshotEvery) starts
// later: above 80 in view, not 40.
//
// Without compression, people and creatures near a player are in every
// snapshot and those further off, toward the edge of sight, only every other
// one. In between, the snapshot names them in `kept`, so the browser keeps
// drawing them, walking on as they were going, until their next word. With
// compression this is not done: the network bench showed snapshots that
// differ from one tick to the next compress worse, so thinning them out sent
// more bytes (about 7.3 KB/s against 6.3 for 40 players), not fewer.

/** Within this many tiles (along either axis) a thing is in every snapshot. */
export const FAR_FROM = 12;

/** How a region thins its snapshots out. */
export interface SnapshotTuning {
  /** Far things are sent in full every this many snapshots (1: always). */
  farEvery: number;
  /** More than this many people and creatures in view and snapshots start coming less often. */
  crowdFrom: number;
}

/** As before this was added: everything every time, crowds from 40. */
export const STEADY: SnapshotTuning = { farEvery: 1, crowdFrom: 40 };

/**
 * The tuning for the game's network choices (socket-net.ts): compressed,
 * crowds from 80 and far things every time; uncompressed, crowds from 40 and
 * far things every other snapshot unless NET_FAR_LESS=off.
 */
export function tuningFor(net: { compress: boolean; farLess?: boolean }): SnapshotTuning {
  if (net.compress) return { farEvery: 1, crowdFrom: 80 };
  return { farEvery: net.farLess === false ? 1 : 2, crowdFrom: 40 };
}

/** What one snapshot holds of the world around a player. */
export interface InView {
  players: EntityState[];
  creatures: CreatureState[];
  bodies: BodyState[];
  npcs: NpcState[];
}

/**
 * Takes far things out of this snapshot unless it is their turn (`turn`
 * counts the player's own snapshots, so each player's far updates fall on
 * their own ticks), and names them in `kept` instead.
 */
export function thinOut(view: InView, at: { x: number; y: number }, turn: number, farEvery: number): InView & { kept: string[] } {
  const kept: string[] = [];
  if (farEvery <= 1 || turn % farEvery === 0) return { ...view, kept };
  const near = (e: { id: string; x: number; y: number }) => {
    if (Math.abs(e.x - at.x) <= FAR_FROM && Math.abs(e.y - at.y) <= FAR_FROM) return true;
    kept.push(e.id);
    return false;
  };
  return {
    players: view.players.filter(near),
    creatures: view.creatures.filter(near),
    bodies: view.bodies.filter(near),
    npcs: view.npcs.filter(near),
    kept,
  };
}

/** How many count toward the crowd rule: far things weigh only as often as they are sent. */
export function crowdOf(view: InView & { kept: string[] }, farEvery: number): number {
  const full = view.players.length + view.creatures.length;
  if (farEvery <= 1) return full;
  // Kept ones were left out this time; on average far things cost 1 / farEvery of a near one.
  return full + view.kept.length / farEvery;
}
