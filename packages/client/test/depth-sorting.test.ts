import { describe, expect, it } from 'vitest';
import { PROJECTION } from '../src/projection.ts';
import { FLOOR_DEPTH, GROUND_DEPTH, floorDepthOffset } from '../src/world-scene/depth.ts';

describe('isometric depth sorting across world coordinates', () => {
  it('keeps ground terrain below all avatars, shadows, and scenery even at negative coordinates', () => {
    // In Frostpeak (at: { x: 0, y: -1 }), ox = 0, oy = -256.
    const ox = 0;
    const oy = -256;

    // Test coordinates around the diagonal boundary x + y = 256 where worldX + worldY = 0:
    const testPoints = [
      { lx: 101, ly: 155, desc: 'exact screenY = 0 line' },
      { lx: 101, ly: 154, desc: '1 step northwest into negative world coords' },
      { lx: 88, ly: 152, desc: 'deep in Frostpeak negative plane' },
      { lx: 0, ly: 0, desc: 'northwest corner of Frostpeak (maximum negative)' },
      { lx: 73, ly: 124, desc: 'Whiteledge town' },
      { lx: 69, ly: 90, desc: 'The Eyrie of the First Watch' },
    ];

    for (const { lx, ly, desc } of testPoints) {
      const worldX = ox + lx;
      const worldY = oy + ly;
      const baseDepth = PROJECTION.depth(worldX, worldY);

      const avatarDepth = floorDepthOffset(0) + baseDepth;
      const shadowDepth = avatarDepth - 2;
      const sceneryDepth = baseDepth - 1;

      // Invariant: Ground chunk terrain on floor 0 MUST be strictly below avatar, shadow, and scenery
      expect(avatarDepth, `avatar at ${desc}`).toBeGreaterThan(GROUND_DEPTH);
      expect(shadowDepth, `shadow at ${desc}`).toBeGreaterThan(GROUND_DEPTH);
      expect(sceneryDepth, `scenery at ${desc}`).toBeGreaterThan(GROUND_DEPTH);
    }
  });

  it('keeps building floors and wall half-caps below interior occupants across negative coordinates', () => {
    // Whiteledge Masonry at local (73, 124) in Frostpeak:
    const ox = 0;
    const oy = -256;
    const bx = 73;
    const by = 124;
    const left = ox + bx;
    const top = oy + by;

    const buildingFloorDepth = PROJECTION.depth(left, top) - 0.5;
    const cutHalfCapDepth = PROJECTION.depth(left, top) - 0.4;
    const fullHalfCapDepth = PROJECTION.depth(left, top) - 0.3;

    // Verify ordering between ground, building floor, and half-caps:
    expect(buildingFloorDepth).toBeGreaterThan(GROUND_DEPTH);
    expect(cutHalfCapDepth).toBeGreaterThan(buildingFloorDepth);
    expect(fullHalfCapDepth).toBeGreaterThan(cutHalfCapDepth);

    // Any occupant standing on any tile (tx, ty) inside the 10x6 building:
    for (let dy = 0; dy < 6; dy++) {
      for (let dx = 0; dx < 10; dx++) {
        const tx = left + dx;
        const ty = top + dy;
        const feet = { x: tx + 0.5, y: ty + 0.5 };
        const occupantDepth = PROJECTION.depth(feet.x, feet.y);
        const occupantShadow = occupantDepth - 2;
        const furnitureDepth = occupantDepth - 1;

        expect(occupantDepth, `occupant at offset (${dx}, ${dy})`).toBeGreaterThan(fullHalfCapDepth);
        expect(occupantShadow, `occupant shadow at offset (${dx}, ${dy})`).toBeGreaterThan(buildingFloorDepth);
        expect(furnitureDepth, `furniture at offset (${dx}, ${dy})`).toBeGreaterThan(buildingFloorDepth);
      }
    }
  });

  it('preserves multi-storey stacking order on upper floors', () => {
    const left = 69;
    const top = 90 - 256;

    for (let floor = 1; floor <= 8; floor++) {
      const depthOff = floorDepthOffset(floor);
      const prevDepthOff = floorDepthOffset(floor - 1);

      const storeyFloorDepth = depthOff + PROJECTION.depth(left, top) - 0.5;
      const prevOccupantMax = prevDepthOff + PROJECTION.depth(left + 20, top + 20);

      // Upper floor layers must draw in front of lower floor contents
      expect(storeyFloorDepth, `floor ${floor} vs floor ${floor - 1}`).toBeGreaterThan(prevOccupantMax);
    }
  });
});
