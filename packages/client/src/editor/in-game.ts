import type Phaser from 'phaser';
import { MAX_FLOORS, type Bookmark, type RegionMap, type TilePoint } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import type { WorldScene } from '../world-scene.ts';
import { CameraKeys } from './camera-keys.ts';
import { EditorCore, aimWords, type ToolId, type ToolStep } from './core.ts';
import { findables, type FindSources } from './find-sources.ts';
import { Finder } from './palette.ts';
import { keyAction } from './edit-keys.ts';
import { groupOf, groups, optionsHtml, railHtml, toolFor } from './rail.ts';
import { Ghost } from './ghost.ts';
import { LandControl } from './land-control.ts';
import { loadArt } from './art-index.ts';
import { pickFor } from './asset-picker.ts';
import { takeShot } from './land-panel.ts';
import { WorldMarks } from './marks.ts';
import { PlanView } from './plan-view.ts';
import { keysSheet, keysSheetHtml } from './keys-sheet.ts';
import { PanelSize } from './panel-size.ts';
import { Cameras, type CameraId } from './cameras.ts';
import { Editing } from './editing.ts';
import { barHtml, chooseSky, stripHtml, type SkyChoice } from './shell.ts';
import { OUTLINE_DEPTH, hearWorld, strokeOutlines, type PointerKind } from './world-input.ts';

// The world editor in the game, for the Owner and Stewards: an edit mode
// that takes over the screen. The game's HUD steps back (the page's
// `editing` class), a top bar and a status strip frame the world
// (shell.ts), and the panel on the right holds the tool's settings, what
// Select picked (inspector.ts) or, with nothing picked, the land itself
// (land-panel.ts). Two cameras look at the world (Tab switches): World, the
// game's own isometric view with a free camera, and Plan, any land seen from
// above (plan-view.ts); the tools, inspector, panel and drafts are the same
// in both, from the editor core (core.ts). Each change goes
// to the server, which saves it, lays the land out again everywhere and
// shows it to everyone there (or to editors only, while it is a draft); undo
// takes it back. The outlines and marks it draws over the world are the
// editor's own, seen only while it is open, never game art.

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
  private status = '';
  /** What is under the pointer, in a few words. */
  private here = '';
  private outline?: Phaser.GameObjects.Graphics;
  private readonly marks = new WorldMarks();
  private attached?: WorldScene;
  /** The hour and weather the editor shows the land in ('' and none: as they are). */
  private readonly sky: SkyChoice = { hour: '' };
  /** The floor the editor works on and shows, or undefined for the one we stand on. */
  private floor?: number;
  private readonly panKeys = new CameraKeys();
  private readonly rail = part('editor-rail', 'nav');
  private readonly optionsBar = part('editor-options', 'div');
  private readonly finder: Finder;
  /** The sheet of keys (?). */
  private readonly keysSheet = keysSheet();
  /** The drafts menu was used: it folds away when the bar is drawn again. */
  private foldMenu = false;
  /** The tool last used in each group, so a group's key brings it back. */
  private readonly lastTool: Partial<Record<string, ToolId>> = {};
  private readonly ghost = new Ghost();
  private readonly land: LandControl;
  private readonly plan: PlanView;
  private readonly cameras: Cameras;
  private readonly edits: Editing;

  constructor(private readonly options: EditorOptions) {
    this.land = new LandControl({
      core: this.core,
      token: this.options.token,
      scene: () => this.attached,
      open: () => this.open,
      region: () => this.edits.region,
      map: (region) => this.mapOf(region),
      log: () => this.edits.log,
      levelIn: (region) => this.levelIn(region),
      middle: () => this.cameras.middle(),
      lookAt: (x, y, level) => this.cameras.lookAt(x, y, level),
      showPlan: (region) => this.chooseCamera('plan', region),
      reload: () => this.edits.reload(),
      marked: () => this.plan.draw(),
      live: () => this.edits.live,
      render: (status) => this.render(status),
      send: (edit, region) => this.edits.act({ edit, live: this.edits.live }, region),
      step: (step) => this.step(step),
    });
    this.plan = new PlanView({
      core: this.core,
      token: this.options.token,
      floor: (region) => this.levelIn(region),
      marks: () => ({ steps: this.land.steps(), problems: this.land.problems(), hovered: this.land.hovered }),
      shown: (view) => {
        this.edits.shown(view);
        this.land.biomes = view.workshopBiomes;
        this.render();
      },
      step: (step) => this.step(step),
      readOut: (words) => this.readOut(words),
      say: (words) => this.render(words),
    });
    this.cameras = new Cameras({
      scene: () => this.attached,
      ourLand: () => this.options.region().id,
      listed: () => this.edits.region,
      levelIn: (region) => this.levelIn(region),
      chooseFloor: (level) => this.chooseFloor(level),
      followUs: () => {
        this.edits.follow();
        void this.edits.reload();
      },
      teleport: this.options.teleport,
      say: (words) => this.render(words),
    }, this.plan);
    this.edits = new Editing({
      token: this.options.token,
      scene: () => this.attached,
      open: () => this.open,
      ourLand: () => this.options.region(),
      nameOf: (region) => this.nameOf(region),
      plan: this.plan,
      changed: () => this.land.checkSoon(),
      render: (status) => this.render(status),
    });
    this.box.classList.add('edit-mode');
    this.box.append(this.bar, this.rail, this.optionsBar, this.plan.el, this.panel, new PanelSize(this.box).grip, this.strip, this.keysSheet);
    this.finder = new Finder(this.box);
    this.box.addEventListener('click', (event) => void this.clicked(event));
    this.box.addEventListener('change', (event) => this.changed(event));
    this.box.addEventListener('submit', (event) => {
      event.preventDefault();
      this.land.submit(event.target as HTMLFormElement);
    });
    this.box.addEventListener('input', (event) => this.land.input(event.target as HTMLInputElement));
    // A fold's toggle does not bubble: listen on the way down.
    this.box.addEventListener('toggle', (event) => {
      const fold = event.target as HTMLDetailsElement;
      if (fold.dataset?.section) this.core.inspector.toggled(fold.dataset.section, fold.open);
    }, true);
    // Hovering a change outlines it in the world.
    this.panel.addEventListener('mouseover', (event) => this.land.hover((event.target as HTMLElement).closest<HTMLElement>('[data-edit]')?.dataset.edit));
    this.panel.addEventListener('mouseleave', () => this.land.hover(undefined));
    document.addEventListener('keydown', (event) => this.key(event));
  }

  private key(event: KeyboardEvent): void {
    if (!this.open || (event.target as HTMLElement).closest?.('input, textarea, select')) return;
    if (this.panKeys.down(event)) return event.preventDefault();
    const action = keyAction(event, this.core, this.lastTool);
    if (!action) return;
    // Group letters and Esc keep their usual meaning nowhere else on the page; the rest would.
    if (!('tool' in action || 'escape' in action)) event.preventDefault();
    if (!this.keysSheet.hidden && ('escape' in action || 'keys' in action)) return this.showKeys(false);
    if ('keys' in action) this.showKeys(true);
    else if ('find' in action) this.finder.show(findables(this.finding()), (words) => void this.land.ask(words));
    else if ('camera' in action) this.chooseCamera(this.cameras.other());
    else if ('pick' in action) void this.step(this.core.pickAction(action.pick));
    else if ('tool' in action) this.chooseTool(action.tool);
    else if ('turn' in action) this.render(`Side: ${this.core.turn(action.turn)}.`);
    else if ('home' in action) this.cameras.home();
    else if ('zoom' in action) this.cameras.zoom(action.zoom);
    else if ('bookmark' in action) void this.land.bookmarkView();
    else if ('undo' in action) void this.edits.act({ undo: true });
    else if ('redo' in action) void this.edits.act({ redo: true });
    // Esc drops what a tool is part way through first, then closes the editor.
    else if (this.core.midway()) {
      this.core.cancel();
      this.render('');
    } else this.toggle(false);
  }

  /** Opens or closes the editor, through a camera when one is named. */
  toggle(open = !this.open, camera?: CameraId): void {
    this.open = open;
    if (camera) this.cameras.id = camera;
    this.box.hidden = !open;
    document.body.classList.toggle('editing', open);
    if (!open) document.body.classList.remove('editing-chat', 'editing-plan');
    this.core.cancel();
    this.panKeys.clear();
    this.finder.close();
    this.keysSheet.hidden = true;
    this.attached?.freeCamera(open);
    if (!open) {
      this.outline?.clear();
      this.marks.clear();
      this.land.clear();
      this.ghost.hide();
      this.plan.hide();
      this.attached?.viewFloor(undefined);
      this.attached?.previewEdits(this.edits.region);
      this.attached?.previewSky({});
      return;
    }
    this.attach();
    this.attached?.freeCamera(true);
    this.edits.follow();
    this.render();
    void this.edits.reload();
    if (this.cameras.id === 'plan') void this.plan.show(this.edits.region);
    // The pictures on the asset buttons show once the art is known.
    void loadArt().then(() => this.render());
  }

  /** Looks through the World or the Plan camera; the Plan shows the land named, or the one listed. */
  private chooseCamera(camera: CameraId, region?: string): void {
    this.core.cancel();
    this.ghost.hide();
    this.cameras.choose(camera, region);
    this.render('');
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
        ['Publish the drafts', () => void this.edits.act({ publish: true })],
        ['Throw the drafts away', () => void this.edits.act({ discard: true })],
        ['Undo', () => void this.edits.act({ undo: true })],
        ['Redo', () => void this.edits.act({ redo: true })],
        ['Back to me', () => this.cameras.home()],
        ['Bring me here', () => this.cameras.bringMe()],
        ['Check this land', () => this.land.check()],
        [this.plan.open ? 'World camera: see it as players do' : 'Plan camera: any land from above', () => this.chooseCamera(this.cameras.other())],
        ['Ask the Architect', () => this.askTab()],
        ['Show the keys', () => this.showKeys(true)],
        ['Take a shot here', () => this.attached && takeShot(this.attached, this.options.region().id, (w) => this.render(w))],
        ['Zoom in', () => this.cameras.zoom(1)],
        ['Zoom out', () => this.cameras.zoom(-1)],
        ['Done: close the editor', () => this.toggle(false)],
      ],
    };
  }

  /** The mini map was clicked at a tile of the land we are in: the camera goes there. False when the editor is closed. */
  jumpTo(x: number, y: number): boolean {
    return this.open && this.cameras.jumpTo(x, y);
  }

  /** Shows or hides the sheet of keys. */
  private showKeys(show: boolean): void {
    if (show) this.keysSheet.innerHTML = keysSheetHtml(this.core);
    this.keysSheet.hidden = !show;
  }

  /** The panel shows the Architect, with nothing picked. */
  private askTab(): void {
    this.chooseTool('select');
    this.core.inspector.picked = undefined;
    this.land.show('architect');
    this.panel.querySelector<HTMLTextAreaElement>('#architect-form textarea')?.focus();
  }

  /** We walked into another land: the list follows us, unless we were editing elsewhere just now (or look at a plan). */
  regionChanged(): void {
    if (!this.open || this.plan.open || this.edits.region === this.options.region().id) return;
    this.edits.follow();
    void this.edits.reload();
  }

  /** Listens to the pointer over the world, once the scene is running. */
  private attach(): void {
    const scene = this.options.scene();
    if (!scene || this.attached === scene || !scene.sys.isActive()) return;
    this.attached = scene;
    this.outline = scene.add.graphics().setDepth(OUTLINE_DEPTH);
    this.land.attach(scene, this.outline);
    this.marks.attach(scene, OUTLINE_DEPTH);
    // A scene started while the editor is open (a new land laid out, a reconnect) gets the editor's camera and floor too.
    if (this.open) {
      scene.freeCamera(true);
      scene.viewFloor(this.floor);
    }
    hearWorld(scene, {
      open: () => this.open,
      zoom: (d) => this.cameras.zoom(d),
      pointer: (p, kind) => this.pointer(p, kind),
      // The pan keys move the camera (or scroll the plan); moving it (or the floor shown changing) moves what the marks are drawn around.
      frame: (delta) => {
        this.cameras.pan(...this.panKeys.step(delta));
        if (this.marks.stale(scene)) this.drawMarks();
      },
    });
  }

  private pointer(p: Phaser.Input.Pointer, kind: PointerKind): void {
    const scene = this.attached;
    if (!this.open || !scene || this.plan.open) return;
    if (kind === 'up') return void this.step(this.core.release());
    const at = scene.tileAt(p.x, p.y);
    if (!at) {
      this.outline?.clear();
      this.ghost.hide();
      return this.readOut('');
    }
    const spot: TilePoint = [at.x, at.y];
    const level = this.levelIn(at.region);
    if (kind === 'down' && !this.edits.busy) void this.step(this.core.press(at.region, at.map, spot, level));
    else if (kind === 'drag') this.core.drag(at.region, at.map, spot);
    // A making tool shows what it would make here, and whether it fits, before anything is sent.
    const aim = kind === 'hover' ? this.core.aimAt(at.map, spot, level) : undefined;
    const outlines = this.core.outlines(at.region, at.map, spot, level).map((o) => (aim?.problem && o.tone !== 'held' ? { ...o, tone: 'warn' as const } : o));
    strokeOutlines(this.outline, scene, at.map, outlines);
    const box = outlines.at(-1);
    if (aim && box) this.ghost.show(scene, at.map, box, aim.art, aim.character);
    else this.ghost.hide();
    this.readOut(aimWords(aim, at.map, spot, level));
  }

  /** Says what is under the pointer in the status strip, without drawing the rest again. */
  private readOut(words: string): void {
    if (words === this.here) return;
    this.here = words;
    const here = this.strip.querySelector('.here');
    if (here) here.textContent = words || 'Point at the world';
  }

  private step(step: ToolStep): Promise<void> {
    return this.edits.step(step, this.core.holding());
  }

  /** The floor chosen (or the one we stand on), in our own land and the land the plan shows; the ground in the lands drawn around it. */
  private levelIn(region: string): number {
    const own = region === this.options.region().id;
    if (this.plan.open && region === this.plan.view?.region) return this.floor ?? (own ? this.attached?.currentFloor ?? 0 : 0);
    return own ? this.shownFloor() : 0;
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
    this.plan.draw();
  }

  /** Shows the land at another hour or in other weather, on this screen only (players see the sky as it is). */
  private chooseSky(hour?: string, weather?: string): void {
    this.attached?.previewSky(chooseSky(this.sky, hour, weather));
  }

  private bookmarks(): Bookmark[] {
    return this.mapOf(this.edits.region)?.bookmarks ?? [];
  }

  /** A land's map: the plan's while the Plan camera shows it, else the one drawn around us. */
  private mapOf(region: string): RegionMap | undefined {
    const planned = this.plan.view?.region === region ? this.plan.view.map : undefined;
    return (this.plan.open && planned) || this.attached?.landMap(region) || planned;
  }

  /** A land's name, from the plan's land menu or the ones drawn around us. */
  private nameOf(region: string): string {
    return this.plan.view?.regions.find((r) => r.id === region)?.name ?? this.attached?.landName(region) ?? 'that land';
  }

  /** Draws the hitboxes and tile wireframe around the player, as they are switched. */
  private drawMarks(): void {
    if (this.attached) this.marks.draw(this.attached, this.open);
  }

  private async clicked(event: Event): Promise<void> {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    const d = button.dataset;
    if (d.done !== undefined) return this.toggle(false);
    if (d.keys !== undefined || d.keysClose !== undefined) return this.showKeys(d.keys !== undefined && this.keysSheet.hidden);
    if (d.camera) return this.chooseCamera(d.camera === 'plan' ? 'plan' : 'world');
    if (d.chat !== undefined) {
      document.body.classList.toggle('editing-chat');
      return this.render();
    }
    if (d.floorStep) return this.chooseFloor(this.shownFloor() + Number(d.floorStep));
    if (d.floorMine !== undefined) return this.chooseFloor(undefined);
    if (d.me !== undefined) return this.cameras.home();
    if (d.bring !== undefined) return this.cameras.bringMe();
    if (d.tool) return this.chooseTool(d.tool as ToolId);
    if (d.group) {
      const group = groups(this.core).find((g) => g.id === d.group);
      if (group) this.chooseTool(toolFor(this.core, group, this.lastTool, false));
      return;
    }
    if (d.undo !== undefined) return this.edits.act({ undo: true });
    if (d.redo !== undefined) return this.edits.act({ redo: true });
    if (d.remove) return this.edits.act({ remove: d.remove });
    if (d.publish !== undefined) return this.edits.act({ publish: true });
    if (d.discard !== undefined) {
      this.foldMenu = true;
      return this.edits.act({ discard: true });
    }
    if (d.away !== undefined) return this.step(this.core.takeAway(this.levelIn(this.edits.region)));
    if (d.pick) return this.step(this.core.pickAction(d.pick));
    if (d.assetField) return void pickFor(this.core, d.assetField, this.mapOf(this.edits.region), () => this.render());
    if (d.area) return this.step(this.core.areaAction(d.area, d.value));
    if (d.shot !== undefined) return this.attached ? takeShot(this.attached, this.options.region().id, (w) => this.render(w)) : this.render('The game is not running yet.');
    if (d.go !== undefined) return this.goTo(Number(d.go));
    this.land.click(d);
  }

  /** Goes to one of the land's bookmarks, the camera following. */
  private goTo(index: number): void {
    const mark = this.bookmarks()[index];
    if (!mark) return;
    this.chooseFloor(undefined);
    this.options.teleport?.({ region: this.edits.region, x: mark.x, y: mark.y, floor: mark.floor });
    this.attached?.followMe();
    this.render(`Going to ${mark.name}.`);
  }

  private changed(event: Event): void {
    const input = event.target as HTMLInputElement;
    // The plan's own bar is the plan's.
    if (input.closest('.plan-bar')) return;
    if (this.marks.set(input.name, input.checked)) this.drawMarks();
    else if (input.name === 'view-floor') this.chooseFloor(Number(input.value));
    else if (input.name === 'view-hour') this.chooseSky(input.value);
    else if (this.land.input(input) || this.land.change(input)) return;
    else if (input.name === 'view-weather') this.chooseSky(undefined, input.value);
    else if (input.name === 'live') {
      this.edits.live = input.checked;
      this.foldMenu = true;
      this.render();
    } else if (this.core.set(input.name, input.value, input.checked) && this.core.redraws(input.name)) this.render();
    // Hand the keys back to walking.
    input.blur();
  }

  /** With nothing selected (and no other tool), the panel shows the land itself. */
  private landShown(): boolean {
    return this.core.current().id === 'select' && !this.core.inspector.picked;
  }

  private render(status?: string): void {
    if (status !== undefined) this.status = status;
    if (!this.open) return;
    // The game may not have been running yet when the editor opened.
    this.attach();
    const tool = this.core.current();
    this.rail.innerHTML = railHtml(this.core);
    this.optionsBar.innerHTML = optionsHtml(this.core);
    // The drafts menu stays open while the bar is drawn again (after a change, a check), until it is used.
    const menuOpen = !this.foldMenu && !!this.bar.querySelector<HTMLDetailsElement>('.publish-menu')?.open;
    this.foldMenu = false;
    this.bar.innerHTML = barHtml({
      land: this.edits.name, floor: this.levelIn(this.edits.region), floorChosen: this.floor !== undefined, sky: this.sky, camera: this.cameras.id,
      showGrid: this.marks.show.grid, showHitboxes: this.marks.show.hitboxes, list: this.edits.log, live: this.edits.live, busy: this.edits.busy, menuOpen,
    });
    this.panel.innerHTML = `
      <p class="small-screen note">The world editor needs a bigger screen than this. Open it on a computer or a tablet held sideways.</p>
      <p class="note">${escapeHtml(tool.hint)}</p>
      ${this.landShown() ? `<h3>${escapeHtml(this.edits.name)}</h3>${this.land.html(this.bookmarks())}` : `<div class="settings">${this.core.settingsHtml()}</div>`}`;
    this.strip.innerHTML = stripHtml({ here: this.here, status: this.status, list: this.edits.log, busy: this.edits.busy, chatOpen: document.body.classList.contains('editing-chat') });
    document.body.classList.toggle('editing-plan', this.plan.open);
    // The bar wraps on a narrow screen: what hangs below it moves down with it.
    this.box.style.setProperty('--editor-top', `${this.bar.offsetHeight}px`);
    this.drawMarks();
    this.plan.draw();
  }
}

/** One part of the edit mode's frame, made once and filled on each render. */
function part(className: string, tag: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

