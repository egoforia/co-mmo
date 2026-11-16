import { describe, expect, it } from 'vitest';
import type { RegionMap, Storey } from '@co-mmo/shared';
import {
  isAvatarVisible,
  type VisibleBuilding,
  type VisibleFloor,
  type VisibleRegion,
} from '../src/world-scene/avatar-visibility.ts';

describe('monster and storey visibility across floors', () => {
  function makeMockRegion(options?: {
    storeys?: Partial<Storey>[];
    buildings?: Partial<VisibleBuilding>[];
    floorVisibility?: boolean[];
  }): VisibleRegion {
    const storeys: Storey[] = (options?.storeys ?? []).map((s, i) => ({
      floor: s.floor ?? 1,
      x: s.x ?? 96,
      y: s.y ?? 154,
      width: s.width ?? 6,
      height: s.height ?? 7,
      tiles: s.tiles ?? new Uint8Array(42),
      style: s.style ?? 'frostpeak-eyrie',
      open: s.open,
    }));

    const floors: VisibleFloor[] = storeys.map((storey, i) => ({
      storey,
      visible: options?.floorVisibility?.[i] ?? true,
    }));

    const buildings: VisibleBuilding[] = (options?.buildings ?? []).map((b) => ({
      building: b.building ?? { x: 106, y: 154, width: 8, height: 8 },
      ox: b.ox ?? 0,
      oy: b.oy ?? 0,
      open: b.open ?? false,
    }));

    const map: RegionMap = {
      def: { id: 'arch-testbed', at: { x: 0, y: 0 } },
      width: 256,
      height: 256,
      storeys,
      buildings: buildings.map((b) => b.building as any),
      stairways: [],
      npcs: [],
      creatures: [],
      landmarks: [],
      spots: [],
      tiles: new Uint8Array(256 * 256),
    } as unknown as RegionMap;

    return {
      map,
      floors,
      buildings,
    };
  }

  it('hides a monster on an upper terrace when the storey is hidden to prevent floating in mid-air', () => {
    // Upper open terrace at (96, 154), size 6x7, on floor 1. Monster stands at (99, 155) on floor 1.
    const regionVisible = makeMockRegion({
      storeys: [{ floor: 1, x: 96, y: 154, width: 6, height: 7, open: true }],
      floorVisibility: [true],
    });

    // 1. When the storey is visible (player at 95, 160 on floor 0), monster is visible standing on the terrace:
    const seenWhenDrawn = isAvatarVisible(
      regionVisible,
      0, // mine
      { x: 95, y: 160 }, // shown
      99, // wx (monster)
      155, // wy (monster)
      1, // monster floor
      false, // isNpc
    );
    expect(seenWhenDrawn).toBe(true);

    // 2. When player steps to (94, 159), storey compromises player view and is hidden (f.visible = false):
    const regionHidden = makeMockRegion({
      storeys: [{ floor: 1, x: 96, y: 154, width: 6, height: 7, open: true }],
      floorVisibility: [false],
    });

    const seenWhenHidden = isAvatarVisible(
      regionHidden,
      0, // mine
      { x: 94, y: 159 }, // shown
      99, // wx (monster)
      155, // wy (monster)
      1, // monster floor
      false, // isNpc
    );
    // The monster MUST be hidden together with the storey!
    expect(seenWhenHidden).toBe(false);
  });

  it('hides creatures inside enclosed upper storeys from the ground', () => {
    // Storey on floor 1 is closed (open = false / undefined):
    const region = makeMockRegion({
      storeys: [{ floor: 1, x: 96, y: 154, width: 6, height: 7, open: false }],
      floorVisibility: [true],
    });

    const seen = isAvatarVisible(
      region,
      0,
      { x: 95, y: 160 },
      99,
      155,
      1,
      false,
    );
    expect(seen).toBe(false);
  });

  it('hides creatures in underground floors from the surface and vice versa', () => {
    const region = makeMockRegion({
      storeys: [{ floor: -1, x: 40, y: 160, width: 10, height: 10, open: false }],
      floorVisibility: [true],
    });

    // Surface player (floor 0) looking at dungeon creature (floor -1):
    expect(isAvatarVisible(region, 0, { x: 45, y: 165 }, 45, 165, -1, false)).toBe(false);

    // Underground player (floor -1) looking at surface creature (floor 0):
    expect(isAvatarVisible(region, -1, { x: 45, y: 165 }, 45, 165, 0, false)).toBe(false);

    // Underground player (floor -1) looking at creature in same dungeon (floor -1):
    expect(isAvatarVisible(region, -1, { x: 45, y: 165 }, 45, 165, -1, false)).toBe(true);

    // Underground player (floor -1) looking at creature in deeper crypt (floor -2):
    expect(isAvatarVisible(region, -1, { x: 45, y: 165 }, 45, 165, -2, false)).toBe(false);
  });

  it('hides creatures inside closed ground-floor buildings until approached', () => {
    const region = makeMockRegion({
      buildings: [
        {
          building: { x: 40, y: 40, width: 8, height: 8 },
          ox: 0,
          oy: 0,
          open: false,
        },
      ],
    });

    // Monster inside unopened house at (43, 43):
    expect(isAvatarVisible(region, 0, { x: 30, y: 30 }, 43, 43, 0, false)).toBe(false);

    // Monster outside the house at (38, 38):
    expect(isAvatarVisible(region, 0, { x: 30, y: 30 }, 38, 38, 0, false)).toBe(true);

    // When the building is opened (player walked near the doorway):
    region.buildings[0]!.open = true;
    expect(isAvatarVisible(region, 0, { x: 40, y: 48 }, 43, 43, 0, false)).toBe(true);
  });

  it('handles sightlines from upstairs terraces down to ground floor', () => {
    const region = makeMockRegion({
      storeys: [{ floor: 1, x: 96, y: 154, width: 6, height: 7, open: true }],
      floorVisibility: [true],
      buildings: [
        {
          building: { x: 106, y: 154, width: 8, height: 8 },
          ox: 0,
          oy: 0,
          open: false,
        },
      ],
    });

    // Player stands on floor 1 terrace at (98, 156):
    // 1. Monster on ground outside at (90, 156) is visible from above:
    expect(isAvatarVisible(region, 1, { x: 98, y: 156 }, 90, 156, 0, false)).toBe(true);

    // 2. Monster on ground directly underneath the terrace at (98, 156) is covered by the floor:
    expect(isAvatarVisible(region, 1, { x: 98, y: 156 }, 98, 156, 0, false)).toBe(false);

    // 3. Monster on ground inside an enclosed house at (110, 158) is covered by the roof:
    expect(isAvatarVisible(region, 1, { x: 98, y: 156 }, 110, 158, 0, false)).toBe(false);
  });

  it('keeps NPCs strictly on the player current floor', () => {
    const region = makeMockRegion({
      storeys: [{ floor: 1, x: 96, y: 154, width: 6, height: 7, open: true }],
      floorVisibility: [true],
    });

    // NPC on floor 1, player on floor 0: hidden
    expect(isAvatarVisible(region, 0, { x: 95, y: 160 }, 99, 155, 1, true)).toBe(false);

    // NPC on floor 0, player on floor 0: visible
    expect(isAvatarVisible(region, 0, { x: 95, y: 160 }, 90, 160, 0, true)).toBe(true);
  });
});
