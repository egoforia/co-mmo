// The Architectural Testbed's layout is world edits, shipped as
// arch-testbed.edits.json and laid over a blank land (ARCH_TESTBED_REGION in
// world.ts), so the world editor can read, change and export it like any
// land. Six bays test every architectural group:
// - Bay 1: Ground Enclosed Buildings (Minimal Pavilion & Thresholds)
// - Bay 2: Open Mountain Terraces (Stepped Pedestal & Heights)
// - Bay 3: Multi-Storey Enclosed Buildings (Two-Storey House & Mezzanine)
// - Bay 4: The Overlap Bug Lab (Terrace Overlap & Cutaway Isolation)
// - Bay 5: Subterranean Cavern Vaults (Floors -1 and -2)
// - Bay 6: Vertical Proving Runway (Stairs, Crypts, Viaduct Bridges)
// Its 25 places to look from are bookmark edits in the same file; this file
// hands them to the camera checks by name.
import EDITS from './arch-testbed.edits.json';

/** A place the camera checks look from: a tile (may be halves), its floor, and what it shows. */
export interface TestbedWaypoint {
  x: number;
  y: number;
  floor: number;
  description: string;
}

/** The testbed's bookmarks by name (G1-A to G6-E), in the order they are laid. */
export const ARCH_TESTBED_WAYPOINTS: Record<string, TestbedWaypoint> = Object.fromEntries(
  (EDITS as { kind: string; at?: number[]; name?: string; note?: string; level?: number }[])
    .filter((e) => e.kind === 'bookmark')
    .map((e) => [e.name!, { x: e.at![0]!, y: e.at![1]!, floor: e.level ?? 0, description: e.note ?? '' }]),
);
