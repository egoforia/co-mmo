import Phaser from 'phaser';
import { Tile, isBlocking, tileAt, type Outline, type TilePoint } from '@co-mmo/shared';
import { worldEdits, type EditLog } from '../api.ts';
import { escapeHtml } from '../ui.ts';
import type { WorldScene } from '../world-scene.ts';
import { EditorCore, editListHtml, historyHtml, toolsHtml, type ToolStep } from './core.ts';

// The world editor's window beside the game, for the Owner and Stewards,
// used by pointing at the world. The tools, their settings and what they
// make come from the editor core (core.ts), the same as the Studio's map.
// Each change goes to the server, which saves it, lays the land out again
// everywhere and shows it to everyone there; undo takes it back. The
// outlines it draws over the world are the editor's own marks, seen only
// while it is open, never game art.

/** Above everything in the world, labels included. */
const OUTLINE_DEPTH = 1_000_010;
const TONES: Record<NonNullable<Outline['tone']>, number> = { aim: 0xf2dc6b, held: 0x6fd08c, warn: 0xf6757a };

export interface EditorOptions {
  token: string;
  /** The game's scene, once it is running. */
  scene: () => WorldScene | undefined;
  /** The land we are in. */
  region: () => { id: string; name: string };
}

/** The world editor's window and its pointer tools. */
export class EditorUi {
  private readonly box = document.getElementById('editor')!;
  private readonly core = new EditorCore();
  private open = false;
  /** The land whose edits the list shows: the one last edited, or the one we are in. */
  private listRegion = '';
  private listName = '';
  private log: EditLog = { edits: [], undone: 0 };
  private busy = false;
  private status = '';
  private outline?: Phaser.GameObjects.Graphics;
  private hitboxGraphics?: Phaser.GameObjects.Graphics;
  private showHitboxes = true;
  private attached?: WorldScene;

  constructor(private readonly options: EditorOptions) {
    this.box.addEventListener('click', (event) => void this.clicked(event));
    this.box.addEventListener('change', (event) => this.changed(event));
    document.addEventListener('keydown', (event) => {
      if (!this.open || (event.target as HTMLElement).closest?.('input, textarea')) return;
      const key = event.key.toLowerCase();
      if (key === 'escape') {
        this.core.cancel();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (key === 'z' && !event.shiftKey) void this.act({ undo: true });
      else if (key === 'y' || (key === 'z' && event.shiftKey)) void this.act({ redo: true });
      else return;
      event.preventDefault();
    });
  }

  /** Opens or closes the editor. */
  toggle(open = !this.open): void {
    this.open = open;
    this.box.hidden = !open;
    this.core.cancel();
    if (!open) {
      this.outline?.clear();
      this.hitboxGraphics?.clear();
      return;
    }
    this.attach();
    this.follow();
    this.render();
    void this.reload();
  }

  /** Shows the edits of the land we are in. */
  private follow(): void {
    ({ id: this.listRegion, name: this.listName } = this.options.region());
  }

  /** We walked into another land: the list follows us, unless we were editing elsewhere just now. */
  regionChanged(): void {
    if (!this.open || this.listRegion === this.options.region().id) return;
    this.follow();
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.log = await worldEdits(this.options.token, this.listRegion);
    } catch (err) {
      this.status = (err as Error).message;
    }
    this.render();
  }

  /** Listens to the pointer over the world, once the scene is running. */
  private attach(): void {
    const scene = this.options.scene();
    if (!scene || this.attached === scene || !scene.sys.isActive()) return;
    this.attached = scene;
    this.outline = scene.add.graphics().setDepth(OUTLINE_DEPTH);
    this.hitboxGraphics = scene.add.graphics().setDepth(OUTLINE_DEPTH - 5);
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointer(p, p.isDown ? 'drag' : 'hover'));
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointer(p, 'down'));
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointer(p, 'up'));
  }

  private pointer(p: Phaser.Input.Pointer, kind: 'hover' | 'down' | 'drag' | 'up'): void {
    const scene = this.attached;
    if (!this.open || !scene) return;
    if (kind === 'up') return void this.step(this.core.release());
    const at = scene.tileAt(p.x, p.y);
    if (!at) {
      this.outline?.clear();
      return;
    }
    const spot: TilePoint = [at.x, at.y];
    const level = this.levelIn(at.region);
    if (kind === 'down' && !this.busy) void this.step(this.core.press(at.region, at.map, spot, level));
    else if (kind === 'drag') this.core.drag(at.region, at.map, spot);
    this.drawHitboxes();
    this.outline?.clear();
    for (const o of this.core.outlines(at.region, at.map, spot, level)) {
      this.outline?.lineStyle(2, TONES[o.tone ?? 'aim'], 0.95);
      this.outline?.strokePoints(scene.tileCorners(at.map, o.x, o.y, o.w, o.h), true);
    }
  }

  /** Does what a tool asks: says something, or sends the edit it made. */
  private async step(step: ToolStep): Promise<void> {
    if (step.draft) await this.act({ edit: step.draft }, step.region);
    else if (step.say !== undefined) this.render(step.say);
    else if (this.core.holding()) this.render();
  }

  /** Sends a change (or undo, redo, remove) and shows the land's edits as they now are. */
  private async act(action: Parameters<typeof worldEdits>[2] & object, region = this.listRegion, name = region === this.listRegion ? this.listName : this.nameOf(region)): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render('Saving…');
    try {
      this.log = await worldEdits(this.options.token, region, action);
      this.listRegion = region;
      this.listName = name;
      this.status = 'undo' in action ? 'Taken back.' : 'redo' in action ? 'Made again.' : 'remove' in action ? 'Taken out.' : 'Done. Everyone here sees it now.';
    } catch (err) {
      this.status = (err as Error).message;
    }
    this.busy = false;
    this.render();
  }

  /** The floor we stand on, in our own land; the ground in the lands drawn around it. */
  private levelIn(region: string): number {
    return region === this.options.region().id ? (this.attached?.currentFloor ?? 0) : 0;
  }

  /** A land's name, from the ones drawn around us. */
  private nameOf(region: string): string {
    return this.attached?.landName(region) ?? 'that land';
  }

  /** Draws collision hitboxes for the current floor around the player. */
  drawHitboxes(): void {
    const scene = this.attached;
    const g = this.hitboxGraphics;
    if (!scene || !g) return;
    g.clear();
    if (!this.open || !this.showHitboxes) return;
    const map = scene.currentMap;
    if (!map) return;
    const floor = scene.currentFloor;
    const cx = Math.floor(scene.playerPosition.x);
    const cy = Math.floor(scene.playerPosition.y);
    const radius = 28;
    for (let ty = Math.max(0, cy - radius); ty <= Math.min(map.height - 1, cy + radius); ty++) {
      for (let tx = Math.max(0, cx - radius); tx <= Math.min(map.width - 1, cx + radius); tx++) {
        const t = tileAt(map, tx, ty, floor);
        if (!isBlocking(t)) continue;
        const pts = scene.tileCorners(map, tx, ty, 1, 1);
        const colour = t === Tile.Wall || t === Tile.Blocked ? 0xf6757a : 0xf2a06b;
        g.fillStyle(colour, 0.35);
        g.fillPoints(pts, true);
        g.lineStyle(1.5, colour, 0.9);
        g.strokePoints(pts, true);
      }
    }
  }

  private async clicked(event: Event): Promise<void> {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    if (button.classList.contains('close')) return this.toggle(false);
    const d = button.dataset;
    if (d.tool) {
      this.core.choose(d.tool);
      return this.render('');
    }
    if (d.undo !== undefined) return this.act({ undo: true });
    if (d.redo !== undefined) return this.act({ redo: true });
    if (d.remove) return this.act({ remove: d.remove });
    if (d.away !== undefined) return this.step(this.core.takeAway(this.levelIn(this.listRegion)));
  }

  private changed(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.name === 'hitboxes') {
      this.showHitboxes = input.checked;
      this.drawHitboxes();
    } else this.core.set(input.name, input.value, input.checked);
    // Hand the keys back to walking.
    input.blur();
  }

  private render(status?: string): void {
    if (status !== undefined) this.status = status;
    if (!this.open) return;
    const tool = this.core.current();
    this.box.innerHTML = `
      <h2>World editor <label class="hitbox-toggle"><input type="checkbox" name="hitboxes" ${this.showHitboxes ? 'checked' : ''} /> Hitboxes</label><button type="button" class="close" aria-label="Close">×</button></h2>
      <div class="tools">${toolsHtml(this.core)}</div>
      <p class="note">${escapeHtml(tool.hint)}</p>
      <div class="settings">${this.core.settingsHtml()}</div>
      <p class="status" aria-live="polite">${escapeHtml(this.status)}</p>
      <h3>Edits in ${escapeHtml(this.listName)}
        ${historyHtml(this.log, this.busy)}</h3>
      ${editListHtml(this.log)}`;
    this.drawHitboxes();
  }
}
