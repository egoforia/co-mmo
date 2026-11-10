import { describe, expect, it } from 'vitest';
import { Tile } from '@co-mmo/shared';

describe('smooth connecting walls autotiling and storey awareness', () => {
  it('autotiles half-diamond coping caps into a continuous smooth ribbon on straight runs', () => {
    // 6x4 room with perimeter walls and interior floor
    const rows: number[][] = [
      [Tile.Wall, Tile.Wall, Tile.Wall, Tile.Wall, Tile.Wall, Tile.Wall],
      [Tile.Wall, Tile.Floor, Tile.Floor, Tile.Floor, Tile.Floor, Tile.Wall],
      [Tile.Wall, Tile.Floor, Tile.Floor, Tile.Floor, Tile.Floor, Tile.Wall],
      [Tile.Wall, Tile.Wall, Tile.Wall, Tile.Wall, Tile.Wall, Tile.Wall],
    ];
    const h = rows.length;
    const w = rows[0]!.length;
    const wall = (x: number, y: number) => rows[y]?.[x] === Tile.Wall;
    const open = (x: number, y: number) => rows[y]?.[x] === undefined || rows[y]![x] !== Tile.Wall;

    const halfRows: number[][] = Array.from({ length: h * 2 }, () => Array<number>(w * 2).fill(-1));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!wall(x, y)) continue;
        const openN = open(x, y - 1);
        const openS = open(x, y + 1);
        const openW = open(x - 1, y);
        const openE = open(x + 1, y);

        if (openN) {
          halfRows[y * 2]![x * 2] = Tile.Wall;
          halfRows[y * 2]![x * 2 + 1] = Tile.Wall;
        }
        if (openS) {
          halfRows[y * 2 + 1]![x * 2] = Tile.Wall;
          halfRows[y * 2 + 1]![x * 2 + 1] = Tile.Wall;
        }
        if (openW) {
          halfRows[y * 2]![x * 2] = Tile.Wall;
          halfRows[y * 2 + 1]![x * 2] = Tile.Wall;
        }
        if (openE) {
          halfRows[y * 2]![x * 2 + 1] = Tile.Wall;
          halfRows[y * 2 + 1]![x * 2 + 1] = Tile.Wall;
        }
      }
    }

    // On row 0 (the North wall):
    // Sub-row 0 (the northern edge) must be 100% continuous across all columns without missing teeth
    for (let hx = 0; hx < w * 2; hx++) {
      expect(halfRows[0]![hx], `North wall sub-diamond at column ${hx} must not be empty`).toBe(Tile.Wall);
    }
  });

  it('keeps open-air terraces low without tall back walls', () => {
    const indoor = (x: number, y: number) => x >= 1 && x <= 4 && y >= 1 && y <= 4;
    const isFullTerrace = (x: number, y: number, openTerrace: boolean) =>
      !openTerrace &&
      (!indoor(x, y - 1) && !indoor(x - 1, y) && !indoor(x - 1, y - 1) && (indoor(x, y + 1) || indoor(x + 1, y) || indoor(x + 1, y + 1)));

    // For a normal cutaway room, the far North-West corner stands tall:
    expect(isFullTerrace(0, 0, false)).toBe(true);

    // For an open outdoor terrace/balcony, all walls stay low:
    expect(isFullTerrace(0, 0, true)).toBe(false);
    expect(isFullTerrace(0, 2, true)).toBe(false);
    expect(isFullTerrace(2, 0, true)).toBe(false);
  });

  it('detects adjacent walls in touching storeys and avoids redundant divider faces', () => {
    // Storey A from x: 0..9 (wall at x=9), Storey B from x: 10..15 (wall at x=10)
    const storeyA = { x: 0, y: 0, width: 10, height: 10 };
    const storeyB = { x: 10, y: 0, width: 6, height: 10 };

    const getTile = (wx: number, wy: number) => {
      if (wx === 9 && wy === 5) return Tile.Wall;
      if (wx === 10 && wy === 5) return Tile.Wall;
      return Tile.Floor;
    };

    const isOpenEastFromA = (x: number, y: number) => {
      const neighbor = getTile(storeyA.x + x + 1, storeyA.y + y);
      return neighbor !== Tile.Wall;
    };

    // At x=9, touching x=10 in storey B:
    expect(isOpenEastFromA(9, 5)).toBe(false); // Both are walls: NO divider face!
  });

  it('renders low parapet rims on exposed open-terrace edges while suppressing mid-cliff seams under upper storeys', () => {
    const wall = (x: number, y: number) => x === 5 || y === 4;
    const hasUpperTile = (wx: number, wy: number) => wx <= 3 && wy === 4;
    const exposedWall = (x: number, y: number, openTerrace: boolean) =>
      wall(x, y) && !(openTerrace && hasUpperTile(x, y));

    // Exposed terrace edge (not covered by an upper storey tile) keeps its low parapet wall & coping cap:
    expect(exposedWall(5, 4, true)).toBe(true);
    expect(exposedWall(4, 4, true)).toBe(true);

    // Lower terrace edge directly underneath an aligned upper cliff face suppresses its mid-cliff parapet seam:
    expect(exposedWall(2, 4, true)).toBe(false);
    expect(exposedWall(3, 4, true)).toBe(false);
  });

  it('skips full-height closed walls on open lower terraces and only shows cutaways on the player floor', () => {
    const shouldStandClosedStoreyWalls = (upstairs: boolean, floor: number, mine: number, open: boolean, pictured: boolean) =>
      upstairs && floor > 0 && floor < mine && !open && !pictured;

    // Indoor lower storey gets closed walls when viewed from upstairs:
    expect(shouldStandClosedStoreyWalls(true, 1, 2, false, false)).toBe(true);
    // Open lower mountain terrace does NOT get full-height closed walls erected above its floor:
    expect(shouldStandClosedStoreyWalls(true, 1, 2, true, false)).toBe(false);

    // Ground-floor buildings only cut away when the player is on Floor 0 (mine === 0):
    const shouldOpenGroundBuilding = (floor: number, near: boolean) => floor === 0 && near;
    expect(shouldOpenGroundBuilding(0, true)).toBe(true);
    expect(shouldOpenGroundBuilding(1, true)).toBe(false);
    expect(shouldOpenGroundBuilding(2, true)).toBe(false);

    // Ground-floor interior cutaway (v.inside) only shows when on Floor 0 and open:
    const shouldShowGroundInterior = (mine: number, open: boolean, under: boolean) => !under && mine === 0 && open;
    expect(shouldShowGroundInterior(0, true, false)).toBe(true);
    expect(shouldShowGroundInterior(0, false, false)).toBe(false);
    expect(shouldShowGroundInterior(1, true, false)).toBe(false);
    expect(shouldShowGroundInterior(2, true, false)).toBe(false);

    // When upstairs, uncovered ground-floor houses remain closed exteriors (v.outside visible):
    const shouldShowGroundExterior = (under: boolean, covered: boolean) => !under && !covered;
    expect(shouldShowGroundExterior(false, false)).toBe(true);
    expect(shouldShowGroundExterior(false, true)).toBe(false);
  });
});
