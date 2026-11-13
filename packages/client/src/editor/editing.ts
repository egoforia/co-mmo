import { worldEdits, type EditLog } from '../api.ts';
import type { WorldScene } from '../world-scene.ts';
import type { ToolStep } from './core.ts';
import type { LandView } from './lands-io.ts';
import type { PlanView } from './plan-view.ts';
import { doneWords } from './shell.ts';

// The land the editor is changing and its edits: which land it is (the one
// we are in, the one last edited, or the one the Plan camera shows), its list
// of edits, sending a change to the server and showing the drafts that come
// back. Each change is saved by the server, which lays the land out again
// everywhere and shows it to everyone there (or to editors only, while it is
// a draft).

/** A change to send: an edit or edits made together, undo, redo, remove one, publish or discard the drafts. */
export type EditAction = NonNullable<Parameters<typeof worldEdits>[2]>;

/** What the edits need from the editor around them. */
export interface EditingHost {
  token: string;
  scene(): WorldScene | undefined;
  open(): boolean;
  /** The land we are in. */
  ourLand(): { id: string; name: string };
  /** A land's name, from what the editor knows. */
  nameOf(region: string): string;
  plan: PlanView;
  /** A change came back: the land is checked again soon. */
  changed(): void;
  render(status?: string): void;
}

/** The land being changed and its edits. */
export class Editing {
  /** The land whose edits the list shows: the one last edited, or the one we are in. */
  region = '';
  name = '';
  log: EditLog = { edits: [], undone: 0 };
  busy = false;
  /** New edits go live at once instead of waiting as drafts. */
  live = false;

  constructor(private readonly host: EditingHost) {}

  /** Lists the edits of the land we are in. */
  follow(): void {
    if (this.region) this.host.scene()?.previewEdits(this.region);
    ({ id: this.region, name: this.name } = this.host.ourLand());
  }

  /** Reads the land's edits again (the plan too, while it looks). */
  async reload(): Promise<void> {
    if (this.host.plan.open) return this.host.plan.reload();
    try {
      this.log = await worldEdits(this.host.token, this.region);
      this.showDrafts();
      this.host.changed();
      this.host.render();
    } catch (err) {
      this.host.render((err as Error).message);
    }
  }

  /** The Plan camera read a land: the list follows it. */
  shown(view: LandView): void {
    if (view.region !== this.region) this.host.scene()?.previewEdits(this.region);
    this.region = view.region;
    this.name = view.regions.find((r) => r.id === view.region)?.name ?? view.region;
    this.log = { edits: view.edits, undone: view.undone, ...(view.map.unlaid ? { unlaid: view.map.unlaid } : {}) };
    this.showDrafts();
    this.host.changed();
  }

  /** The scene shows the listed land's drafts while the editor is open. */
  showDrafts(): void {
    this.host.scene()?.previewEdits(this.region, this.host.open() ? this.log.edits : undefined);
  }

  /** Does what a tool asks: sends the edit it made, or says something (`holding`: draws again for a tool part way through). */
  async step(step: ToolStep, holding: boolean): Promise<void> {
    if (step.drafts) await this.act({ edits: step.drafts, live: this.live }, step.region);
    else if (step.draft) await this.act({ edit: step.draft, live: this.live }, step.region);
    else if (step.say !== undefined) this.host.render(step.say);
    else if (holding) this.host.render();
  }

  /** Sends a change and shows the land's edits as they now are. */
  async act(action: EditAction, region = this.region): Promise<void> {
    if (this.busy) return;
    const name = region === this.region ? this.name : this.host.nameOf(region);
    this.busy = true;
    this.host.render('Saving…');
    let said: string;
    try {
      if (region !== this.region) this.host.scene()?.previewEdits(this.region);
      this.log = await worldEdits(this.host.token, region, action);
      this.region = region;
      this.name = name;
      this.showDrafts();
      this.host.changed();
      // The plan is read again: the server laid the land out anew.
      if (this.host.plan.open) await this.host.plan.reload();
      said = doneWords(action, this.live);
    } catch (err) {
      said = (err as Error).message;
    }
    this.busy = false;
    this.host.render(said);
  }
}
