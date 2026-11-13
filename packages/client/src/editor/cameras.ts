import type { WorldScene } from '../world-scene.ts';
import type { PlanView } from './plan-view.ts';

// The editor's two cameras and what moves them: the World camera (the game's
// isometric view, free of the player while the editor is open) and the Plan
// camera (any land from above, plan-view.ts). Tab, the top bar's switch and
// the finder choose one; Home, Bring me here, a change's Go, the zoom keys
// and the pan keys work in whichever is looking.

/** Which camera the editor looks through. */
export type CameraId = 'world' | 'plan';

/** What the cameras need from the editor around them. */
export interface CameraHost {
  scene(): WorldScene | undefined;
  /** The land we are in, and the land the editor lists. */
  ourLand(): string;
  listed(): string;
  levelIn(region: string): number;
  chooseFloor(level: number): void;
  /** The list goes back to the land we are in. */
  followUs(): void;
  teleport?: (to: { region: string; x: number; y: number; floor: number }) => void;
  say(words: string): void;
}

/** The World and Plan cameras. */
export class Cameras {
  id: CameraId = 'world';

  constructor(private readonly host: CameraHost, readonly plan: PlanView) {}

  /** Looks through a camera; the Plan shows the land named, or the one listed. */
  choose(id: CameraId, region = this.host.listed()): void {
    this.id = id;
    if (id === 'plan') return void this.plan.show(region);
    this.plan.hide();
    // Back in the World camera, the editor works on the land we are in again.
    if (this.host.listed() !== this.host.ourLand()) this.host.followUs();
  }

  /** The other camera. */
  other(): CameraId {
    return this.id === 'plan' ? 'world' : 'plan';
  }

  /** The tile in the middle of the view. */
  middle(): { region: string; x: number; y: number } | undefined {
    return this.plan.open ? this.plan.middle() : this.host.scene()?.cameraTile();
  }

  /** The camera goes back to the player and follows them until it is moved again (the Plan: to their land, around them). */
  home(): void {
    const scene = this.host.scene();
    scene?.followMe();
    if (this.plan.open) {
      const at = scene?.playerPosition;
      void this.plan.show(this.host.ourLand()).then(() => at && this.plan.centre(at.x, at.y));
    }
    this.host.say('Back to you.');
  }

  /** The camera goes to a tile of the land listed, on its floor. */
  lookAt(x: number, y: number, level: number): void {
    if (level !== this.host.levelIn(this.host.listed())) this.host.chooseFloor(level);
    if (this.plan.open) return this.plan.centre(x, y);
    const scene = this.host.scene();
    const map = scene?.landMap(this.host.listed());
    if (!scene || !map) return this.host.say('That land is not in sight.');
    scene.lookAt(map, x, y);
  }

  /** The mini map was clicked at a tile of the land we are in: the World camera goes there. */
  jumpTo(x: number, y: number): boolean {
    const scene = this.host.scene();
    if (!scene?.currentMap) return false;
    if (this.plan.open) this.choose('world');
    scene.lookAt(scene.currentMap, x - 0.5, y - 0.5);
    return true;
  }

  /** Zooms a step in or out. */
  zoom(direction: 1 | -1): void {
    if (this.plan.open) return this.plan.zoom(direction);
    const share = this.host.scene()?.zoomCamera(direction);
    if (share !== undefined) this.host.say(`Zoom ${Math.round(share * 100)}%.`);
  }

  /** The pan keys move the camera, or scroll the plan. */
  pan(dx: number, dy: number): void {
    if (!dx && !dy) return;
    if (this.plan.open) this.plan.scrollBy(dx, dy);
    else this.host.scene()?.panCamera(dx, dy);
  }

  /** Brings the player to the middle of the view, on the floor shown (the server moves them to open ground nearby if need be). */
  bringMe(): void {
    const at = this.middle();
    if (!at) return this.host.say('There is no land in the middle of the screen.');
    this.host.teleport?.({ region: at.region, x: at.x + 0.5, y: at.y + 0.5, floor: this.host.levelIn(at.region) });
    this.host.scene()?.followMe();
    this.host.say('Bringing you here.');
  }
}
