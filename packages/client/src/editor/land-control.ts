import type Phaser from 'phaser';
import { BOOKMARK_TEXT, type Bookmark, type Outline, type RegionMap, type WorldEdit, type WorldEditDraft } from '@co-mmo/shared';
import type { EditLog } from '../api.ts';
import type { WorldScene } from '../world-scene.ts';
import { architectHtml, askArchitect, emptyArchitect, makeSteps, ticked } from './architect.ts';
import { pictureFile } from './art-index.ts';
import { editBox } from './changes.ts';
import type { EditorCore, ToolStep } from './core.ts';
import { checkLand, landPanelHtml, problemCount, problemTiles, type LandCheck, type LandTab } from './land-panel.ts';
import { landsHtml, layFile, makeLand, readLand, saveEdits } from './lands-io.ts';
import { OUTLINE_DEPTH, strokeOutlines } from './world-input.ts';

// What the editor does with its land panel (land-panel.ts), in either
// camera: the tab chosen, the Changes filter, hovering and going to a
// change, Bookmark this view, the land's settings, the checks run again
// after each change with red marks where they found something, the AI Map
// Architect's steps (marked on the land before anything changes), and
// workshop lands and files. in-game.ts hands it the clicks, inputs and
// forms it does not know, and draws what it returns.

/** How long after a change the land is checked again, so the land laid again has reached this screen. */
const CHECK_AFTER_MS = 1500;

/** What the land panel needs from the editor around it. */
export interface LandHost {
  core: EditorCore;
  token: string;
  scene(): WorldScene | undefined;
  open(): boolean;
  /** The land the panel shows, its map (drawn around us, or read for the Plan camera), and its edits. */
  region(): string;
  map(region: string): RegionMap | undefined;
  log(): EditLog;
  /** The floor shown in a land. */
  levelIn(region: string): number;
  /** The tile in the middle of the camera's view. */
  middle(): { region: string; x: number; y: number } | undefined;
  /** The camera goes to a tile of the land shown, on its floor. */
  lookAt(x: number, y: number, level: number): void;
  /** The Plan camera shows a land (the one shown when none is named). */
  showPlan(region?: string): void;
  /** Reads the land's edits (and the plan) again, after a change made here. */
  reload(): Promise<void>;
  /** Draws the marks again where the camera shows them. */
  marked(): void;
  live(): boolean;
  render(status?: string): void;
  send(edit: WorldEditDraft, region: string): Promise<void>;
  step(step: ToolStep): Promise<void>;
}

/** The land panel's state and actions. */
export class LandControl {
  tab: LandTab = 'changes';
  private filter = 'all';
  private viewName = '';
  private checks?: LandCheck;
  private timer?: ReturnType<typeof setTimeout>;
  private marks?: Phaser.GameObjects.Graphics;
  private outline?: Phaser.GameObjects.Graphics;
  private readonly architect = emptyArchitect();
  /** The land the Architect's steps are for. */
  private asked = '';
  /** The looks a new workshop land may take, once read. */
  biomes?: string[];
  /** The change hovered in the Changes tab. */
  hovered?: Outline;

  constructor(private readonly host: LandHost) {}

  /** Draws on a newly running scene: the red marks, and the outline a hovered change shares with the tools. */
  attach(scene: WorldScene, outline: Phaser.GameObjects.Graphics): void {
    this.marks = scene.add.graphics().setDepth(OUTLINE_DEPTH - 4);
    this.outline = outline;
  }

  /** The editor closed: its marks go. */
  clear(): void {
    clearTimeout(this.timer);
    this.marks?.clear();
  }

  html(marks: Bookmark[]): string {
    const region = this.host.region();
    if (this.tab === 'land' && !this.biomes) void this.readBiomes(region);
    return landPanelHtml({
      tab: this.tab, region, list: this.host.log(), map: this.host.map(region), filter: this.filter,
      marks, viewName: this.viewName, checks: this.checks, landForm: this.host.core.formHtml('land'),
      architect: architectHtml(this.architect), steps: this.steps().length, lands: this.biomes ? landsHtml(this.biomes) : '',
    });
  }

  /** The Architect's ticked steps for the land shown, to mark. */
  steps(): WorldEditDraft[] {
    return this.asked === this.host.region() ? ticked(this.architect) : [];
  }

  /** The places the last check of the land shown named. */
  problems(): [number, number][] {
    return this.checks?.region === this.host.region() ? problemTiles(this.checks) : [];
  }

  /** A button of the panel; false when it is not one of its own. */
  click(d: DOMStringMap): boolean {
    if (d.landTab) this.show(d.landTab as LandTab);
    else if (d.editGo) {
      const edit = this.host.log().edits.find((e) => e.id === d.editGo);
      const box = edit && editBox(edit);
      if (box) this.host.lookAt(box.x + box.w / 2, box.y + box.h / 2, box.level);
    } else if (d.builtGo) {
      const [x, y, level] = d.builtGo.split(',').map(Number);
      this.host.lookAt(x! + 0.5, y! + 0.5, level!);
    } else if (d.bookmarkView !== undefined) void this.bookmarkView();
    else if (d.landApply !== undefined) {
      const at = this.host.middle();
      if (at) void this.host.step(this.host.core.makeAt('land', at.region, [at.x, at.y], 0));
      else this.host.render('There is no land in the middle of the screen.');
    } else if (d.check !== undefined) this.check();
    else if (d.aiApply !== undefined) void this.make();
    else if (d.aiDiscard !== undefined) {
      Object.assign(this.architect, { summary: '', steps: [] });
      this.marked();
    } else if (d.landExport !== undefined) void this.saying(saveEdits(this.host.token, this.host.region()).then(() => 'Saved.'));
    else return false;
    return true;
  }

  /** Shows a tab of the panel. */
  show(tab: LandTab): void {
    this.tab = tab;
    this.host.render();
  }

  /** An input of the panel was typed in or changed; false when it is not one of its own. */
  input(input: HTMLInputElement): boolean {
    if (input.name === 'view-name') this.viewName = input.value.slice(0, BOOKMARK_TEXT.name);
    else if (input.name === 'changes-filter') {
      this.filter = input.value;
      this.host.render();
    } else return false;
    return true;
  }

  /** An input of the panel was changed (heard once, not as it is typed in); false when it is not one of its own. */
  change(input: HTMLInputElement): boolean {
    if (input.dataset.aiCheck !== undefined) {
      const step = this.architect.steps[Number(input.dataset.aiCheck)];
      if (step) step.checked = input.checked;
      this.marked();
    } else if (input.dataset.landImport !== undefined) {
      void this.saying(layFile(this.host.token, this.host.region(), input).then(async (said) => (await this.host.reload(), said)));
    } else return false;
    return true;
  }

  /** A form of the panel was sent; false when it is not one of its own. */
  submit(form: HTMLFormElement): boolean {
    if (form.id === 'architect-form') void this.ask(String(new FormData(form).get('prompt') ?? '').trim());
    else if (form.id === 'land-form') {
      void this.saying(makeLand(this.host.token, form).then((region) => (this.host.showPlan(region), 'Made. It is shown in the Plan camera.')));
    } else return false;
    return true;
  }

  /** Asks the Architect about the land shown; its steps are marked on the plan. */
  async ask(prompt: string): Promise<void> {
    if (!prompt || this.architect.busy) return;
    this.asked = this.host.region();
    this.tab = 'architect';
    const asking = askArchitect(this.architect, this.host.token, this.asked, prompt);
    this.host.render('The Architect is thinking…');
    await this.saying(asking.then(() => {
      this.host.showPlan(this.asked);
      const fit = this.steps().length;
      return `The Architect proposes ${this.architect.steps.length} step${this.architect.steps.length === 1 ? '' : 's'}; ${fit} fit${fit === 1 ? 's' : ''}.`;
    }));
  }

  /** Makes the Architect's ticked steps. */
  private async make(): Promise<void> {
    const region = this.asked;
    await this.saying(makeSteps(this.architect, this.host.token, region, this.host.live()).then(async (n) => {
      await this.host.reload();
      return `Made ${n} step${n === 1 ? '' : 's'}${this.host.live() ? '' : ' as drafts'}.`;
    }));
  }

  /** Says how a call went, in the status strip. */
  private async saying(work: Promise<string>): Promise<void> {
    try {
      this.host.render(await work);
    } catch (err) {
      this.host.render((err as Error).message);
    }
    this.marked();
  }

  /** The workshop lands' looks, read once. */
  private async readBiomes(region: string): Promise<void> {
    this.biomes = [];
    try {
      this.biomes = (await readLand(this.host.token, region)).workshopBiomes;
      this.host.render();
    } catch {
      this.biomes = undefined;
    }
  }

  /** Outlines a change while its row is hovered, in the world and on the plan. */
  hover(id: string | undefined): void {
    const scene = this.host.scene();
    const map = this.host.scene()?.landMap(this.host.region());
    const edit = id ? this.host.log().edits.find((e) => e.id === id) : undefined;
    const box = edit && editBox(edit);
    this.hovered = box && { ...box, tone: 'held' };
    if (scene && map) strokeOutlines(this.outline, scene, map, this.hovered ? [this.hovered] : []);
    this.host.marked();
  }

  /** Bookmarks the middle of the view on the floor shown, by the name given (or where it is). */
  async bookmarkView(): Promise<void> {
    const at = this.host.middle();
    if (!at) return this.host.render('There is no land in the middle of the screen.');
    const name = this.viewName.trim() || `View at ${at.x}, ${at.y}`;
    this.viewName = '';
    this.tab = 'places';
    await this.host.send({ kind: 'bookmark', at: [at.x + 0.5, at.y + 0.5], name, level: this.host.levelIn(at.region) }, at.region);
  }

  /** Checks the land shown now, says what it found, and shows the Checks tab. */
  check(): void {
    const found = this.checked();
    if (!found) return this.host.render('That land is not in sight to check.');
    this.tab = 'checks';
    this.host.render(problemCount(found) ? 'Checked. See what turned up in the panel.' : 'Checked. All is well here.');
  }

  /** Checks the land again a moment after a change, quietly, and marks what it finds. */
  checkSoon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.host.open() && this.checked()) this.host.render();
    }, CHECK_AFTER_MS);
  }

  /** Checks the land shown and marks what the check found; undefined when its map is not here. */
  private checked(): LandCheck | undefined {
    const map = this.host.map(this.host.region());
    if (!map) return undefined;
    const scene = this.host.scene();
    this.checks = checkLand(map, (asset) => !!scene?.textures.exists(asset) || !!pictureFile(asset));
    this.marked();
    return this.checks;
  }

  /** Marks in the world the places the last check named (red) and the Architect's ticked steps (green), and on the plan. */
  marked(): void {
    const scene = this.host.scene();
    const map = scene?.landMap(this.host.region());
    if (scene && map) {
      const steps = this.steps().flatMap((s) => editBox(s as WorldEdit) ?? []).map((b) => ({ ...b, tone: 'held' as const }));
      strokeOutlines(this.marks, scene, map, [...this.problems().map(([x, y]) => ({ x, y, w: 1, h: 1, tone: 'warn' as const })), ...steps]);
    } else this.marks?.clear();
    this.host.marked();
  }
}
