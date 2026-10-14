import Phaser from 'phaser';
import { BIOMES, TILE_PIXELS, Tile, hashString, rand2, type BiomeId, type RegionDef } from '@co-mmo/shared';

// Ground, water, trees and rocks come from the approved art and biome kit.
// Each also has a version painted in code with soft brushes in the biome's
// colours, used when an asset is missing (say, a new biome before its kit).

const T = TILE_PIXELS;
/** Each tile is extruded by this much so filtered tiles never show seams. */
export const TILE_MARGIN = 2;
const TILE_ORDER: Tile[] = [Tile.Ground, Tile.Path, Tile.Water, Tile.Tree, Tile.Rock, Tile.Blocked, Tile.Floor, Tile.Wall, Tile.Door];

type Paint = (ctx: CanvasRenderingContext2D) => void;
/** An art asset id, a painter, or an asset with a painter to fall back on. */
type TileSource = string | Paint | { art: string; paint: Paint };

interface BiomeLook {
  ground: TileSource;
  path: TileSource;
  water: [string, string, string];
  /** The biome kit's water tile. */
  waterArt?: string;
  prop: 'tree' | 'blossom' | 'palm' | 'cactus';
  /** The biome kit's tree (or palm, or cactus) and rock sprites. */
  trees?: string[];
  rocks?: string[];
}

const LOOKS: Record<string, BiomeLook> = {
  sanctum: {
    ground: { art: 'sanctum-meadow', paint: (ctx) => meadow(ctx, ['#7fa860', '#93b96b', '#6c9452'], ['#f3e6c8', '#e7a3a6', '#e8c66a']) },
    path: 'sanctum-flagstones',
    water: ['#5c9cc0', '#8cc4de', '#d8eef5'],
    waterArt: 'sanctum-pond',
    prop: 'blossom',
    trees: ['sanctum-blossom-tree-a', 'sanctum-blossom-tree-b'],
    rocks: ['sanctum-rock'],
  },
  'whispering-woods': {
    ground: 'woods-moss',
    path: (ctx) => meadow(ctx, ['#6b4a33', '#7a573c', '#5a3d2a'], ['#5f9468', '#8a6a45']),
    water: ['#1f4f4a', '#2f6b5e', '#7fb8a0'],
    waterArt: 'woods-pool',
    prop: 'tree',
    trees: ['woods-tree-a', 'woods-tree-b'],
    rocks: ['woods-rock'],
  },
  'sunlit-shore': {
    ground: 'shore-sand',
    path: 'shore-sand',
    water: ['#2c7fa8', '#46c2c2', '#e8fbff'],
    waterArt: 'shore-sea',
    prop: 'palm',
    trees: ['shore-palm-a', 'shore-palm-b'],
    rocks: ['shore-rock'],
  },
  'mirage-desert': {
    ground: 'desert-dunes',
    path: 'desert-dunes',
    water: ['#2a8f8a', '#4fc4b8', '#e6fff6'],
    waterArt: 'desert-oasis',
    prop: 'cactus',
    trees: ['desert-cactus-a', 'desert-cactus-b'],
    rocks: ['desert-rock'],
  },
};

export function biomeLook(biome: string): BiomeLook {
  return LOOKS[biome] ?? LOOKS.sanctum!;
}

export function lightTint(biome: string): number {
  return BIOMES[biome as BiomeId]?.lightTint ?? 0xffffff;
}

export function tilesetKey(def: RegionDef): string {
  return `tileset-${def.id}`;
}

/**
 * Draws the region's tiles into one strip, indexed by Tile value. Trees and
 * rocks sit on plain ground here; their sprites are placed separately so
 * they can overlap and depth-sort with players.
 */
export function registerTileset(scene: Phaser.Scene, def: RegionDef): string {
  const key = tilesetKey(def);
  if (scene.textures.exists(key)) return key;
  const look = biomeLook(def.biome);
  const step = T + TILE_MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = step * (Math.max(...TILE_ORDER) + 1);
  canvas.height = step;
  const ctx = canvas.getContext('2d')!;

  const ground = tileCanvas((c) => paintSource(scene, c, look.ground));
  const path = tileCanvas((c) => paintSource(scene, c, look.path));
  const paintWaterLook: Paint = (c) => paintWater(c, look.water);
  const water = tileCanvas((c) => paintSource(scene, c, look.waterArt ? { art: look.waterArt, paint: paintWaterLook } : paintWaterLook));

  // Buildings are wood in every biome.
  const floor = tileCanvas((c) => planks(c, ['#8a6a45', '#a07c52', '#6b4a33']));
  const wall = tileCanvas((c) => planks(c, ['#4a3324', '#5a3d2a', '#2f2018']));
  // The doorway: a worn threshold of pale boards between dark door posts.
  const door = tileCanvas((c) => {
    planks(c, ['#b08c5e', '#c9a576', '#7a573c']);
    c.fillStyle = '#2f2018';
    c.fillRect(0, 0, T, T / 8);
  });
  const sources: Partial<Record<Tile, HTMLCanvasElement>> = { [Tile.Path]: path, [Tile.Water]: water, [Tile.Floor]: floor, [Tile.Wall]: wall, [Tile.Door]: door };

  for (const tile of TILE_ORDER) {
    const source = sources[tile] ?? ground;
    const x = tile * step;
    // Extrude the edges so linear filtering samples matching colours.
    ctx.drawImage(source, 0, 0, T, 1, x + TILE_MARGIN, 0, T, TILE_MARGIN);
    ctx.drawImage(source, 0, T - 1, T, 1, x + TILE_MARGIN, T + TILE_MARGIN, T, TILE_MARGIN);
    ctx.drawImage(source, 0, 0, 1, T, x, TILE_MARGIN, TILE_MARGIN, T);
    ctx.drawImage(source, T - 1, 0, 1, T, x + T + TILE_MARGIN, TILE_MARGIN, TILE_MARGIN, T);
    ctx.drawImage(source, x + TILE_MARGIN, TILE_MARGIN);
  }
  scene.textures.addCanvas(key, canvas);
  return key;
}

function tileCanvas(paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = T;
  canvas.height = T;
  paint(canvas.getContext('2d')!);
  return canvas;
}

function paintSource(scene: Phaser.Scene, ctx: CanvasRenderingContext2D, source: TileSource): void {
  if (typeof source === 'function') return source(ctx);
  const { art, paint } = typeof source === 'string'
    ? { art: source, paint: (c: CanvasRenderingContext2D) => meadow(c, ['#7fa860', '#93b96b', '#6c9452'], []) }
    : source;
  if (scene.textures.exists(art)) ctx.drawImage(scene.textures.get(art).getSourceImage() as CanvasImageSource, 0, 0, T, T);
  else paint(ctx);
}

/** Soft brushy grass that wraps at the tile edges. */
function meadow(ctx: CanvasRenderingContext2D, greens: string[], flowers: string[]): void {
  ctx.fillStyle = greens[0]!;
  ctx.fillRect(0, 0, T, T);
  let i = 0;
  const wrapped = (x: number, y: number, draw: (x: number, y: number) => void) => {
    for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) draw(x + ox, y + oy);
  };
  for (; i < 90; i++) {
    const x = rand2(i, 1, 7) * T;
    const y = rand2(i, 2, 7) * T;
    const r = 4 + rand2(i, 3, 7) * 10;
    ctx.fillStyle = greens[1 + (i % (greens.length - 1))]!;
    ctx.globalAlpha = 0.35;
    wrapped(x, y, (px, py) => {
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalAlpha = 1;
  for (let j = 0; j < flowers.length * 2; j++) {
    const x = rand2(j, 4, 9) * T;
    const y = rand2(j, 5, 9) * T;
    ctx.fillStyle = flowers[j % flowers.length]!;
    wrapped(x, y, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/** Rows of boards with soft grain, wrapping at the tile edges: body, light, seam. */
function planks(ctx: CanvasRenderingContext2D, [body, light, seam]: string[]): void {
  ctx.fillStyle = body!;
  ctx.fillRect(0, 0, T, T);
  const rows = 4;
  const h = T / rows;
  for (let row = 0; row < rows; row++) {
    const y = row * h;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = light!;
    ctx.fillRect(0, y + 3, T, h * 0.3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = seam!;
    ctx.fillRect(0, y, T, 2);
    // Board ends are staggered row by row, like a laid floor.
    const end = ((row % 2) * 0.5 + 0.25 + rand2(row, 1, 13) * 0.1) * T;
    ctx.fillRect(end, y, 2, h);
  }
}

function paintWater(ctx: CanvasRenderingContext2D, [deep, mid, glint]: [string, string, string]): void {
  ctx.fillStyle = mid;
  ctx.fillRect(0, 0, T, T);
  // Soft darker swirls that wrap at the edges, so water has no grid.
  ctx.fillStyle = deep;
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 14; i++) {
    const x = rand2(i, 7, 31) * T;
    const y = rand2(i, 8, 31) * T;
    const r = 10 + rand2(i, 9, 31) * 18;
    for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) {
      ctx.beginPath();
      ctx.ellipse(x + ox, y + oy, r * 1.6, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = glint;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const x = rand2(i, 1, 31) * T;
    const y = rand2(i, 2, 31) * T;
    const w = 10 + rand2(i, 3, 31) * 18;
    for (const ox of [-T, 0, T]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y);
      ctx.quadraticCurveTo(x + ox + w / 2, y - 3, x + ox + w, y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * A tree, palm, cactus or rock for a biome: the biome kit's art when loaded,
 * otherwise one painted in code. A few variants each.
 */
export function propTexture(scene: Phaser.Scene, biome: string, kind: 'tree' | 'rock', variant: number): string {
  const look = biomeLook(biome);
  const art = (kind === 'rock' ? look.rocks : look.trees)?.filter((id) => scene.textures.exists(id)) ?? [];
  if (art.length) return art[variant % art.length]!;
  const shape = kind === 'rock' ? 'rock' : look.prop;
  const key = `prop-${biome}-${shape}-${variant}`;
  if (scene.textures.exists(key)) return key;
  const w = shape === 'rock' ? T : T * 1.5;
  const h = shape === 'rock' ? T : T * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const r = (n: number) => rand2(variant, n, 77);
  const cx = w / 2;
  const base = h - 6;

  if (shape === 'rock') {
    blob(ctx, cx, base - 26, 46 + r(1) * 10, 30, ['#5d5763', '#8a8290', '#b9b0bc']);
  } else if (shape === 'cactus') {
    const green = ['#3e6b3a', '#5f9a4e', '#9cc77a'];
    pill(ctx, cx, base - 70, 24, 140, green);
    pill(ctx, cx - 30, base - 90 - r(1) * 10, 16, 50, green);
    pill(ctx, cx + 30, base - 70 - r(2) * 20, 16, 44, green);
    ctx.fillStyle = green[0]!;
    ctx.fillRect(cx - 30, base - 70, 30, 10);
    ctx.fillRect(cx, base - 50 - r(2) * 20, 30, 10);
    if (r(3) > 0.5) dot(ctx, cx, base - 142, 7, '#f08e86');
  } else if (shape === 'palm') {
    const lean = (r(1) - 0.5) * 30;
    ctx.strokeStyle = '#8a6a45';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, base);
    ctx.quadraticCurveTo(cx + lean, base - 90, cx + lean * 1.4, base - 170);
    ctx.stroke();
    const tx = cx + lean * 1.4;
    const ty = base - 170;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r(2);
      ctx.fillStyle = i % 2 ? '#3e8a4a' : '#5fb35a';
      ctx.beginPath();
      ctx.ellipse(tx + Math.cos(a) * 34, ty + Math.sin(a) * 18 + 10, 40, 11, a, 0, Math.PI * 2);
      ctx.fill();
    }
    dot(ctx, tx - 6, ty + 8, 7, '#6b4a33');
    dot(ctx, tx + 7, ty + 10, 7, '#6b4a33');
  } else {
    const leaves = shape === 'blossom' ? ['#5f8a45', '#86b062', '#c4dc8c'] : ['#1f4a3a', '#2f6b5e', '#5f9468'];
    ctx.fillStyle = '#5a3d2a';
    ctx.beginPath();
    ctx.moveTo(cx - 12, base);
    ctx.lineTo(cx - 7, base - 80);
    ctx.lineTo(cx + 7, base - 80);
    ctx.lineTo(cx + 12, base);
    ctx.fill();
    const top = base - 130 - r(1) * 20;
    blob(ctx, cx - 30, top + 30, 42, 36, leaves);
    blob(ctx, cx + 30, top + 26, 42, 36, leaves);
    blob(ctx, cx, top, 54, 46, leaves);
    if (shape === 'blossom') {
      for (let i = 0; i < 10; i++) dot(ctx, cx + (r(10 + i) - 0.5) * 120, top + (r(30 + i) - 0.3) * 80, 4, i % 2 ? '#f3e6c8' : '#e7a3a6');
    } else if (r(5) > 0.6) {
      for (let i = 0; i < 4; i++) dot(ctx, cx + (r(10 + i) - 0.5) * 90, top + (r(30 + i) - 0.2) * 60, 3, '#f2dc6b');
    }
  }
  scene.textures.addCanvas(key, canvas);
  return key;
}

/** Painted furniture for inside buildings: [width, height] in tiles, and a painter. */
const FURNITURE: Record<string, [number, number, (ctx: CanvasRenderingContext2D, w: number, h: number) => void]> = {
  'furniture-bed': [2, 2.6, (ctx, w, h) => {
    box(ctx, 8, h * 0.2, w - 16, h * 0.7, ['#4a3324', '#6b4a33']);
    box(ctx, 8, 0, w - 16, h * 0.28, ['#4a3324', '#7a573c']);
    box(ctx, 24, h * 0.24, w - 48, h * 0.58, ['#3e6b3a', '#5f9468']);
    box(ctx, 34, h * 0.16, w - 68, h * 0.14, ['#c9bfae', '#f3e6c8']);
  }],
  'furniture-bookshelf': [2, 2.4, (ctx, w, h) => {
    box(ctx, 6, 0, w - 12, h - 8, ['#2f2018', '#5a3d2a']);
    const books = ['#a8423a', '#3e6b8a', '#c9a24a', '#5f9468', '#7a4a8a'];
    for (let shelf = 0; shelf < 3; shelf++) {
      const y = 18 + shelf * (h - 30) / 3;
      for (let i = 0, x = 20; x < w - 30; i++) {
        const bw = 12 + rand2(i, shelf, 21) * 10;
        ctx.fillStyle = books[(i + shelf) % books.length]!;
        ctx.fillRect(x, y + 10 + rand2(i, shelf, 22) * 12, bw - 3, (h - 30) / 3 - 20);
        x += bw;
      }
    }
  }],
  'furniture-hearth': [3, 2.6, (ctx, w, h) => {
    box(ctx, 0, 0, w, h - 8, ['#4a4550', '#8a8290']);
    box(ctx, w * 0.3, h * 0.4, w * 0.4, h * 0.5, ['#181425', '#2a2230']);
    dot(ctx, w * 0.5, h * 0.78, 22, '#f08e3a');
    dot(ctx, w * 0.5, h * 0.74, 12, '#feae34');
    box(ctx, -4, h * 0.3, w + 8, 16, ['#4a3324', '#6b4a33']);
  }],
  'furniture-herb-rack': [2, 2.4, (ctx, w, h) => {
    box(ctx, 10, 20, 12, h - 28, ['#4a3324', '#6b4a33']);
    box(ctx, w - 22, 20, 12, h - 28, ['#4a3324', '#6b4a33']);
    box(ctx, 4, 20, w - 8, 12, ['#4a3324', '#7a573c']);
    for (let i = 0; i < 6; i++) {
      const x = 30 + i * (w - 60) / 5;
      ctx.fillStyle = i % 2 ? '#5f9468' : '#8aa04a';
      ctx.beginPath();
      ctx.ellipse(x, 70 + rand2(i, 1, 23) * 20, 12, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }],
  'furniture-cauldron': [1.2, 1.2, (ctx, w, h) => {
    blob(ctx, w / 2, h * 0.58, w * 0.42, h * 0.34, ['#181425', '#3a3440', '#6a6270']);
    ctx.fillStyle = '#63c74d';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.36, w * 0.34, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }],
  'furniture-table': [2.6, 1.6, (ctx, w, h) => {
    box(ctx, 4, h * 0.45, 26, h * 0.45, ['#4a3324', '#7a573c']);
    box(ctx, w - 30, h * 0.45, 26, h * 0.45, ['#4a3324', '#7a573c']);
    box(ctx, 40, h * 0.3, 12, h * 0.6, ['#4a3324', '#5a3d2a']);
    box(ctx, w - 52, h * 0.3, 12, h * 0.6, ['#4a3324', '#5a3d2a']);
    box(ctx, 30, h * 0.1, w - 60, h * 0.32, ['#5a3d2a', '#a07c52']);
    dot(ctx, w * 0.45, h * 0.2, 9, '#f3e6c8');
    dot(ctx, w * 0.58, h * 0.22, 7, '#e8c66a');
  }],
  'furniture-barrel': [1, 1.4, (ctx, w, h) => {
    box(ctx, 14, 8, w - 28, h - 16, ['#4a3324', '#8a6a45']);
    ctx.fillStyle = '#3a3440';
    for (const f of [0.25, 0.7]) ctx.fillRect(14, 8 + (h - 16) * f, w - 28, 8);
  }],
};

/** Painted furniture by asset id, or undefined when it is not furniture. */
export function furnitureTexture(scene: Phaser.Scene, asset: string): string | undefined {
  const spec = FURNITURE[asset];
  if (!spec) return undefined;
  if (scene.textures.exists(asset)) return asset;
  const [tw, th, paint] = spec;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(tw * T);
  canvas.height = Math.round(th * T);
  paint(canvas.getContext('2d')!, canvas.width, canvas.height);
  scene.textures.addCanvas(asset, canvas);
  return asset;
}

/** A rounded block with a darker rim: [rim, body]. */
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, [rim, body]: string[]): void {
  ctx.fillStyle = rim!;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.fillStyle = body!;
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 4, w - 8, h - 10, 6);
  ctx.fill();
}

/** A shaded rounded mass: dark base, mid body, light top-left. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, [dark, mid, light]: string[]): void {
  ctx.fillStyle = dark!;
  ctx.beginPath();
  ctx.ellipse(x, y + 4, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mid!;
  ctx.beginPath();
  ctx.ellipse(x - 3, y - 2, rx * 0.9, ry * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = light!;
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.3, y - ry * 0.35, rx * 0.45, ry * 0.35, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, [dark, mid, light]: string[]): void {
  const round = (dx: number, width: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - width / 2 + dx, y - h / 2, width, h, width / 2);
    ctx.fill();
  };
  round(0, w, dark!);
  round(-1, w * 0.8, mid!);
  round(-w * 0.18, w * 0.25, light!);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Which of the two approved player looks a player wears. */
export function playerArt(playerId: string): string {
  return hashString(playerId) % 2 === 0 ? 'player-mara' : 'player-ilya';
}
