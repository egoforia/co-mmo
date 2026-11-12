import type Phaser from 'phaser';
import { storeyAt, type RegionMap } from '@co-mmo/shared';
import type { WorldScene } from '../world-scene.ts';

// The world editor's tile wireframe: thin lines along the edges of every
// tile near us, so an editor can count tiles and line things up. It is an
// editor mark like the outlines, seen only while the editor is open and
// switched on, never game art.

/** How far from where we stand the wireframe reaches, in tiles (the same as the hitboxes). */
export const GRID_RADIUS = 28;
const GRID_COLOUR = 0xffffff;
const GRID_ALPHA = 0.5;

/** Whether a floor has a tile here: the ground always does, other floors only inside a storey. */
function hasTile(map: RegionMap, x: number, y: number, floor: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return floor === 0 || storeyAt(map, x, y, floor) !== undefined;
}

/**
 * Draws the wireframe of a floor's tiles around a tile. Each tile draws its
 * north and west edges, and its south and east ones only where no tile
 * follows, so no line is drawn twice (a doubled line would look heavier).
 */
export function drawTileGrid(g: Phaser.GameObjects.Graphics, scene: WorldScene, map: RegionMap, floor: number, cx: number, cy: number): void {
  g.lineStyle(1, GRID_COLOUR, GRID_ALPHA);
  for (let y = cy - GRID_RADIUS; y <= cy + GRID_RADIUS; y++) {
    for (let x = cx - GRID_RADIUS; x <= cx + GRID_RADIUS; x++) {
      if (!hasTile(map, x, y, floor)) continue;
      // Corners in order: north (x, y), east (x+1, y), south (x+1, y+1), west (x, y+1).
      const [n, e, s, w] = scene.tileCorners(map, x, y, 1, 1) as [Phaser.Math.Vector2, Phaser.Math.Vector2, Phaser.Math.Vector2, Phaser.Math.Vector2];
      g.lineBetween(n.x, n.y, e.x, e.y);
      g.lineBetween(w.x, w.y, n.x, n.y);
      if (!hasTile(map, x, y + 1, floor)) g.lineBetween(s.x, s.y, w.x, w.y);
      if (!hasTile(map, x + 1, y, floor)) g.lineBetween(e.x, e.y, s.x, s.y);
    }
  }
}
