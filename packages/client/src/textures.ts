import Phaser from 'phaser';
import { TILE_PIXELS, Tile, rand2 } from '@co-mmo/shared';

// Tier 0 placeholder art: drawn in code, pixel by pixel, from the master
// palette. Generated assets will replace these through the Asset Service.

const S = TILE_PIXELS;
const OUTLINE = '#181425';

type Paint = (px: (x: number, y: number, color: string) => void) => void;

function canvasFrom(width: number, height: number, paint: Paint): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  paint((x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  });
  return canvas;
}

function speckle(px: (x: number, y: number, c: string) => void, base: string, specks: [string, number][], seed: number): void {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let color = base;
      const r = rand2(x, y, seed);
      let acc = 0;
      for (const [c, p] of specks) {
        acc += p;
        if (r < acc) {
          color = c;
          break;
        }
      }
      px(x, y, color);
    }
  }
}

function grass(px: (x: number, y: number, c: string) => void, seed = 11): void {
  speckle(px, '#3e8948', [['#63c74d', 0.08], ['#265c42', 0.07]], seed);
}

function disc(px: (x: number, y: number, c: string) => void, cx: number, cy: number, r: number, fill: (dx: number, dy: number) => string): void {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r) px(x, y, fill(x - cx, y - cy));
      else if (d <= r + 1) px(x, y, OUTLINE);
    }
  }
}

const TILE_PAINTERS: Record<Tile, Paint> = {
  [Tile.Grass]: (px) => grass(px),
  [Tile.Flowers]: (px) => {
    grass(px, 12);
    const colors = ['#fee761', '#f6757a', '#ffffff', '#feae34'];
    for (let i = 0; i < 6; i++) {
      const x = 3 + Math.floor(rand2(i, 1, 99) * 26);
      const y = 3 + Math.floor(rand2(i, 2, 99) * 26);
      const c = colors[i % colors.length]!;
      px(x, y, c); px(x + 1, y, c); px(x, y + 1, c); px(x + 1, y + 1, c);
    }
  },
  [Tile.Sand]: (px) => speckle(px, '#e4a672', [['#ead4aa', 0.08], ['#c28569', 0.06]], 21),
  [Tile.Water]: (px) => {
    speckle(px, '#0099db', [['#124e89', 0.04]], 31);
    for (let x = 4; x < 12; x++) px(x, 8, '#2ce8f5');
    for (let x = 18; x < 26; x++) px(x, 20, '#2ce8f5');
    for (let x = 8; x < 13; x++) px(x, 27, '#2ce8f5');
  },
  [Tile.Tree]: (px) => {
    grass(px, 13);
    for (let y = 22; y < 30; y++) for (let x = 14; x < 18; x++) px(x, y, x === 14 ? '#3e2731' : '#733e39');
    disc(px, 16, 13, 10, (dx, dy) => (dx + dy < -6 ? '#63c74d' : dx + dy > 6 ? '#193c3e' : '#265c42'));
  },
  [Tile.Path]: (px) => {
    speckle(px, '#8b9bb4', [['#c0cbdc', 0.05], ['#5a6988', 0.05]], 41);
    for (let i = 0; i < S; i++) {
      px(i, 15, '#5a6988');
      px(i < 16 ? 8 : 24, i, '#5a6988');
    }
  },
  [Tile.Shrine]: (px) => {
    speckle(px, '#8b9bb4', [['#c0cbdc', 0.05]], 51);
    for (let y = 18; y < 30; y++) {
      for (let x = 7; x < 25; x++) {
        const edge = x === 7 || x === 24 || y === 18 || y === 29;
        px(x, y, edge ? OUTLINE : y < 21 ? '#ffffff' : '#c0cbdc');
      }
    }
    disc(px, 16, 11, 7, (dx, dy) => (dx + dy < -4 ? '#ffffff' : dx + dy > 4 ? '#feae34' : '#fee761'));
  },
};

export function tilesetKey(): string {
  return 'tileset';
}

/** Draws every tile into one horizontal strip used as the tilemap tileset. */
export function registerTileset(scene: Phaser.Scene): void {
  const tiles = Object.keys(TILE_PAINTERS).map(Number) as Tile[];
  const canvas = document.createElement('canvas');
  canvas.width = S * tiles.length;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  for (const tile of tiles) ctx.drawImage(canvasFrom(S, S, TILE_PAINTERS[tile]), tile * S, 0);
  scene.textures.addCanvas(tilesetKey(), canvas);
}

/** A small adventurer in the player's outfit colour, created once per colour. */
export function playerTexture(scene: Phaser.Scene, color: number): string {
  const key = `player-${color.toString(16)}`;
  if (scene.textures.exists(key)) return key;
  const outfit = `#${color.toString(16).padStart(6, '0')}`;
  const canvas = canvasFrom(S, S, (px) => {
    const fillRect = (x0: number, y0: number, w: number, h: number, c: string) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, c);
    };
    // Shadow under the feet is drawn by the engine, not baked in.
    fillRect(11, 4, 10, 10, OUTLINE);
    fillRect(12, 5, 8, 8, '#e8b796');
    fillRect(12, 5, 8, 3, '#733e39');
    px(14, 9, OUTLINE); px(17, 9, OUTLINE);
    fillRect(9, 14, 14, 11, OUTLINE);
    fillRect(10, 15, 12, 9, outfit);
    fillRect(11, 25, 4, 5, OUTLINE);
    fillRect(17, 25, 4, 5, OUTLINE);
    fillRect(12, 25, 2, 4, '#3a4466');
    fillRect(18, 25, 2, 4, '#3a4466');
  });
  scene.textures.addCanvas(key, canvas);
  return key;
}
