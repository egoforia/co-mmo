import type Phaser from 'phaser';
import { cameraZoom } from './types.ts';

// The world editor's free camera: while the editor is open the camera leaves
// the player, so an editor can look anywhere in the lands drawn around them
// without walking there. It pans by screen pixels, zooms in steps around the
// usual zoom, and can follow the player again (Home, or after a bookmark's
// Go) until it is moved. The camera's bounds keep it over the drawn lands.

/** How far the free camera zooms, as shares of the usual zoom, from furthest out. */
export const FREE_ZOOMS = [0.5, 0.75, 1, 1.5] as const;
const USUAL = FREE_ZOOMS.indexOf(1);

/** The free camera over a scene's main camera. */
export class FreeCamera {
  private on = false;
  private step = USUAL;

  constructor(
    private readonly scene: Phaser.Scene,
    /** What the camera follows when it is not free: the player's body. */
    private readonly target: () => Phaser.GameObjects.GameObject | undefined,
    /** Called after the zoom changes, so what is sized by it fits again. */
    private readonly zoomed: () => void,
  ) {}

  get active(): boolean {
    return this.on;
  }

  /** The zoom as a share of the usual one. */
  get zoomShare(): number {
    return FREE_ZOOMS[this.step]!;
  }

  /** Frees the camera where it is, or gives it back to the player at the usual zoom. */
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    const cam = this.scene.cameras.main;
    if (on) {
      cam.stopFollow();
      return;
    }
    this.step = USUAL;
    cam.setZoom(cameraZoom());
    this.zoomed();
    this.follow();
  }

  /** Moves the free camera by screen pixels (it stops following). */
  pan(dx: number, dy: number): void {
    if (!this.on || (!dx && !dy)) return;
    const cam = this.scene.cameras.main;
    cam.stopFollow();
    cam.setScroll(cam.scrollX + dx / cam.zoom, cam.scrollY + dy / cam.zoom);
  }

  /** Zooms one step in (1) or out (-1); returns the new share of the usual zoom. */
  zoom(direction: 1 | -1): number {
    if (!this.on) return 1;
    const next = Math.max(0, Math.min(FREE_ZOOMS.length - 1, this.step + direction));
    if (next !== this.step) {
      this.step = next;
      this.scene.cameras.main.setZoom(cameraZoom() * FREE_ZOOMS[next]!);
      this.zoomed();
    }
    return this.zoomShare;
  }

  /** Centres the camera on a point of the world (in the scene's pixels); it stops following. */
  centreOn(x: number, y: number): void {
    const cam = this.scene.cameras.main;
    cam.stopFollow();
    cam.centerOn(x, y);
  }

  /** The camera follows the player again (still free: the next pan lets go). */
  follow(): void {
    const body = this.target();
    if (body) this.scene.cameras.main.startFollow(body, true, 0.2, 0.2);
  }
}
