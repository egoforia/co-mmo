import type Phaser from 'phaser';
import { Tile, isBlocking, tileAt } from '@co-mmo/shared';
import type { WorldScene } from '../world-scene.ts';
import { GRID_RADIUS, drawTileGrid } from './tile-grid.ts';

// The editor's marks over the world around the middle of the screen (the
// free camera's centre, or the player when it is over another land): the
// hitboxes of the floor we stand on (tiles nobody can walk on) and the tile
// wireframe of the floor shown. They are the editor's own lines, never game art.

/** Which marks to draw. */
export interface MarkOptions {
  hitboxes: boolean;
  grid: boolean;
}

/** The tile of the land we are in that the marks are drawn around: the middle of the screen, or where we stand. */
function centre(scene: WorldScene): { x: number; y: number } {
  const mid = scene.cameraTile();
  if (mid && mid.region === scene.currentMap?.def.id) return { x: mid.x, y: mid.y };
  const at = scene.playerPosition;
  return { x: Math.floor(at.x), y: Math.floor(at.y) };
}

/** The tile and floors the marks are drawn around now, so they are drawn again only when it changes. */
export function marksKey(scene: WorldScene): string {
  const at = centre(scene);
  return `${scene.currentMap?.def.id}:${at.x},${at.y}:${scene.currentFloor}:${scene.shownFloor}`;
}

/** Draws the chosen marks around the middle of the screen, clearing the last ones first. */
export function drawMarks(scene: WorldScene, hitboxes: Phaser.GameObjects.Graphics, grid: Phaser.GameObjects.Graphics, show: MarkOptions): void {
  hitboxes.clear();
  grid.clear();
  const map = scene.currentMap;
  if (!map) return;
  const { x: cx, y: cy } = centre(scene);
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
