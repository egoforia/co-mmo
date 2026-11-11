import { Tile, building, type RegionMap } from '../world.ts';
import { addStorey, addStairs } from '../floors.ts';

/**
 * Architectural Clean-Room Testbed Layout.
 * 
 * An isolated proving ground designed to test all 6 architectural groups:
 * - Bay 1: Ground Enclosed Buildings (Minimal Pavilion & Thresholds)
 * - Bay 2: Open Mountain Terraces (Stepped Pedestal & Heights)
 * - Bay 3: Multi-Storey Enclosed Buildings (Two-Storey House & Mezzanine)
 * - Bay 4: The Overlap Bug Lab (Terrace Overlap & Cutaway Isolation)
 * - Bay 5: Subterranean Cavern Vaults (Floors -1 and -2)
 * - Bay 6: Vertical Proving Runway (Stairs, Crypts, Viaduct Bridges)
 */
export function archTestbedLayout(map: RegionMap, _c: number): void {
  // 1. Initialize completely flat, neutral flagstone ground across the entire 256x256 map
  for (let i = 0; i < map.tiles.length; i++) {
    map.tiles[i] = Tile.Ground;
  }

  // Safe spawn in an open plaza
  map.spawn = { x: 30, y: 30 };

  // =========================================================================
  // BAY 1: Ground Enclosed Buildings (G1-A to G1-E)
  // =========================================================================
  // Pavilion A (Primary Test Building): 8x8 inside, 10x10 with walls at (40, 40)
  const pavA = building(map, 40, 40, 8, 8, 'sanctum-inn');
  map.buildings.push(pavA);

  // Pavilion B (Multi-building independence test): 8x8 at (56, 40)
  const pavB = building(map, 56, 40, 8, 8, 'sanctum-inn');
  map.buildings.push(pavB);

  // High-contrast central test marker inside Pavilion A
  map.landmarks.push({
    asset: 'sanctum-inn-furniture-dining-table',
    x: 44.5,
    y: 44.5,
    footprint: { width: 2, height: 2 },
    floor: 0,
  });

  // =========================================================================
  // BAY 2: Open Mountain Terraces (G2-A to G2-E)
  // =========================================================================
  // Tier 1: Floor 1 open terrace (12x12) at (100, 40)
  addStorey(map, { x: 100, y: 40, width: 12, height: 12 }, 1, 'frostpeak-eyrie', undefined, true);

  // Tier 2: Floor 2 open terrace (8x6) atop the northern section of Tier 1
  addStorey(map, { x: 102, y: 40, width: 8, height: 6 }, 2, 'frostpeak-eyrie', undefined, true);

  // Summit Pillar: Floor 4 high open platform (6x6) at (118, 40)
  addStorey(map, { x: 118, y: 40, width: 6, height: 6 }, 4, 'frostpeak-eyrie', undefined, true);

  // =========================================================================
  // BAY 3: Multi-Storey Enclosed Buildings (G3-A to G3-D)
  // =========================================================================
  // Floor 0 Building: 10x10 inside, 12x12 with walls at (40, 100)
  const house0 = building(map, 40, 100, 10, 10, 'sanctum-cathedral');
  map.buildings.push(house0);

  // Floor 1 Enclosed Storey: 12x12 at (40, 100)
  addStorey(map, { x: 40, y: 100, width: 12, height: 12 }, 1, 'sanctum-cathedral', undefined, false);

  // Internal stairs from Floor 0 to Floor 1
  addStairs(map, {
    kind: 'stairs',
    x: 48,
    y: 104,
    width: 2,
    height: 3,
    from: 0,
    climbs: 'north',
  });

  // =========================================================================
  // BAY 4: The Overlap Bug Lab (D1 to D4)
  // =========================================================================
  // Ground Cottage (Floor 0): 8x8 inside, 10x10 with walls at (104, 104)
  const bugCottage = building(map, 104, 104, 8, 8, 'sanctum-scriptorium');
  map.buildings.push(bugCottage);

  // Elevated Terrace (Floor 1): 12x12 at (100, 100)
  // Overlaps the northern half of the cottage (104..112, 104..112)
  // Cantilevers over empty ground to the west (100..103)
  addStorey(map, { x: 100, y: 100, width: 12, height: 12 }, 1, 'frostpeak-eyrie', undefined, true);

  // Standalone Ground Cottage (Floor 0): 6x6 inside at (104, 118)
  const yardCottage = building(map, 104, 118, 6, 6, 'frostpeak-whiteledge-house');
  map.buildings.push(yardCottage);

  // =========================================================================
  // BAY 5: Subterranean Cavern Vaults (G5-A, G5-B)
  // =========================================================================
  // Vault 1 (Floor -1): 10x10 cavern room at (40, 160)
  addStorey(map, { x: 40, y: 160, width: 10, height: 10 }, -1, 'frostpeak-sunken-drafts', undefined, false);
  map.landmarks.push({
    asset: 'sanctum-cathedral-furniture-brazier',
    x: 42,
    y: 162,
    footprint: { width: 1, height: 1 },
    floor: -1,
  });
  map.landmarks.push({
    asset: 'sanctum-cathedral-furniture-brazier',
    x: 47,
    y: 167,
    footprint: { width: 1, height: 1 },
    floor: -1,
  });

  // Vault 2 (Floor -2): 10x10 cavern pit directly below at (40, 160)
  addStorey(map, { x: 40, y: 160, width: 10, height: 10 }, -2, 'frostpeak-sunken-drafts', undefined, false);
  map.landmarks.push({
    asset: 'sanctum-cathedral-furniture-brazier',
    x: 42,
    y: 162,
    footprint: { width: 1, height: 1 },
    floor: -2,
  });
  map.landmarks.push({
    asset: 'sanctum-cathedral-furniture-brazier',
    x: 47,
    y: 167,
    footprint: { width: 1, height: 1 },
    floor: -2,
  });

  // Cavern stairs from Floor -2 up to Floor -1
  addStairs(map, {
    kind: 'stairs',
    x: 44,
    y: 163,
    width: 2,
    height: 3,
    from: -2,
    climbs: 'north',
  });

  // =========================================================================
  // BAY 6: Vertical Proving Runway (G6-A to G6-E)
  // =========================================================================
  // Fixture A: Outdoor Mountain Stairs (Ground -> Floor 1 terrace)
  addStorey(map, { x: 96, y: 154, width: 6, height: 6 }, 1, 'frostpeak-eyrie', undefined, true);
  addStairs(map, {
    kind: 'stairs',
    x: 98,
    y: 158,
    width: 2,
    height: 3,
    from: 0,
    climbs: 'north',
  });

  // Fixture B: Indoor Stairs inside 8x8 enclosed room
  const stairHouse = building(map, 106, 154, 8, 8, 'sanctum-inn');
  map.buildings.push(stairHouse);
  addStorey(map, { x: 106, y: 154, width: 10, height: 10 }, 1, 'sanctum-inn', undefined, false);
  addStairs(map, {
    kind: 'stairs',
    x: 110,
    y: 158,
    width: 2,
    height: 3,
    from: 0,
    climbs: 'north',
  });

  // Fixture C: Crypt Descent (Ground -> Floor -1)
  addStorey(map, { x: 120, y: 154, width: 6, height: 8 }, -1, 'frostpeak-sunken-drafts', undefined, false);
  addStairs(map, {
    kind: 'stairs',
    x: 122,
    y: 159,
    width: 2,
    height: 3,
    from: -1,
    climbs: 'south',
  });

  // Fixture D: Isolated Viaduct Bridge spanning a 4-tile void
  // Pier 1 (south) and Pier 2 (north) on Floor 1
  addStorey(map, { x: 132, y: 154, width: 4, height: 4 }, 1, 'frostpeak-eyrie', undefined, true);
  addStorey(map, { x: 132, y: 166, width: 4, height: 4 }, 1, 'frostpeak-eyrie', undefined, true);
  // Bridge span on Floor 1 connecting the two piers (must be width >= 3)
  addStorey(map, { x: 132, y: 158, width: 4, height: 8 }, 1, 'frostpeak-eyrie', undefined, true);
  // Block tiles on ground to create a chasm void beneath the bridge
  for (let by = 158; by < 166; by++) {
    for (let bx = 131; bx <= 136; bx++) {
      map.tiles[by * map.width + bx] = Tile.Water;
    }
  }

  // Fixture E: Outdoor Terrace Stairs connecting Floor 1 to Floor 2
  addStorey(map, { x: 142, y: 160, width: 6, height: 6 }, 1, 'frostpeak-eyrie', undefined, true);
  addStorey(map, { x: 142, y: 152, width: 6, height: 6 }, 2, 'frostpeak-eyrie', undefined, true);
  addStairs(map, {
    kind: 'stairs',
    x: 144,
    y: 156,
    width: 2,
    height: 6,
    from: 1,
    climbs: 'north',
  });
}

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
  'G2-B': { x: 106, y: 51, floor: 1, description: 'Terrace rim with 20px parapet & cliff skirt' },
  'G2-C': { x: 106, y: 43, floor: 2, description: 'Terrace step-down looking south onto Floor 1' },
  'G2-D': { x: 121, y: 43, floor: 4, description: 'Summit high pillar extreme vertical drop' },
  'G2-E': { x: 106, y: 46, floor: 1, description: 'Terrace abutting rising north wall' },

  // Group 3: Multi-Storey Enclosed Buildings
  'G3-A': { x: 45, y: 116, floor: 0, description: 'Upper closed storey seen from ground' },
  'G3-B': { x: 45, y: 111, floor: 0, description: 'Foreground wall occlusion cutaway' },
  'G3-C': { x: 45, y: 104, floor: 1, description: 'Upper enclosed interior cutaway' },
  'G3-D': { x: 45, y: 108, floor: 1, description: 'Upper mezzanine looking down into Floor 0' },

  // Group 4: The Overlap Bug Lab
  'D1': { x: 107, y: 106, floor: 1, description: 'Terrace directly over ground cottage interior' },
  'D2': { x: 102, y: 106, floor: 1, description: 'Terrace adjacent to bug spot (2 tiles west of cottage)' },
  'D3': { x: 107, y: 111, floor: 1, description: 'Terrace rim looking down at standalone cottage' },
  'D4': { x: 102, y: 115, floor: 0, description: 'Ground looking up at terrace cantilever underside' },

  // Group 5: Subterranean Cavern Vaults
  'G5-A': { x: 45, y: 165, floor: -1, description: 'Subterranean cavern Vault 1 (Floor -1)' },
  'G5-B': { x: 45, y: 165, floor: -2, description: 'Deep cavern pit Vault 2 (Floor -2)' },

  // Group 6: Vertical Proving Runway
  'G6-A': { x: 99, y: 159, floor: 0, description: 'Outdoor stairs (Ground to Floor 1)' },
  'G6-B': { x: 111, y: 159, floor: 0, description: 'Indoor stairs inside building' },
  'G6-C': { x: 123, y: 160, floor: 0, description: 'Crypt descent to Floor -1' },
  'G6-D': { x: 134, y: 162, floor: 1, description: 'Isolated viaduct bridge over chasm void' },
  'G6-E': { x: 145, y: 158, floor: 1, description: 'Terrace stairs connecting Floor 1 to Floor 2' },
};
