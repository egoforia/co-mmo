import Phaser from 'phaser';
import { MAX_FLOORS, type Bookmark, type Outline, type TilePoint, type Weather } from '@co-mmo/shared';
import { worldEdits, type EditLog } from '../api.ts';
import { escapeHtml } from '../ui.ts';
import type { WorldScene } from '../world-scene.ts';
import { CameraKeys } from './camera-keys.ts';
import { EditorCore, editListHtml, hereWords, type ToolId, type ToolStep } from './core.ts';
import { findables, type FindSources } from './find-sources.ts';
import { Finder } from './palette.ts';
import { groupOf, groups, optionsHtml, railHtml, toolFor } from './rail.ts';
import { bookmarksHtml, checkLand, checksHtml, problemCount, takeShot, type LandCheck } from './land-panel.ts';
import { drawMarks, marksKey } from './marks.ts';
import { PREVIEW_HOURS, PREVIEW_WEATHER, barHtml, stripHtml } from './shell.ts';

/** Where the tile wireframe switch is remembered, on this browser only. */
const GRID_KEY = 'co-mmo.editor.tileGrid';

// The world editor in the game, for the Owner and Stewards: an edit mode
// that takes over the screen. The game's HUD steps back (the page's
// `editing` class), a top bar and a status strip frame the world
// (shell.ts), and the panel on the right holds the tools, their settings and
// the land's edits. The tools, their settings and what they make come from
// the editor core (core.ts), the same as the Studio's map. Each change goes
// to the server, which saves it, lays the land out again everywhere and
// shows it to everyone there (or to editors only, while it is a draft); undo
// takes it back. The outlines and marks it draws over the world are the
// editor's own, seen only while it is open, never game art.

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

/** The world editor's edit mode and its pointer tools. */
export class EditorUi {
  private readonly box = document.getElementById('editor')!;
  private readonly bar = part('editor-bar', 'header');
  private readonly panel = part('editor-panel', 'section');
  private readonly strip = part('editor-strip', 'footer');
  private readonly core = new EditorCore();
  private open = false;
  /** The land whose edits the list shows: the one last edited, or the one we are in. */
  private listRegion = '';
  private listName = '';
  private log: EditLog = { edits: [], undone: 0 };
  private busy = false;
  private status = '';
  /** What is under the pointer, in a few words. */
  private here = '';
  private outline?: Phaser.GameObjects.Graphics;
  private hitboxGraphics?: Phaser.GameObjects.Graphics;
  private gridGraphics?: Phaser.GameObjects.Graphics;
  /** Hitboxes start off: their fill hides the art being judged. */
  private showHitboxes = false;
  private showGrid = readGrid();
  /** Where the marks were last drawn around, so walking redraws them only on a new tile. */
  private drawnAt = '';
  private attached?: WorldScene;
  /** The hour and weather the editor shows the land in ('' and none: as they are). */
  private readonly sky: { hour: string; weather?: Weather } = { hour: '' };
  /** The floor the editor works on and shows, or undefined for the one we stand on. */
  private floor?: number;
  /** What the last check of a land found, shown while the list shows that land. */
  private checks?: LandCheck;
  /** Whether the bookmarks list is unfolded, kept as the window is drawn again. */
  private marksOpen = false;
  /** New edits go live at once instead of waiting as drafts. */
  private live = false;
  private readonly panKeys = new CameraKeys();
  private readonly rail = part('editor-rail', 'nav');
  private readonly optionsBar = part('editor-options', 'div');
  private readonly finder: Finder;
  /** The tool last used in each group, so a group's key brings it back. */
  private readonly lastTool: Partial<Record<string, ToolId>> = {};

  constructor(private readonly options: EditorOptions) {
    this.box.classList.add('edit-mode');
    this.box.append(this.bar, this.rail, this.optionsBar, this.panel, this.strip);
    this.finder = new Finder(this.box);
    this.box.addEventListener('click', (event) => void this.clicked(event));
    this.box.addEventListener('change', (event) => this.changed(event));
    // A fold's toggle does not bubble: listen on the way down.
    this.box.addEventListener('toggle', (event) => {
      const fold = event.target as HTMLDetailsElement;
      if (fold.classList?.contains('bookmarks-box')) this.marksOpen = fold.open;
    }, true);
    document.addEventListener('keydown', (event) => this.key(event));
  }

  private key(event: KeyboardEvent): void {
    if (!this.open || (event.target as HTMLElement).closest?.('input, textarea, select')) return;
    const key = event.key.toLowerCase();
    if (this.panKeys.down(event)) return event.preventDefault();
    const plain = !(event.ctrlKey || event.metaKey || event.altKey);
    if ((key === 'k' && (event.ctrlKey || event.metaKey)) || (key === '/' && plain)) {
      event.preventDefault();
      return this.finder.show(findables(this.finding()));
    }
    const group = plain && groups(this.core).find((g) => g.key === key);
    if (group) return this.chooseTool(toolFor(this.core, group, this.lastTool, groupOf(this.core, this.core.current().id)?.id === group.id));
    if (key === 'home') return this.backToMe();
    if ((key === '+' || key === '=' || key === '-') && !(event.ctrlKey || event.metaKey)) return this.zoom(key === '-' ? -1 : 1);
    if (key === 'escape') {
      // Esc drops what a tool is part way through first, then closes the editor.
      if (this.core.midway()) {
        this.core.cancel();
        this.render('');
      } else this.toggle(false);
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    if (key === 'z' && !event.shiftKey) void this.act({ undo: true });
    else if (key === 'y' || (key === 'z' && event.shiftKey)) void this.act({ redo: true });
    else return;
    event.preventDefault();
  }

  /** Opens or closes the editor. */
  toggle(open = !this.open): void {
    this.open = open;
    this.box.hidden = !open;
    document.body.classList.toggle('editing', open);
    if (!open) document.body.classList.remove('editing-chat');
    this.core.cancel();
    this.panKeys.clear();
    this.finder.close();
    this.attached?.freeCamera(open);
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
    this.attached?.freeCamera(true);
    this.follow();
    this.render();
    void this.reload();
  }

  /** Chooses a tool, remembering it as its group's last. */
  private chooseTool(tool: ToolId): void {
    this.core.choose(tool);
    const group = groupOf(this.core, this.core.current().id);
    if (group) this.lastTool[group.id] = this.core.current().id;
    this.render('');
  }

  /** What the finder can find now: every tool, this land's bookmarks, and the editor's actions. */
  private finding(): FindSources {
    return {
      core: this.core,
      bookmarks: this.bookmarks(),
      tool: (t) => this.chooseTool(t),
      go: (i) => this.goTo(i),
      actions: [
        ['Publish the drafts', () => void this.act({ publish: true })],
        ['Throw the drafts away', () => void this.act({ discard: true })],
        ['Undo', () => void this.act({ undo: true })],
        ['Redo', () => void this.act({ redo: true })],
        ['Back to me', () => this.backToMe()],
        ['Bring me here', () => this.bringMe()],
        ['Check this land', () => this.check()],
        ['Take a shot here', () => this.attached && takeShot(this.attached, this.options.region().id, (w) => this.render(w))],
        ['Zoom in', () => this.zoom(1)],
        ['Zoom out', () => this.zoom(-1)],
        ['Done: close the editor', () => this.toggle(false)],
      ],
    };
  }

  /** The mini map was clicked at a tile of the land we are in: the camera goes there. False when the editor is closed. */
  jumpTo(x: number, y: number): boolean {
    const scene = this.attached;
    if (!this.open || !scene?.currentMap) return false;
    scene.lookAt(scene.currentMap, x - 0.5, y - 0.5);
    return true;
  }

  /** The camera goes back to the player and follows them until it is moved again. */
  private backToMe(): void {
    this.attached?.followMe();
    this.render('Back to you.');
  }

  /** Zooms the camera a step in or out. */
  private zoom(direction: 1 | -1): void {
    const share = this.attached?.zoomCamera(direction);
    if (share !== undefined) this.render(`Zoom ${Math.round(share * 100)}%.`);
  }

  /** Brings the player to the middle of the screen, on the floor shown (the server moves them to open ground nearby if need be). */
  private bringMe(): void {
    const at = this.attached?.cameraTile();
    if (!at) return this.render('There is no land in the middle of the screen.');
    this.options.teleport?.({ region: at.region, x: at.x + 0.5, y: at.y + 0.5, floor: this.levelIn(at.region) });
    this.attached?.followMe();
    this.render('Bringing you here.');
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
    // The pan keys move the camera; moving it (or the floor shown changing) moves what the marks are drawn around.
    scene.events.on('update', (_time: number, delta: number) => {
      if (!this.open) return;
      scene.panCamera(...this.panKeys.step(delta));
      if (marksKey(scene) !== this.drawnAt) this.drawMarks();
    });
    // The wheel zooms; dragging with the right or middle button pans.
    scene.input.mouse?.disableContextMenu();
    scene.input.on('wheel', (_p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (this.open && dy) this.zoom(dy > 0 ? -1 : 1);
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.open && (p.rightButtonDown() || p.middleButtonDown())) return scene.panCamera(p.prevPosition.x - p.x, p.prevPosition.y - p.y);
      this.pointer(p, p.isDown ? 'drag' : 'hover');
    });
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.pointer(p, 'down');
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointer(p, 'up'));
  }

  private pointer(p: Phaser.Input.Pointer, kind: 'hover' | 'down' | 'drag' | 'up'): void {
    const scene = this.attached;
    if (!this.open || !scene) return;
    if (kind === 'up') return void this.step(this.core.release());
    const at = scene.tileAt(p.x, p.y);
    if (!at) {
      this.outline?.clear();
      return this.readOut('');
    }
    const spot: TilePoint = [at.x, at.y];
    const level = this.levelIn(at.region);
    this.readOut(hereWords(at.map, spot, level));
    if (kind === 'down' && !this.busy) void this.step(this.core.press(at.region, at.map, spot, level));
    else if (kind === 'drag') this.core.drag(at.region, at.map, spot);
    this.outline?.clear();
    for (const o of this.core.outlines(at.region, at.map, spot, level)) {
      this.outline?.lineStyle(2, TONES[o.tone ?? 'aim'], 0.95);
      this.outline?.strokePoints(scene.tileCorners(at.map, o.x, o.y, o.w, o.h), true);
    }
  }

  /** Says what is under the pointer in the status strip, without drawing the rest again. */
  private readOut(words: string): void {
    if (words === this.here) return;
    this.here = words;
    const here = this.strip.querySelector('.here');
    if (here) here.textContent = words || 'Point at the world';
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
    return region === this.options.region().id ? this.shownFloor() : 0;
  }

  /** The floor the editor shows: the one chosen, or the one we stand on. */
  private shownFloor(): number {
    return this.floor ?? this.attached?.currentFloor ?? 0;
  }

  /** The editor works on and shows another floor, or the one we stand on again (undefined). */
  private chooseFloor(floor: number | undefined): void {
    this.floor = floor === undefined ? undefined : Math.max(-MAX_FLOORS.down, Math.min(MAX_FLOORS.up, floor));
    this.core.cancel();
    this.attached?.viewFloor(this.floor);
    this.render('');
  }

  /** Shows the land at another hour or in other weather, on this screen only (players see the sky as it is). */
  private chooseSky(hour?: string, weather?: string): void {
    if (hour !== undefined) this.sky.hour = Object.hasOwn(PREVIEW_HOURS, hour) ? hour : '';
    if (weather !== undefined) this.sky.weather = (PREVIEW_WEATHER as string[]).includes(weather) && weather ? (weather as Weather) : undefined;
    this.attached?.previewSky({ ...(PREVIEW_HOURS[this.sky.hour]?.phase !== undefined ? { phase: PREVIEW_HOURS[this.sky.hour]!.phase } : {}), ...(this.sky.weather ? { weather: this.sky.weather } : {}) });
  }

  /** Checks the land the list shows: shapes, walks, and pictures not painted yet. */
  private check(): void {
    const found = this.attached && checkLand(this.attached, this.listRegion);
    if (!found) return this.render('That land is not in sight to check.');
    this.checks = found;
    this.render(problemCount(found) ? 'Checked. See what turned up in the panel.' : 'Checked. All is well here.');
  }

  private bookmarks(): Bookmark[] {
    return this.attached?.landMap(this.listRegion)?.bookmarks ?? [];
  }

  /** A land's name, from the ones drawn around us. */
  private nameOf(region: string): string {
    return this.attached?.landName(region) ?? 'that land';
  }

  /** Draws the hitboxes and tile wireframe around the player, as they are switched. */
  private drawMarks(): void {
    const scene = this.attached;
    if (!scene || !this.hitboxGraphics || !this.gridGraphics) return;
    this.drawnAt = marksKey(scene);
    if (!this.open) return;
    drawMarks(scene, this.hitboxGraphics, this.gridGraphics, { hitboxes: this.showHitboxes, grid: this.showGrid });
  }

  private async clicked(event: Event): Promise<void> {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    const d = button.dataset;
    if (d.done !== undefined) return this.toggle(false);
    if (d.chat !== undefined) {
      document.body.classList.toggle('editing-chat');
      return this.render();
    }
    if (d.floorStep) return this.chooseFloor(this.shownFloor() + Number(d.floorStep));
    if (d.floorMine !== undefined) return this.chooseFloor(undefined);
    if (d.me !== undefined) return this.backToMe();
    if (d.bring !== undefined) return this.bringMe();
    if (d.tool) return this.chooseTool(d.tool as ToolId);
    if (d.group) {
      const group = groups(this.core).find((g) => g.id === d.group);
      if (group) this.chooseTool(toolFor(this.core, group, this.lastTool, false));
      return;
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
    if (d.shot !== undefined) return this.attached ? takeShot(this.attached, this.options.region().id, (w) => this.render(w)) : this.render('The game is not running yet.');
    if (d.go !== undefined) this.goTo(Number(d.go));
  }

  /** Goes to one of the land's bookmarks, the camera following. */
  private goTo(index: number): void {
    const mark = this.bookmarks()[index];
    if (!mark) return;
    this.chooseFloor(undefined);
    this.options.teleport?.({ region: this.listRegion, x: mark.x, y: mark.y, floor: mark.floor });
    this.attached?.followMe();
    this.render(`Going to ${mark.name}.`);
  }

  private changed(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.name === 'hitboxes') {
      this.showHitboxes = input.checked;
      this.drawMarks();
    } else if (input.name === 'tile-grid') {
      this.showGrid = input.checked;
      try {
        localStorage.setItem(GRID_KEY, input.checked ? '1' : '0');
      } catch {
        // No storage here: the switch still works until the page is reloaded.
      }
      this.drawMarks();
    } else if (input.name === 'view-floor') this.chooseFloor(Number(input.value));
    else if (input.name === 'view-hour') this.chooseSky(input.value);
    else if (input.name === 'view-weather') this.chooseSky(undefined, input.value);
    else if (input.name === 'live') {
      this.live = input.checked;
      this.render();
    } else if (this.core.set(input.name, input.value, input.checked) && this.core.hasNotes()) this.render();
    // Hand the keys back to walking.
    input.blur();
  }

  private render(status?: string): void {
    if (status !== undefined) this.status = status;
    if (!this.open) return;
    // The game may not have been running yet when the editor opened.
    this.attach();
    const tool = this.core.current();
    this.rail.innerHTML = railHtml(this.core);
    this.optionsBar.innerHTML = optionsHtml(this.core);
    this.bar.innerHTML = barHtml({
      land: this.listName, floor: this.shownFloor(), floorChosen: this.floor !== undefined, sky: this.sky,
      showGrid: this.showGrid, showHitboxes: this.showHitboxes, list: this.log, live: this.live, busy: this.busy,
    });
    this.panel.innerHTML = `
      <p class="small-screen note">The world editor needs a bigger screen than this. Open it on a computer or a tablet held sideways.</p>
      <p class="note">${escapeHtml(tool.hint)}</p>
      <div class="settings">${this.core.settingsHtml()}</div>
      <h3>Edits in ${escapeHtml(this.listName)}</h3>
      ${editListHtml(this.log)}
      ${bookmarksHtml(this.bookmarks(), this.marksOpen)}
      ${checksHtml(this.checks, this.listRegion)}`;
    this.strip.innerHTML = stripHtml({ here: this.here, status: this.status, list: this.log, busy: this.busy, chatOpen: document.body.classList.contains('editing-chat') });
    this.drawMarks();
  }
}

/** One part of the edit mode's frame, made once and filled on each render. */
function part(className: string, tag: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

/** Whether the tile wireframe was left on in this browser (off when nothing was saved). */
function readGrid(): boolean {
  try {
    return localStorage.getItem(GRID_KEY) === '1';
  } catch {
    return false;
  }
}
