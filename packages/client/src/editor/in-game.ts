import Phaser from 'phaser';
import { MAX_FLOORS, Tile, floorName, isBlocking, landChecks, tileAt, type Bookmark, type LandChecks, type Outline, type TilePoint, type Weather } from '@co-mmo/shared';
import { worldEdits, type EditLog } from '../api.ts';
import { escapeHtml } from '../ui.ts';
import type { WorldScene } from '../world-scene.ts';
import { EditorCore, draftsHtml, editListHtml, historyHtml, toolsHtml, type ToolStep } from './core.ts';
import { GRID_RADIUS, drawTileGrid } from './tile-grid.ts';

/** Where the tile wireframe switch is remembered, on this browser only. */
const GRID_KEY = 'co-mmo.editor.tileGrid';

/** The hours the editor can show a land at, as phases of the day (sky.ts: dawn from 5, day from 7, dusk from 18, night from 20). */
const PREVIEW_HOURS: Record<string, { name: string; phase?: number }> = {
  '': { name: 'The hour it is' },
  dawn: { name: 'Dawn', phase: 6 / 24 },
  day: { name: 'Midday', phase: 12 / 24 },
  dusk: { name: 'Dusk', phase: 19 / 24 },
  night: { name: 'Midnight', phase: 0 },
};
/** The weather the editor can show a land in ('' is as it is). */
const PREVIEW_WEATHER: (Weather | '')[] = ['', 'clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'sandstorm'];

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
  /** Takes us to a place (a bookmark), in this land or another. */
  teleport?: (to: { region: string; x: number; y: number; floor: number }) => void;
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
  private gridGraphics?: Phaser.GameObjects.Graphics;
  private showGrid = readGrid();
  /** Where the hitboxes and wireframe were last drawn around, so walking redraws them only on a new tile. */
  private drawnAt = '';
  private attached?: WorldScene;
  /** The hour and weather the editor shows the land in ('' and none: as they are). */
  private readonly sky: { hour: string; weather?: Weather } = { hour: '' };
  /** The floor the editor works on and shows, or undefined for the one we stand on. */
  private floor?: number;
  /** What the last check of a land found, shown while the list shows that land. */
  private checks?: { region: string; found: LandChecks; unpainted: string[] };
  /** Whether the bookmarks list is unfolded, kept as the window is drawn again. */
  private marksOpen = false;
  /** New edits go live at once instead of waiting as drafts. */
  private live = false;

  constructor(private readonly options: EditorOptions) {
    this.box.addEventListener('click', (event) => void this.clicked(event));
    this.box.addEventListener('change', (event) => this.changed(event));
    // A fold's toggle does not bubble: listen on the way down.
    this.box.addEventListener('toggle', (event) => {
      const fold = event.target as HTMLDetailsElement;
      if (fold.classList?.contains('bookmarks-box')) this.marksOpen = fold.open;
    }, true);
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
      this.gridGraphics?.clear();
      this.drawnAt = '';
      this.attached?.viewFloor(undefined);
      this.attached?.previewEdits(this.listRegion);
      this.attached?.previewSky({});
      return;
    }
    this.attach();
    this.follow();
    this.render();
    void this.reload();
  }

  /** Shows the edits of the land we are in. */
  private follow(): void {
    if (this.listRegion) this.attached?.previewEdits(this.listRegion);
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
      this.showDrafts();
    } catch (err) {
      this.status = (err as Error).message;
    }
    this.render();
  }

  /** The scene shows the listed land's drafts while the editor is open. */
  private showDrafts(): void {
    this.attached?.previewEdits(this.listRegion, this.open ? this.log.edits : undefined);
  }

  /** Listens to the pointer over the world, once the scene is running. */
  private attach(): void {
    const scene = this.options.scene();
    if (!scene || this.attached === scene || !scene.sys.isActive()) return;
    this.attached = scene;
    this.outline = scene.add.graphics().setDepth(OUTLINE_DEPTH);
    this.hitboxGraphics = scene.add.graphics().setDepth(OUTLINE_DEPTH - 5);
    this.gridGraphics = scene.add.graphics().setDepth(OUTLINE_DEPTH - 6);
    // Walking (or the floor shown changing) moves what the marks are drawn around.
    scene.events.on('update', () => {
      if (this.open && this.marksKey() !== this.drawnAt) this.drawHitboxes();
    });
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
    if (step.drafts) await this.act({ edits: step.drafts, live: this.live }, step.region);
    else if (step.draft) await this.act({ edit: step.draft, live: this.live }, step.region);
    else if (step.say !== undefined) this.render(step.say);
    else if (this.core.holding()) this.render();
  }

  /** Sends a change (or undo, redo, remove) and shows the land's edits as they now are. */
  private async act(action: Parameters<typeof worldEdits>[2] & object, region = this.listRegion, name = region === this.listRegion ? this.listName : this.nameOf(region)): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render('Saving…');
    try {
      if (region !== this.listRegion) this.attached?.previewEdits(this.listRegion);
      this.log = await worldEdits(this.options.token, region, action);
      this.listRegion = region;
      this.listName = name;
      this.showDrafts();
      this.status = 'undo' in action ? 'Taken back.' : 'redo' in action ? 'Made again.' : 'remove' in action ? 'Taken out.'
        : 'publish' in action ? 'Published. Everyone here sees it now.' : 'discard' in action ? 'Drafts thrown away. Redo brings them back.'
        : this.live ? 'Done. Everyone here sees it now.' : 'Drafted. Only editors see it until you publish.';
    } catch (err) {
      this.status = (err as Error).message;
    }
    this.busy = false;
    this.render();
  }

  /** The floor chosen (or the one we stand on), in our own land; the ground in the lands drawn around it. */
  private levelIn(region: string): number {
    return region === this.options.region().id ? (this.floor ?? this.attached?.currentFloor ?? 0) : 0;
  }

  /** The editor works on and shows another floor, or the one we stand on again. */
  private chooseFloor(raw: string): void {
    this.floor = raw === '' ? undefined : Number(raw);
    this.core.cancel();
    this.attached?.viewFloor(this.floor);
    this.render('');
  }

  /** The floor picker: where we stand, or any floor from the highest down. */
  private floorHtml(): string {
    const floors = Array.from({ length: MAX_FLOORS.up + MAX_FLOORS.down + 1 }, (_, i) => MAX_FLOORS.up - i);
    const option = (value: string, label: string, chosen: boolean) => `<option value="${value}"${chosen ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const hours = Object.entries(PREVIEW_HOURS).map(([id, h]) => option(id, h.name, this.sky.hour === id)).join('');
    const weathers = PREVIEW_WEATHER.map((w) => option(w, w === '' ? 'As it is' : w[0]!.toUpperCase() + w.slice(1), (this.sky.weather ?? '') === w)).join('');
    return `<label class="floor-pick">Floor <select name="view-floor">${option('', 'Where I stand', this.floor === undefined)}${floors.map((f) => option(String(f), floorName(f), this.floor === f)).join('')}</select></label>
      <label class="floor-pick">See it at <select name="view-hour">${hours}</select></label>
      <label class="floor-pick">In <select name="view-weather">${weathers}</select></label>`;
  }

  /** Shows the land at another hour or in other weather, on this screen only (players see the sky as it is). */
  private chooseSky(hour?: string, weather?: string): void {
    if (hour !== undefined) this.sky.hour = Object.hasOwn(PREVIEW_HOURS, hour) ? hour : '';
    if (weather !== undefined) this.sky.weather = (PREVIEW_WEATHER as string[]).includes(weather) && weather ? (weather as Weather) : undefined;
    this.attached?.previewSky({ ...(PREVIEW_HOURS[this.sky.hour]?.phase !== undefined ? { phase: PREVIEW_HOURS[this.sky.hour]!.phase } : {}), ...(this.sky.weather ? { weather: this.sky.weather } : {}) });
  }

  /** Checks the land the list shows: shapes, walks, and pictures not painted yet. */
  private check(): void {
    const scene = this.attached;
    const map = scene?.landMap(this.listRegion);
    if (!scene || !map) return this.render('That land is not in sight to check.');
    // Pictures the land shows that this screen has none of: people, monsters and pieces.
    const assets = new Set([...map.npcs.map((n) => n.asset), ...map.creatures.map((c) => c.asset), ...map.landmarks.map((l) => l.asset)]);
    const unpainted = [...assets].filter((a) => a && !scene.textures.exists(a)).sort();
    this.checks = { region: this.listRegion, found: landChecks(map), unpainted };
    const { shapes, walks } = this.checks.found;
    this.render(shapes.length + walks.length + unpainted.length ? 'Checked. See what turned up below.' : 'Checked. All is well here.');
  }

  /** The check and shot buttons, and what the last check found in three short lists. */
  private checksHtml(): string {
    const c = this.checks;
    const buttons = '<p class="checks-actions"><button type="button" class="quiet" data-check>Check this land</button> <button type="button" class="quiet" data-shot title="Saves a picture of what you see">Take a shot here</button></p>';
    if (!c || c.region !== this.listRegion) return buttons;
    const list = (title: string, items: string[], none: string) =>
      `<h4>${escapeHtml(title)}</h4>${items.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : `<p class="note">${escapeHtml(none)}</p>`}`;
    const n = c.unpainted.length;
    // The Art tab's two image models: about 4 cents a picture, or 12 for the sharper one.
    const cost = n ? `<p class="note">About $${(n * 0.039).toFixed(2)} to $${(n * 0.12).toFixed(2)} to paint them all in the Art tab.</p>` : '';
    return `<details class="checks-box" open><summary>Checks</summary>
      ${list('Shapes', c.found.shapes, 'Every floor, stair and kit building holds together.')}
      ${list('Walks', c.found.walks, 'Everyone and everything here can be walked to from where players arrive.')}
      ${list('Not painted yet', c.unpainted, 'Everything here has its picture.')}${cost}
      </details>${buttons}`;
  }

  /** Saves a picture of the game as it is drawn now (the editor's window is not in it). */
  private shot(): void {
    const scene = this.attached;
    if (!scene) return this.render('The game is not running yet.');
    const at = scene.playerPosition;
    const name = `co-mmo-${this.options.region().id}-${Math.floor(at.x)}-${Math.floor(at.y)}.png`;
    scene.game.renderer.snapshot((image) => {
      if (!(image instanceof HTMLImageElement)) return this.render('The picture could not be taken.');
      const link = document.createElement('a');
      link.href = image.src;
      link.download = name;
      link.click();
      this.render(`Saved ${name}.`);
    });
  }

  /** The bookmarks of the land the list shows, each with a button to go there (`data-go`). */
  private bookmarksHtml(): string {
    const marks = this.bookmarks();
    if (!marks.length) return '';
    const items = marks.map((b, i) => `<li><span><strong>${escapeHtml(b.name)}</strong>${b.note ? ` <span class="note">${escapeHtml(b.note)}</span>` : ''}</span>
      <button type="button" class="quiet" data-go="${i}" title="Go there">Go</button></li>`);
    // Folded, so a land with many (the testbed has 25) leaves the edit list in sight.
    return `<details class="bookmarks-box"${this.marksOpen ? ' open' : ''}><summary>Bookmarks (${marks.length})</summary><ol class="bookmarks">${items.join('')}</ol></details>`;
  }

  private bookmarks(): Bookmark[] {
    return this.attached?.landMap(this.listRegion)?.bookmarks ?? [];
  }

  /** A land's name, from the ones drawn around us. */
  private nameOf(region: string): string {
    return this.attached?.landName(region) ?? 'that land';
  }

  /** The tile and floors the editor's marks are drawn around now. */
  private marksKey(): string {
    const scene = this.attached;
    if (!scene) return '';
    const at = scene.playerPosition;
    return `${scene.currentMap?.def.id}:${Math.floor(at.x)},${Math.floor(at.y)}:${scene.currentFloor}:${scene.shownFloor}`;
  }

  /** Draws collision hitboxes for the current floor, and the tile wireframe of the floor shown, around the player. */
  drawHitboxes(): void {
    const scene = this.attached;
    const g = this.hitboxGraphics;
    if (!scene || !g) return;
    g.clear();
    this.gridGraphics?.clear();
    this.drawnAt = this.marksKey();
    if (!this.open) return;
    const map = scene.currentMap;
    if (!map) return;
    const cx = Math.floor(scene.playerPosition.x);
    const cy = Math.floor(scene.playerPosition.y);
    if (this.showGrid && this.gridGraphics) drawTileGrid(this.gridGraphics, scene, map, scene.shownFloor, cx, cy);
    if (!this.showHitboxes) return;
    const floor = scene.currentFloor;
    const radius = GRID_RADIUS;
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
    if (d.publish !== undefined) return this.act({ publish: true });
    if (d.discard !== undefined) return this.act({ discard: true });
    if (d.away !== undefined) return this.step(this.core.takeAway(this.levelIn(this.listRegion)));
    if (d.pick) return this.step(this.core.pickAction(d.pick));
    if (d.area) return this.step(this.core.areaAction(d.area, d.value));
    if (d.check !== undefined) return this.check();
    if (d.shot !== undefined) return this.shot();
    if (d.go !== undefined) {
      const mark = this.bookmarks()[Number(d.go)];
      if (!mark) return;
      this.chooseFloor('');
      this.options.teleport?.({ region: this.listRegion, x: mark.x, y: mark.y, floor: mark.floor });
      this.render(`Going to ${mark.name}.`);
    }
  }

  private changed(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.name === 'hitboxes') {
      this.showHitboxes = input.checked;
      this.drawHitboxes();
    } else if (input.name === 'tile-grid') {
      this.showGrid = input.checked;
      try {
        localStorage.setItem(GRID_KEY, input.checked ? '1' : '0');
      } catch {
        // No storage here: the switch still works until the page is reloaded.
      }
      this.drawHitboxes();
    } else if (input.name === 'view-floor') this.chooseFloor(input.value);
    else if (input.name === 'view-hour') this.chooseSky(input.value);
    else if (input.name === 'view-weather') this.chooseSky(undefined, input.value);
    else if (input.name === 'live') this.live = input.checked;
    else if (this.core.set(input.name, input.value, input.checked) && this.core.hasNotes()) this.render();
    // Hand the keys back to walking.
    input.blur();
  }

  private render(status?: string): void {
    if (status !== undefined) this.status = status;
    if (!this.open) return;
    // The game may not have been running yet when the editor opened.
    this.attach();
    const tool = this.core.current();
    this.box.innerHTML = `
      <h2>World editor <span class="view-toggles"><label class="hitbox-toggle" title="Thin lines around every tile near you"><input type="checkbox" name="tile-grid" ${this.showGrid ? 'checked' : ''} /> Tiles</label><label class="hitbox-toggle"><input type="checkbox" name="hitboxes" ${this.showHitboxes ? 'checked' : ''} /> Hitboxes</label></span><button type="button" class="close" aria-label="Close">×</button></h2>
      <div class="tools">${toolsHtml(this.core)}</div>
      <div class="settings">${this.floorHtml()}</div>
      <p class="note">${escapeHtml(tool.hint)}</p>
      <div class="settings">${this.core.settingsHtml()}</div>
      <p class="status" aria-live="polite">${escapeHtml(this.status)}</p>
      <h3>Edits in ${escapeHtml(this.listName)}
        ${historyHtml(this.log, this.busy)}</h3>
      ${draftsHtml(this.log, this.live, this.busy)}
      ${editListHtml(this.log)}
      ${this.bookmarksHtml()}
      ${this.checksHtml()}`;
    this.drawHitboxes();
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
