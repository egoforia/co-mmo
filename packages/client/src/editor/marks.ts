import type Phaser from 'phaser';
import { Tile, isBlocking, tileAt } from '@co-mmo/shared';
import type { WorldScene } from '../world-scene.ts';
import { GRID_RADIUS, drawTileGrid } from './tile-grid.ts';

// The editor's marks over the world near the player: the hitboxes of the
// floor we stand on (tiles nobody can walk on) and the tile wireframe of the
// floor shown. They are the editor's own lines, never game art.

/** Which marks to draw. */
export interface MarkOptions {
  hitboxes: boolean;
  grid: boolean;
}

/** The tile and floors the marks are drawn around now, so walking redraws them only on a new tile. */
export function marksKey(scene: WorldScene): string {
  const at = scene.playerPosition;
  return `${scene.currentMap?.def.id}:${Math.floor(at.x)},${Math.floor(at.y)}:${scene.currentFloor}:${scene.shownFloor}`;
}

/** Draws the chosen marks around the player, clearing the last ones first. */
export function drawMarks(scene: WorldScene, hitboxes: Phaser.GameObjects.Graphics, grid: Phaser.GameObjects.Graphics, show: MarkOptions): void {
  hitboxes.clear();
  grid.clear();
  const map = scene.currentMap;
  if (!map) return;
  const cx = Math.floor(scene.playerPosition.x);
  const cy = Math.floor(scene.playerPosition.y);
  if (show.grid) drawTileGrid(grid, scene, map, scene.shownFloor, cx, cy);
  if (!show.hitboxes) return;
  const floor = scene.currentFloor;
  for (let ty = Math.max(0, cy - GRID_RADIUS); ty <= Math.min(map.height - 1, cy + GRID_RADIUS); ty++) {
    for (let tx = Math.max(0, cx - GRID_RADIUS); tx <= Math.min(map.width - 1, cx + GRID_RADIUS); tx++) {
      const t = tileAt(map, tx, ty, floor);
      if (!isBlocking(t)) continue;
      const pts = scene.tileCorners(map, tx, ty, 1, 1);
      const colour = t === Tile.Wall || t === Tile.Blocked ? 0xf6757a : 0xf2a06b;
      hitboxes.fillStyle(colour, 0.35);
      hitboxes.fillPoints(pts, true);
      hitboxes.lineStyle(1.5, colour, 0.9);
      hitboxes.strokePoints(pts, true);
    }
  }
}
