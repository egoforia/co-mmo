import type Phaser from 'phaser';
import { BOOKMARK_TEXT, type Bookmark, type WorldEditDraft } from '@co-mmo/shared';
import type { EditLog } from '../api.ts';
import type { WorldScene } from '../world-scene.ts';
import { editBox } from './changes.ts';
import type { EditorCore, ToolStep } from './core.ts';
import { checkLand, landPanelHtml, problemCount, problemTiles, type LandCheck, type LandTab } from './land-panel.ts';
import { OUTLINE_DEPTH, strokeOutlines } from './world-input.ts';

// What the in-game editor does with its land panel (land-panel.ts): the tab
// chosen, the Changes filter, hovering and going to a change, Bookmark this
// view, the land's settings, and the checks run again after each change with
// red marks where they found something. in-game.ts hands it the clicks and
// inputs it does not know, and draws what it returns.

/** How long after a change the land is checked again, so the land laid again has reached this screen. */
const CHECK_AFTER_MS = 1500;

/** What the land panel needs from the editor around it. */
export interface LandHost {
  core: EditorCore;
  scene(): WorldScene | undefined;
  open(): boolean;
  /** The land the panel shows, and its edits. */
  region(): string;
  log(): EditLog;
  /** The floor shown in the land we are in (0 in the lands around it). */
  levelIn(region: string): number;
  /** Shows another floor of the land we are in, when it is that land. */
  showFloor(region: string, level: number): void;
  render(status?: string): void;
  send(edit: WorldEditDraft, region: string): Promise<void>;
  step(step: ToolStep): Promise<void>;
}

/** The land panel's state and actions in the game. */
export class LandControl {
  tab: LandTab = 'changes';
  private filter = 'all';
  private viewName = '';
  private checks?: LandCheck;
  private timer?: ReturnType<typeof setTimeout>;
  private marks?: Phaser.GameObjects.Graphics;
  private outline?: Phaser.GameObjects.Graphics;

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
    const scene = this.host.scene();
    return landPanelHtml({
      tab: this.tab, region: this.host.region(), list: this.host.log(), map: scene?.landMap(this.host.region()), filter: this.filter,
      marks, viewName: this.viewName, checks: this.checks, landForm: this.host.core.formHtml('land'),
    });
  }

  /** A button of the panel; false when it is not one of its own. */
  click(d: DOMStringMap): boolean {
    if (d.landTab) {
      this.tab = d.landTab as LandTab;
      this.host.render();
    } else if (d.editGo) {
      const edit = this.host.log().edits.find((e) => e.id === d.editGo);
      const box = edit && editBox(edit);
      if (box) this.lookAt(box.x + box.w / 2, box.y + box.h / 2, box.level);
    } else if (d.builtGo) {
      const [x, y, level] = d.builtGo.split(',').map(Number);
      this.lookAt(x! + 0.5, y! + 0.5, level!);
    } else if (d.bookmarkView !== undefined) void this.bookmarkView();
    else if (d.landApply !== undefined) {
      const at = this.host.scene()?.cameraTile();
      if (at) void this.host.step(this.host.core.makeAt('land', at.region, [at.x, at.y], 0));
      else this.host.render('There is no land in the middle of the screen.');
    } else if (d.check !== undefined) this.check();
    else return false;
    return true;
  }

  /** An input of the panel changed or was typed in; false when it is not one of its own. */
  input(input: HTMLInputElement): boolean {
    if (input.name === 'view-name') this.viewName = input.value.slice(0, BOOKMARK_TEXT.name);
    else if (input.name === 'changes-filter') {
      this.filter = input.value;
      this.host.render();
    } else return false;
    return true;
  }

  /** Outlines a change in the world while its row is hovered. */
  hover(id: string | undefined): void {
    const scene = this.host.scene();
    const map = scene?.landMap(this.host.region());
    const edit = id ? this.host.log().edits.find((e) => e.id === id) : undefined;
    const box = edit && editBox(edit);
    if (scene && map) strokeOutlines(this.outline, scene, map, box ? [{ ...box, tone: 'held' }] : []);
  }

  /** The camera goes to a tile of the land shown, on its floor. */
  private lookAt(x: number, y: number, level: number): void {
    const map = this.host.scene()?.landMap(this.host.region());
    if (!map) return this.host.render('That land is not in sight.');
    this.host.showFloor(this.host.region(), level);
    this.host.scene()?.lookAt(map, x, y);
  }

  /** Bookmarks the middle of the screen on the floor shown, by the name given (or where it is). */
  async bookmarkView(): Promise<void> {
    const at = this.host.scene()?.cameraTile();
    if (!at) return this.host.render('There is no land in the middle of the screen.');
    const name = this.viewName.trim() || `View at ${at.x}, ${at.y}`;
    this.viewName = '';
    this.tab = 'places';
    await this.host.send({ kind: 'bookmark', at: [at.x + 0.5, at.y + 0.5], name, level: this.host.levelIn(at.region) }, at.region);
  }

  /** Checks the land shown now, says what it found, and shows the Checks tab. */
  check(): void {
    const scene = this.host.scene();
    const found = scene && checkLand(scene, this.host.region());
    if (!found) return this.host.render('That land is not in sight to check.');
    this.checks = found;
    this.tab = 'checks';
    this.drawMarks();
    this.host.render(problemCount(found) ? 'Checked. See what turned up in the panel.' : 'Checked. All is well here.');
  }

  /** Checks the land again a moment after a change, quietly, and marks what it finds. */
  checkSoon(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const scene = this.host.scene();
      const found = this.host.open() && scene && checkLand(scene, this.host.region());
      if (!found) return;
      this.checks = found;
      this.drawMarks();
      this.host.render();
    }, CHECK_AFTER_MS);
  }

  /** Marks in red the places the last check named. */
  private drawMarks(): void {
    const scene = this.host.scene();
    const map = scene?.landMap(this.host.region());
    if (!scene || !map || !this.checks || this.checks.region !== this.host.region()) {
      this.marks?.clear();
      return;
    }
    strokeOutlines(this.marks, scene, map, problemTiles(this.checks).map(([x, y]) => ({ x, y, w: 1, h: 1, tone: 'warn' as const })));
  }
}
