import { describe, expect, it } from 'vitest';
import { CREATURES, type RegionDef } from '@co-mmo/shared';
import { creatureView } from '../src/region-views.ts';
import { across } from '../src/region/beyond.ts';

// A creature's step is sent with it (CreatureState.to), so the browser can
// draw it beside its player on the server's present (near-present.ts).

const wolf = { id: 'w1', kind: 'thorn-wolf', def: CREATURES['thorn-wolf']!, x: 4.62, y: 7.5, hp: 10 };

describe("a creature's step in snapshots", () => {
  it('names the middle of the tile it steps onto, and nothing while it stands', () => {
    expect(creatureView({ ...wolf, to: { tx: 5, ty: 7 } }).to).toEqual({ x: 5.5, y: 7.5 });
    expect(creatureView(wolf).to).toBeUndefined();
    // A two-tile-wide one stands on the corner between its four tiles.
    expect(creatureView({ ...wolf, x: 5, y: 8, width: 2, to: { tx: 5, ty: 7 } }).to).toEqual({ x: 6, y: 8 });
  });

  it('moves with it across a region edge', () => {
    const from = { id: 'east', at: { x: 1, y: 0 } } as RegionDef;
    const to = { id: 'west', at: { x: 0, y: 0 } } as RegionDef;
    const seen = across({ players: [], creatures: [creatureView({ ...wolf, to: { tx: 5, ty: 7 } })], bodies: [], npcs: [] }, from, to, 256);
    expect(seen.creatures[0]).toMatchObject({ x: 260.62, y: 7.5, to: { x: 261.5, y: 7.5 } });
  });
});
