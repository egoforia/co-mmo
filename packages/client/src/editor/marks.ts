import type Phaser from 'phaser';
import { Tile, isBlocking, tileAt } from '@co-mmo/shared';
import type { WorldScene } from '../world-scene.ts';
import { GRID_RADIUS, drawTileGrid } from './tile-grid.ts';

// The editor's marks over the world around the middle of the screen (the
// free camera's centre, or the player when it is over another land): the
// hitboxes of the floor we stand on (tiles nobody can walk on) and the tile
// wireframe of the floor shown. They are the editor's own lines, never game art.

/** Where the tile wireframe switch is remembered, on this browser only. */
const GRID_KEY = 'co-mmo.editor.tileGrid';

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

/** The two marks' layers in a running scene, their switches (`name="hitboxes"`, `name="tile-grid"`), and where they were last drawn. */
export class WorldMarks {
  /** Hitboxes start off: their fill hides the art being judged. The wireframe is as it was left in this browser. */
  readonly show: MarkOptions = { hitboxes: false, grid: readGrid() };
  private hitboxes?: Phaser.GameObjects.Graphics;
  private grid?: Phaser.GameObjects.Graphics;
  /** Where the marks were last drawn around, so walking redraws them only on a new tile. */
  private drawnAt = '';

  /** Draws in a newly running scene, under the outlines at `depth`. */
  attach(scene: WorldScene, depth: number): void {
    this.hitboxes = scene.add.graphics().setDepth(depth - 5);
    this.grid = scene.add.graphics().setDepth(depth - 6);
  }

  clear(): void {
    this.hitboxes?.clear();
    this.grid?.clear();
    this.drawnAt = '';
  }

  /** True when the camera or the floor shown has moved since the marks were drawn. */
  stale(scene: WorldScene): boolean {
    return marksKey(scene) !== this.drawnAt;
  }

  /** Draws the marks switched on (none while the editor is closed). */
  draw(scene: WorldScene, open: boolean): void {
    if (!this.hitboxes || !this.grid) return;
    this.drawnAt = marksKey(scene);
    if (open) drawMarks(scene, this.hitboxes, this.grid, this.show);
  }

  /** A switch was flipped; false when the input is not one of them. */
  set(name: string, on: boolean): boolean {
    if (name === 'hitboxes') this.show.hitboxes = on;
    else if (name === 'tile-grid') {
      this.show.grid = on;
      try {
        localStorage.setItem(GRID_KEY, on ? '1' : '0');
      } catch {
        // No storage here: the switch still works until the page is reloaded.
      }
    } else return false;
    return true;
  }
}

/** Whether the tile wireframe was left on in this browser (off when nothing was saved). */
function readGrid(): boolean {
  try {
    return localStorage.getItem(GRID_KEY) === '1';
  } catch {
    return false;
  }
}
