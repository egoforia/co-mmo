import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildingKit } from '@co-mmo/shared';
import { down, type Render } from './raster.ts';

const { RIGHT, UP, VIEW } = buildingKit;

// A render turned into the maps the game lights: unlit colour, the way each
// pixel faces (a normal map, red right, green up the picture, blue towards
// us) and a glow map of what shines by itself (window glass). Colour is
// straight, not premultiplied: an edge pixel keeps its full colour and its
// alpha says how much shows.

/** One view's light-neutral maps, RGBA, at the final size. */
export interface KitMaps {
  width: number;
  height: number;
  colour: Uint8Array;
  normal: Uint8Array;
  glow: Uint8Array;
}

const byte = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);

/** Packs n-per-pixel values divided by their coverage, plus that coverage as alpha, into RGBA bytes. */
function rgba(vals: Float32Array, cover: Float32Array): Uint8Array {
  const out = new Uint8Array(cover.length * 4);
  for (let i = 0; i < cover.length; i++) {
    const keep = Math.max(cover[i]!, 1e-6);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = byte(vals[i * 3 + c]! / keep);
    out[i * 4 + 3] = byte(cover[i]!);
  }
  return out;
}

/** The colour, normal and glow maps of a render. */
export function lightNeutralMaps(r: Render): KitMaps {
  const { w, h, ss } = r.cv;
  const n = w * h;
  const alpha = new Float32Array(n);
  const facing = new Float32Array(n * 3);
  const glowCol = new Float32Array(n * 3);
  const glowA = new Float32Array(n);
  const glass = new Set(r.faces.flatMap((f, i) => (f.tex === 'window' ? [i] : [])));
  for (let i = 0; i < n; i++) {
    if (r.fid[i]! < 0) continue;
    alpha[i] = 1;
    const p: [number, number, number] = [r.nrm[i * 3]!, r.nrm[i * 3 + 1]!, r.nrm[i * 3 + 2]!];
    facing[i * 3] = buildingKit.dot(p, RIGHT) * 0.5 + 0.5;
    facing[i * 3 + 1] = buildingKit.dot(p, UP) * 0.5 + 0.5;
    facing[i * 3 + 2] = buildingKit.dot(p, VIEW) * 0.5 + 0.5;
    if (glass.has(r.fid[i]!)) {
      glowA[i] = 1;
      for (let c = 0; c < 3; c++) glowCol[i * 3 + c] = r.col[i * 3 + c]!;
    }
  }
  const a = down(alpha, w, h, 1, ss);
  return {
    width: w / ss,
    height: h / ss,
    colour: rgba(down(r.col, w, h, 3, ss), a),
    normal: rgba(down(facing, w, h, 3, ss), a),
    glow: rgba(down(glowCol, w, h, 3, ss), down(glowA, w, h, 1, ss)),
  };
}

/** Saves a view's maps beside each other as `<id>.png`, `<id>-normal.png` and `<id>-glow.png`. */
export async function saveMaps(dir: string, id: string, maps: KitMaps): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files: [string, Uint8Array][] = [[`${id}.png`, maps.colour], [`${id}-normal.png`, maps.normal], [`${id}-glow.png`, maps.glow]];
  for (const [name, data] of files) {
    await sharp(Buffer.from(data), { raw: { width: maps.width, height: maps.height, channels: 4 } }).png().toFile(join(dir, name));
  }
  return files.map(([name]) => join(dir, name));
}
