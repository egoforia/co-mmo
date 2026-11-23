import { describe, expect, it } from 'vitest';
import { Interpolator } from '@co-mmo/shared';
import { PRESENT_FAR, PRESENT_NEAR, creatureSpot, drawnSpot, nearness, settleJump } from '../src/world-scene/near-present.ts';
import type { Remote } from '../src/world-scene/types.ts';

// Creatures beside our player are drawn on the server's present (near-present.ts).

/** A creature walking east at two tiles a second, its newest word at server time 1100. */
function walking(): Remote {
  const interp = new Interpolator();
  interp.push(1000, 10.5, 5.5, { x: 11.5, y: 5.5 });
  interp.push(1050, 10.6, 5.5, { x: 11.5, y: 5.5 });
  interp.push(1100, 10.7, 5.5, { x: 11.5, y: 5.5 });
  return { interp } as unknown as Remote;
}

describe('creatures near us on the present', () => {
  it('blends from the present close by to the smooth past far off', () => {
    const me = { x: 0, y: 0 };
    expect(nearness(me, { x: PRESENT_NEAR, y: 1 })).toBe(1);
    expect(nearness(me, { x: -PRESENT_FAR, y: 0 })).toBe(0);
    expect(nearness(me, { x: 0, y: (PRESENT_NEAR + PRESENT_FAR) / 2 })).toBeCloseTo(0.5);
  });

  it('draws one beside us where the server has it now, and one far off a little in the past', () => {
    const times = { past: 1025, present: 1150 };
    expect(creatureSpot(walking(), { x: 12.5, y: 5.5 }, times)!.x).toBeCloseTo(10.8);
    expect(creatureSpot(walking(), { x: 40.5, y: 5.5 }, times)!.x).toBeCloseTo(10.55);
  });

  it('smooths away the jump a new snapshot makes, and shows a big one at once', () => {
    const r = walking();
    settleJump(r, { x: 10.9, y: 5.5 }, { x: 10.8, y: 5.5 });
    const times = { past: 1025, present: 1150 };
    const first = drawnSpot(r, { x: 12.5, y: 5.5 }, times, 0)!;
    expect(first.x).toBeCloseTo(10.9);
    // A moment later most of it is gone, and soon all.
    expect(drawnSpot(r, { x: 12.5, y: 5.5 }, times, 150)!.x).toBeLessThan(10.84);
    for (let k = 0; k < 40; k++) drawnSpot(r, { x: 12.5, y: 5.5 }, times, 50);
    expect(r.settle).toBeUndefined();
    settleJump(r, { x: 30, y: 5.5 }, { x: 10.8, y: 5.5 });
    expect(r.settle).toBeUndefined();
  });
});
