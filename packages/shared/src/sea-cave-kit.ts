import { engineModId, modOn } from './mods.ts';

// The Smugglers' Sea Cave Art Kit (wish #75): the sea cave on the Sunlit
// Shore, broken into pieces any land can be built from. Its sea-worn cavern
// tiles and coastal props are painted by the image model chosen in God's
// View (packages/server/src/assets/sea-cave-kit.ts); the props are placed
// with the world editor as set pieces. Switching the wish off takes them
// out of the world and the editor again.

/** The Smugglers' Sea Cave Art Kit wish (issue #75): its pieces stand only while this mod is on. */
export const SEA_CAVE_MOD = engineModId(75);

/** A prop from the kit that the world editor can stand in a land. */
export interface SetPiece {
  /** Its picture's id. */
  id: string;
  name: string;
  /** The tiles it blocks, centred under its picture. */
  footprint: { width: number; height: number };
}

/** The sea cave's props, in the order the editor offers them. */
export const SEA_CAVE_PIECES: readonly SetPiece[] = [
  { id: 'sea-cave-boulder', name: 'Barnacled cave boulder', footprint: { width: 2, height: 1 } },
  { id: 'sea-cave-stalagmite', name: 'Sea-worn stalagmite', footprint: { width: 1, height: 1 } },
  { id: 'sea-cave-glow-barnacles', name: 'Glowing barnacle cluster', footprint: { width: 1, height: 1 } },
  { id: 'sea-cave-tide-pool', name: 'Rock tide pool', footprint: { width: 2, height: 1 } },
  { id: 'sea-cave-crates', name: "Smugglers' crates", footprint: { width: 2, height: 1 } },
  { id: 'sea-cave-rope-nets', name: 'Rope coil and nets', footprint: { width: 1, height: 1 } },
  { id: 'sea-cave-lantern', name: 'Ship lantern post', footprint: { width: 1, height: 1 } },
];

/** The set pieces the world editor can place now: none while the wish is switched off. */
export function setPieces(): readonly SetPiece[] {
  return modOn(SEA_CAVE_MOD) ? SEA_CAVE_PIECES : [];
}

/** A set piece by its picture's id, while the kit is on. */
export function setPiece(id: string): SetPiece | undefined {
  return setPieces().find((p) => p.id === id);
}
