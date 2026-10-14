import Phaser from 'phaser';
import { BIOMES, TILE_PIXELS, Tile, hashString, rand2, type BiomeId, type RegionDef } from '@co-mmo/shared';

// Ground tiles come from the approved art. Water, trees and rocks are still
// painted in code with soft brushes until a biome kit is generated; they keep
// to each biome's colours so they sit beside the real art.

const T = TILE_PIXELS;
/** Each tile is extruded by this much so filtered tiles never show seams. */
export const TILE_MARGIN = 2;
const TILE_ORDER: Tile[] = [Tile.Ground, Tile.Path, Tile.Water, Tile.Tree, Tile.Rock, Tile.Blocked];

interface BiomeLook {
  ground: string | ((ctx: CanvasRenderingContext2D) => void);
  path: string | ((ctx: CanvasRenderingContext2D) => void);
  water: [string, string, string];
  prop: 'tree' | 'blossom' | 'palm' | 'cactus';
}

const LOOKS: Record<string, BiomeLook> = {
  sanctum: {
    ground: (ctx) => meadow(ctx, ['#7fa860', '#93b96b', '#6c9452'], ['#f3e6c8', '#e7a3a6', '#e8c66a']),
    path: 'sanctum-flagstones',
    water: ['#5c9cc0', '#8cc4de', '#d8eef5'],
    prop: 'blossom',
  },
  'whispering-woods': {
    ground: 'woods-moss',
    path: (ctx) => meadow(ctx, ['#6b4a33', '#7a573c', '#5a3d2a'], ['#5f9468', '#8a6a45']),
    water: ['#1f4f4a', '#2f6b5e', '#7fb8a0'],
    prop: 'tree',
  },
  'sunlit-shore': {
    ground: 'shore-sand',
    path: 'shore-sand',
    water: ['#2c7fa8', '#46c2c2', '#e8fbff'],
    prop: 'palm',
  },
  'mirage-desert': {
    ground: 'desert-dunes',
    path: 'desert-dunes',
    water: ['#2a8f8a', '#4fc4b8', '#e6fff6'],
    prop: 'cactus',
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
  const water = tileCanvas((c) => paintWater(c, look.water));

  for (const tile of TILE_ORDER) {
    const source = tile === Tile.Path ? path : tile === Tile.Water ? water : ground;
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

function paintSource(scene: Phaser.Scene, ctx: CanvasRenderingContext2D, source: BiomeLook['ground']): void {
  if (typeof source === 'function') return source(ctx);
  const image = scene.textures.exists(source) ? scene.textures.get(source).getSourceImage() : null;
  if (image) ctx.drawImage(image as CanvasImageSource, 0, 0, T, T);
  else meadow(ctx, ['#7fa860', '#93b96b', '#6c9452'], []);
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

/** A painted tree, palm, cactus or rock for a biome; a few variants each. */
export function propTexture(scene: Phaser.Scene, biome: string, kind: 'tree' | 'rock', variant: number): string {
  const look = biomeLook(biome);
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
