import { describe, expect, it } from 'vitest';
import { K, KitBuilding, SAMPLE_BUILDINGS, add, shapeChecks, type BuildingSpec, type Part, type Vec3 } from '../src/building-kit/index.ts';
import { buildingKit } from '../src/index.ts';

const { cottage: COTTAGE, 'two-storey house': TWO, temple: TEMPLE, castle: CASTLE } = SAMPLE_BUILDINGS;
// Layouts with a known fault in their stairs.
const NARROW: BuildingSpec = { W: 1, D: 2, stairs: true, storeys: [{ front: { 0: 'door' } }, { front: { 0: 'window' } }] };
const BACKDOOR: BuildingSpec = { W: 3, D: 2, stairs: [{ storey: 0, wall: 'back', up: 1 }], storeys: [{ front: { 0: 'door' }, back: { 0: 'door' } }, { front: { 1: 'window' } }] };
const BEHIND: BuildingSpec = { W: 3, D: 2, stairs: [{ storey: 0, wall: 'back', up: -1 }], storeys: [{ front: { 0: 'door' } }, { front: { 1: 'window' } }] };

/** The names of the shape checks a building fails. */
function failing(b: KitBuilding): string[] {
  return shapeChecks(b).filter((c) => !c.ok).map((c) => c.check);
}

function drop(b: KitBuilding, pred: (p: Part) => boolean): KitBuilding {
  b.parts = b.parts.filter((p) => !pred(p));
  b.faces = b.parts.flatMap((p) => p.faces);
  return b;
}

/** Moves whole parts, faces and solids together, to plant a fault. */
function move(b: KitBuilding, pred: (p: Part) => boolean, d: Vec3): KitBuilding {
  for (const p of b.parts.filter(pred)) {
    for (const f of p.faces) {
      f.pts = f.pts.map((q) => add(q, d));
      f.holes = f.holes.map((h) => h.map((q) => add(q, d)));
    }
    for (const s of p.solids) s.o = add(s.o, d);
  }
  return b;
}

const named = (...names: string[]) => (p: Part) => names.includes(p.name);

/** The chimney lifted until its base clears the roof, yet still beside the ridge beam. */
function chimneyJustClear(): KitBuilding {
  const b = new KitBuilding(COTTAGE);
  const rt = K.roofT / Math.cos((K.pitch * Math.PI) / 180);
  const [cb, c] = [COTTAGE.chimney![1], K.chimney / 2];
  const dz = Math.max(...[cb - c, cb + c].map((q) => b.roof!.zu(q) + rt)) - b.roof!.zr0 + 0.05;
  return move(b, (p) => p.role === 'chimney', [0, 0, dz]);
}

/** Builds the floor above the stairs whole, with no opening to climb through. */
class NoStairwell extends KitBuilding {
  protected override floors(top: number): void {
    for (const f of this.flights) f.hole = null;
    super.floors(top);
  }
}

const roofSlopes = ['meets: the near roof slope rests on the front beam', 'meets: the far roof slope rests on the back beam'];
const onGables = ['left', 'right'].flatMap((g) => ['near', 'far'].map((s) => `meets: the ${s} roof slope rests on the ${g} gable`));
const stairsFit = 'fits: stairs from storey 1 to 2 fit in the room, clear of doors and windows, with headroom';

// Every known kind of fault, and the checks that must catch it (the same ones the prototype's self-test names).
const FAULTS: [string, () => KitBuilding, string[]][] = [
  ['corner post missing', () => drop(new KitBuilding(COTTAGE), (p) => p.role === 'post' && p.at![0] === 0 && p.at![1] === 0), ['every wall bay runs from post to post']],
  ['a wall bay shifted 0.1 along its wall', () => move(new KitBuilding(COTTAGE), named('front0.bay1'), [0.1, 0, 0]), ['meets: the front door of storey 1 stands on its threshold', 'every wall bay runs from post to post']],
  ['a wall bay missing', () => drop(new KitBuilding(COTTAGE), (p) => p.role === 'bay' && p.side === 'front' && p.bay === 2), ['every wall is complete', 'nothing floats']],
  ['roof lifted 0.05', () => move(new KitBuilding(COTTAGE), (p) => p.role === 'roof' || p.role === 'ridge', [0, 0, 0.05]), [roofSlopes[0]!, roofSlopes[1]!, ...onGables, 'nothing floats']],
  ['roof sunk 0.05 into the beams', () => move(new KitBuilding(COTTAGE), (p) => p.role === 'roof' || p.role === 'ridge', [0, 0, -0.05]), [roofSlopes[0]!, roofSlopes[1]!, ...onGables]],
  ['front roof slope missing', () => drop(new KitBuilding(COTTAGE), named('roof.near')), [roofSlopes[0]!, ...onGables.filter((c) => c.includes('near'))]],
  ['a beam lifted 0.05', () => move(new KitBuilding(COTTAGE), named('front0.beam'), [0, 0, 0.05]), ['meets: the front beam of storey 1 rests on its wall', roofSlopes[0]!]],
  ['door wider than its bay', () => new KitBuilding(COTTAGE, { k: { ...K, doorW: 0.8 } }), ['fits: front0 bay 1 door: opening and trim stay between the posts']],
  ['door leaf lifted 0.05 off its threshold', () => move(new KitBuilding(COTTAGE), named('front0.door1'), [0, 0, 0.05]), ['meets: the front door of storey 1 stands on its threshold']],
  ['chimney floating high', () => move(new KitBuilding(COTTAGE), (p) => p.role === 'chimney', [0, 0, 2]), ['meets: the chimney goes into the roof everywhere under it (no floating)', 'nothing floats']],
  ['chimney lifted just clear of the roof, touching the ridge beam', chimneyJustClear, ['meets: the chimney goes into the roof everywhere under it (no floating)']],
  ['an upper wall bay lifted 0.05', () => move(new KitBuilding(TWO), named('right1.bay1'), [0, 0, 0.05]), ['meets: the right beam of storey 2 rests on its wall', 'meets: the right wall of storey 2 rests on the beam below']],
  ['the upper floor dropped 0.2', () => move(new KitBuilding(TWO), named('floor1'), [0, 0, -0.2]), ['meets: the floor of storey 2 is held by the beams below', 'meets: the top step is level with the floor of storey 2']],
  ['the top step 0.05 too low', () => move(new KitBuilding(TWO), named('stair0.7'), [0, 0, -0.05]), ['meets: the stairs from storey 1 stand on its floor', 'meets: the top step is level with the floor of storey 2']],
  ['stairs in a house one bay wide', () => new KitBuilding(NARROW), [stairsFit]],
  ['stairs placed in front of a back door', () => new KitBuilding(BACKDOOR), [stairsFit]],
  ['no stairwell cut in the floor above the stairs', () => new NoStairwell(TWO), ['meets: the stairs from storey 1 climb through an opening in the floor above']],
  ['stairs told to climb towards a wall the cutaway above cuts low', () => new KitBuilding(BEHIND, { cut: 1 }), [stairsFit]],
  ['flat roof lifted 0.05 off the beams', () => move(new KitBuilding(TEMPLE), (p) => ['roof', 'parapet', 'dome'].includes(p.role), [0, 0, 0.05]), ['meets: the flat roof rests on the beams', 'nothing floats']],
  ['dome and drum lifted 0.05 off the roof', () => move(new KitBuilding(TEMPLE), (p) => p.role === 'dome', [0, 0, 0.05]), ['meets: the drum stands on the roof', 'nothing floats']],
  ['a merlon lifted 0.05 off its wall', () => move(new KitBuilding(CASTLE), named('battlement.front.3'), [0, 0, 0.05]), ['meets: merlon 4 of battlement front stands on its wall', 'nothing floats']],
  ['a tower\'s roof lifted 0.05 off its eave', () => move(new KitBuilding(CASTLE), (p) => p.name.endsWith('front-left.roof'), [0, 0, 0.05]), ['meets: the roof of the front-left tower sits on its eave', 'nothing floats']],
];

describe('building kit shapes', () => {
  for (const [name, spec] of Object.entries(SAMPLE_BUILDINGS)) {
    it(`builds the ${name} with every joint meeting, outside and in every cutaway`, () => {
      for (const cut of [null, ...spec.storeys.map((_, i) => i)]) {
        const b = new KitBuilding(spec, { cut });
        expect(b.parts.filter((p) => p.role === 'bay')).toHaveLength((cut === null ? spec.storeys.length : cut + 1) * 2 * (spec.W + spec.D));
        expect(failing(b), `cut ${cut}`).toEqual([]);
      }
    });
  }

  for (const [name, make, caughtBy] of FAULTS) {
    it(`catches: ${name}`, () => {
      expect(failing(make())).toEqual(caughtBy);
    });
  }

  it('says in words why stairs do not fit', () => {
    const fit = shapeChecks(new KitBuilding(NARROW)).find((c) => c.check === stairsFit)!;
    expect(fit.detail).toContain('needs 1.76 along the wall, the room has 0.88');
    const behind = shapeChecks(new KitBuilding(BEHIND, { cut: 1 })).find((c) => c.check === stairsFit)!;
    expect(behind.detail).toBe('back wall going -a: would arrive behind a wall the cutaway above cuts low (16% of the top step in view)');
  });

  it('moves stairs off a back door by itself when it may choose', () => {
    const b = new KitBuilding({ ...BACKDOOR, stairs: true });
    expect(failing(b)).toEqual([]);
    expect([b.flights[0]!.wall, b.flights[0]!.up]).not.toEqual(['back', 1]);
  });

  it('gives each storey blocking lines along its walls with the doorways left open', () => {
    const b = new KitBuilding(COTTAGE);
    const front = b.blocks.filter((l) => l.side === 'front');
    expect(front.map((l) => [l.p0, l.p1])).toEqual([
      [[0, 0], [1.5 - K.doorW / 2, 0]],
      [[1.5 + K.doorW / 2, 0], [3, 0]],
    ]);
    expect(b.blocks.filter((l) => l.side !== 'front')).toHaveLength(3);
  });

  it('is exported from the shared package under its own name', () => {
    expect(buildingKit.KitBuilding).toBe(KitBuilding);
    expect(buildingKit.shapeChecks).toBe(shapeChecks);
  });

  it('cuts the near walls low in a cutaway and leaves the far walls whole', () => {
    const b = new KitBuilding(COTTAGE, { cut: 0 });
    const top = (side: string) => Math.max(...b.parts.filter((p) => p.role === 'bay' && p.side === side).flatMap((p) => p.faces.flatMap((f) => f.pts.map((q) => q[2]))));
    expect(top('front')).toBeCloseTo(K.floor + K.cut);
    expect(top('left')).toBeCloseTo(K.floor + K.cut);
    expect(top('back')).toBeCloseTo(K.H - K.plateH);
    expect(b.parts.some((p) => p.role === 'roof')).toBe(false);
  });
});
