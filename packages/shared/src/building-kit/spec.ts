// A kit building as plain data: a footprint in whole bays, and per storey the
// doors and windows in each wall. Wishes and the world describe buildings
// this way; the kit turns the data into exact parts.

import type { DomeSpec, TowerSpec } from './crown.ts';
import type { Side } from './sizes.ts';

/** What fills one bay of a wall. */
export type Opening = 'door' | 'window';

/** One storey's openings: per wall, bay number to what is in it. */
export type StoreyLayout = Partial<Record<Side, Record<number, Opening>>>;

/** Where one flight of stairs goes; with no wall the kit finds a place itself. */
export interface StairPlace {
  storey: number;
  wall?: Side;
  /** Which way along the wall it climbs. */
  up?: 1 | -1;
}

/** A rectangular building, in whole bays. */
export interface BuildingSpec {
  W: number;
  D: number;
  storeys: StoreyLayout[];
  /** A gable roof unless false; 'flat' is a flat roof behind a parapet. */
  roof?: boolean | 'flat';
  /** Battlements along a flat roof's parapet and on flat-topped towers. */
  battlements?: boolean;
  /** Towers centred on the building's corners. */
  towers?: TowerSpec[];
  /** A dome on a flat roof. */
  dome?: DomeSpec;
  /** The ridge runs along a or b; along the longer side when not given. */
  ridge?: 'a' | 'b';
  chimney?: readonly [number, number] | null;
  /** true places a flight between every two storeys. */
  stairs?: boolean | StairPlace[];
}

/** A wall's openings in bay order. */
export function openingsOf(ops: Record<number, Opening> | undefined): [number, Opening][] {
  return Object.entries(ops ?? {})
    .map(([j, kind]): [number, Opening] => [Number(j), kind])
    .sort((x, y) => x[0] - y[0]);
}
