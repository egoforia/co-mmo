import type { Building, Landmark, RegionMap } from '../world.ts';
import type { Stairway, Storey } from '../floors.ts';

// Everything that stands on a land has a name, so an edit can point at the
// thing it changes instead of a tile under it. Generated things are named in
// the order the layout lays them (`gen:building:4`); what an edit lays is
// named after the edit (`<edit id>:landmark:0`). Both come out the same each
// time the land is laid out, on the server and in every browser.

/** The kinds of thing on a land that have names. */
export type ThingKind = 'landmark' | 'building' | 'storey' | 'stairway';

/** A named thing and what kind it is. */
export type Thing =
  | { kind: 'landmark'; thing: Landmark }
  | { kind: 'building'; thing: Building }
  | { kind: 'storey'; thing: Storey }
  | { kind: 'stairway'; thing: Stairway };

const LISTS: [ThingKind, (map: RegionMap) => { id?: string }[]][] = [
  ['landmark', (m) => m.landmarks],
  ['building', (m) => m.buildings],
  ['storey', (m) => m.storeys],
  ['stairway', (m) => m.stairways],
];

/** Names everything on the land that has no name yet, after `prefix` (`gen`, or the edit that laid it). */
export function nameThings(map: RegionMap, prefix: string): void {
  for (const [kind, list] of LISTS) {
    let n = 0;
    for (const thing of list(map)) if (!thing.id) thing.id = `${prefix}:${kind}:${n++}`;
  }
}

/** The thing with this name, when it still stands on the land. */
export function thingById(map: RegionMap, id: string | undefined): Thing | undefined {
  if (!id) return undefined;
  for (const [kind, list] of LISTS) {
    const thing = list(map).find((t) => t.id === id);
    if (thing) return { kind, thing } as Thing;
  }
  return undefined;
}
