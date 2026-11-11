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
// This file keeps the places the camera checks look from.

/**
 * Deterministic Test Waypoints for All 25 Clean-Room Architectural Combinations.
 */
export const ARCH_TESTBED_WAYPOINTS: Record<string, { x: number; y: number; floor: number; description: string }> = {
  // Group 1: Ground Enclosed Buildings
  'G1-A': { x: 44.5, y: 55, floor: 0, description: 'Closed exterior seen from afar' },
  'G1-B': { x: 44.5, y: 49.5, floor: 0, description: 'Doorway threshold cutaway trigger' },
  'G1-C': { x: 44.5, y: 44.5, floor: 0, description: 'Active interior cutaway on central marker' },
  'G1-D': { x: 44.5, y: 38, floor: 0, description: 'Rear north exterior wall perimeter' },
  'G1-E': { x: 44.5, y: 49.5, floor: 0, description: 'Multi-building independence (Pavilion A cut away, Pavilion B closed)' },

  // Group 2: Open Mountain Terraces
  'G2-A': { x: 106, y: 46, floor: 1, description: 'High terrace open interior floor' },
  'G2-B': { x: 106, y: 50.5, floor: 1, description: 'Terrace rim with 20px parapet & cliff skirt' },
  'G2-C': { x: 106, y: 43, floor: 2, description: 'Terrace step-down looking south onto Floor 1' },
  'G2-D': { x: 121, y: 43, floor: 4, description: 'Summit high pillar extreme vertical drop' },
  'G2-E': { x: 106, y: 46, floor: 1, description: 'Terrace abutting rising north wall' },

  // Group 3: Multi-Storey Enclosed Buildings
  'G3-A': { x: 45, y: 116, floor: 0, description: 'Upper closed storey seen from ground' },
  'G3-B': { x: 45.5, y: 111, floor: 0, description: 'Foreground wall occlusion cutaway' },
  'G3-C': { x: 45, y: 104, floor: 1, description: 'Upper enclosed interior cutaway' },
  'G3-D': { x: 45, y: 108, floor: 1, description: 'Upper mezzanine looking down into Floor 0' },

  // Group 4: The Overlap Bug Lab
  'D1': { x: 107, y: 106, floor: 1, description: 'Terrace directly over ground cottage interior' },
  'D2': { x: 102, y: 106, floor: 1, description: 'Terrace adjacent to bug spot (2 tiles west of cottage)' },
  'D3': { x: 107, y: 110.5, floor: 1, description: 'Terrace rim looking down at standalone cottage' },
  'D4': { x: 102, y: 115, floor: 0, description: 'Ground looking up at terrace cantilever underside' },

  // Group 5: Subterranean Cavern Vaults
  'G5-A': { x: 45, y: 165, floor: -1, description: 'Subterranean cavern Vault 1 (Floor -1)' },
  'G5-B': { x: 45, y: 165, floor: -2, description: 'Deep cavern pit Vault 2 (Floor -2)' },

  // Group 6: Vertical Proving Runway
  'G6-A': { x: 99, y: 159, floor: 0, description: 'Outdoor stairs (Ground to Floor 1)' },
  'G6-B': { x: 111, y: 159, floor: 0, description: 'Indoor stairs inside building' },
  'G6-C': { x: 123, y: 160, floor: 0, description: 'Crypt descent to Floor -1' },
  'G6-D': { x: 134, y: 162, floor: 1, description: 'Isolated viaduct bridge over chasm void' },
  'G6-E': { x: 145, y: 161.5, floor: 1, description: 'Terrace stairs connecting Floor 1 to Floor 2' },
};
