import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildingKit } from '@co-mmo/shared';
import { lightNeutralMaps, saveMaps } from '../src/assets/building-kit/maps.ts';
import { pictureChecks } from '../src/assets/building-kit/picture-checks.ts';
import { KitCanvas, render, type Texture } from '../src/assets/building-kit/raster.ts';
import { buildingViews } from '../src/assets/building-kit/views.ts';

const { KitBuilding, SAMPLE_BUILDINGS, K } = buildingKit;
const { cottage: COTTAGE, 'two-storey house': TWO, tower: TOWER } = SAMPLE_BUILDINGS;
const U = 64; // pixels per bay: small enough to be quick, fine enough for a 0.06 trim

/** Flat grey test stand-ins for painted textures (a test pattern, never game art). */
function clay(over: Record<string, Texture> = {}): Record<string, Texture> {
  const grey = { panel: 0.8, inside: 0.78, plaster: 0.84, timber: 0.62, stone: 0.7, floor: 0.66, roof: 0.74, door: 0.55, window: 0.45 };
  return { ...Object.fromEntries(Object.entries(grey).map(([k, v]) => [k, { w: 8, h: 8, rgb: new Float32Array(8 * 8 * 3).fill(v) }])), ...over };
}

/** The picture checks a building fails, drawn on its outside's frame. */
function failing(b: buildingKit.KitBuilding, spec: buildingKit.BuildingSpec, textures = clay()): string[] {
  const cv = new KitCanvas(new KitBuilding(spec).faces, U);
  return pictureChecks(b, render(b.faces, textures, cv)).filter((c) => !c.ok).map((c) => c.check);
}

/** Stairs placed without asking whether their top step will show in the cutaway above. */
class Unplaced extends KitBuilding {
  override topStepShown(): number {
    return 1;
  }
}

describe('building kit renderer', () => {
  for (const [name, spec] of Object.entries({ cottage: COTTAGE, 'two-storey house': TWO, tower: TOWER })) {
    it(`draws the ${name} outside and in every cutaway with every check passing`, () => {
      const views = buildingViews(spec, clay(), { u: U });
      expect(views.map((v) => v.view)).toEqual(['outside', ...spec.storeys.map((_, i) => `storey-${i + 1}`)]);
      for (const v of views) expect(v.checks.filter((c) => !c.ok), v.view).toEqual([]);
      // every view shares one frame, so they line up when the game swaps them
      expect(new Set(views.map((v) => `${v.maps.width}x${v.maps.height}`)).size).toBe(1);
    });
  }

  it('catches two surfaces painted in one place', () => {
    const b = new KitBuilding(COTTAGE);
    const f = b.faces.find((g) => g.part === 'left0.bay0' && g.tex === 'panel')!;
    const twin = Object.assign(Object.create(Object.getPrototypeOf(f)), f, { tex: 'timber', mapping: buildingKit.tile('timber'), part: 'left0.bay0.copy' });
    b.faces.push(twin);
    expect(failing(b, COTTAGE)).toEqual(['no two surfaces fight for the same place']);
  });

  it('catches a stretched texture showing past its painting', () => {
    const b = new KitBuilding(COTTAGE);
    const f = b.faces.find((g) => g.part === 'left0.bay0' && g.tex === 'panel')!;
    if (f.mapping.kind !== 'fit') throw new Error('panels are fitted');
    const { bl, br, tl } = f.mapping;
    f.mapping = { kind: 'fit', bl, br, tl: buildingKit.add(bl, buildingKit.scale(buildingKit.sub(tl, bl), 0.5)) };
    expect(failing(b, COTTAGE)).toEqual(['stretched textures never show past their painted area']);
  });

  it('catches layout colour left inside a texture', () => {
    const rgb = new Float32Array(8 * 8 * 3);
    for (let i = 0; i < 64; i++) rgb.set(Math.floor(i / 8) % 2 ? [0.8, 0.8, 0.8] : [1, 0, 1], i * 3);
    expect(failing(new KitBuilding(COTTAGE), COTTAGE, clay({ panel: { w: 8, h: 8, rgb } }))).toEqual(['no layout colour (magenta/green) on the building']);
  });

  it('catches near walls cut so high they hide where the stairs from below arrive', () => {
    const b = new Unplaced(TOWER, { k: { ...K, cut: 0.35 }, cut: 2 });
    expect(failing(b, TOWER)).toEqual(['the way down shows: the top of the stairs from storey 2 is seen in this cutaway']);
  });

  it('catches daylight on a room when the building forgets its rooms', () => {
    const b = new KitBuilding(COTTAGE, { cut: 0 });
    b.rooms = [];
    expect(failing(b, COTTAGE)).toEqual(['room walls and floor take only inside light']);
  });

  it('catches a wall bay shifted along its wall, showing what posts should hide', () => {
    const b = new KitBuilding(COTTAGE);
    for (const p of b.parts.filter((q) => q.name === 'front0.bay1')) {
      for (const f of p.faces) f.pts = f.pts.map((q) => buildingKit.add(q, [0.3, 0, 0]));
    }
    expect(failing(b, COTTAGE)).toEqual(['faces meant to be hidden stay hidden (wall ends inside posts, tops under beams)', 'no two surfaces fight for the same place']);
  });
});

describe('building kit maps', () => {
  const b = new KitBuilding(COTTAGE);
  const cv = new KitCanvas(b.faces, U);
  const r = render(b.faces, clay(), cv);
  const maps = lightNeutralMaps(r);
  const at = (data: Uint8Array, p: buildingKit.Vec3) => {
    const [x, y] = cv.px(p).map((v) => Math.floor(v / cv.ss));
    return Array.from(data.slice((y! * maps.width + x!) * 4, (y! * maps.width + x!) * 4 + 4));
  };

  it('are the final size, see-through round the building and solid on it', () => {
    expect([maps.width, maps.height]).toEqual([cv.w / cv.ss, cv.h / cv.ss]);
    expect(maps.colour[3]).toBe(0);
    const roof = at(maps.colour, [1.5, 1, b.roof!.ridge - 0.3]);
    expect(roof[3]).toBe(255);
    expect(roof[0]).toBe(Math.round(0.74 * 255)); // unlit: the painted colour itself
  });

  it('say which way each pixel faces on screen: red right, green up the picture, blue towards us', () => {
    // the near roof slope faces the front and the sky: on screen that is right, up and towards us
    const slope: buildingKit.Vec3 = [0, -Math.SQRT1_2, Math.SQRT1_2];
    const want = [buildingKit.RIGHT, buildingKit.UP, buildingKit.VIEW].map((axis) => Math.round((buildingKit.dot(slope, axis) * 0.5 + 0.5) * 255));
    const got = at(maps.normal, [1.5, 0.3, b.roof!.zu(0.3) + 0.1]);
    expect(got.slice(0, 3)).toEqual(want);
    expect(want[0]).toBeGreaterThan(128);
  });

  it('glow only where window glass shows', () => {
    const glass = r.faces.findIndex((f) => f.tex === 'window' && f.part === 'front0.window0' && f.n[1] < 0);
    const g = r.faces[glass]!;
    const mid = g.pts.reduce((s, p) => buildingKit.add(s, buildingKit.scale(p, 1 / g.pts.length)), [0, 0, 0] as buildingKit.Vec3);
    expect(at(maps.glow, mid)[3]).toBe(255);
    expect(at(maps.glow, [1.5, 1, b.roof!.ridge - 0.3])[3]).toBe(0);
  });

  it('save beside each other as colour, -normal and -glow pictures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kit-maps-'));
    try {
      const files = await saveMaps(dir, 'cottage-outside', maps);
      expect(files.map((f) => f.slice(dir.length + 1))).toEqual(['cottage-outside.png', 'cottage-outside-normal.png', 'cottage-outside-glow.png']);
      for (const f of files) expect(await sharp(f).metadata()).toMatchObject({ width: maps.width, height: maps.height, channels: 4 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
