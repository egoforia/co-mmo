// The Art Studio's window, laid out like an image editor (GIMP, Krita,
// OpenShot): workspaces along the top, the asset browser docked left, the
// page in the middle, the Inspector docked right and a strip along the
// bottom. The pages in the middle are today's (art-ui/*), unchanged, so
// nothing is lost; later steps put the canvas and its tools there.

import {
  afterArtRender,
  artChange,
  artClick,
  artPage,
  artSubmit,
  refreshArtJobs,
  refreshHandStatus,
  type ArtContext,
} from '../art-ui.ts';
import { artState, where } from '../art-ui/state.ts';
import { GameDown, api, toast } from '../gods-view/core.ts';
import { escapeHtml } from '../ui.ts';
import { AssetBrowser, type StudioAsset } from './browser.ts';
import { showPane, wireDocks } from './docks.ts';
import { inspectorHtml } from './inspector.ts';
import { studioKey, typingIn } from './keys.ts';
import { stripHtml } from './strip.ts';
import { TOP_PAGES, WORKSPACES, pageFor, pageHash, placeHash, workspaceOf, type Workspace } from './workspaces.ts';

const $ = (id: string) => document.getElementById(id)!;

/** The Studio's window: what is open, what is selected, and the docks around the page. */
export class StudioShell {
  private readonly main = $('main');
  private readonly frame = $('studio');
  private readonly browser: AssetBrowser;
  private readonly last: Partial<Record<Workspace['id'], string>> = {};
  private selected: string | undefined;
  private waiting = false;
  private readonly context: ArtContext = { api, toast, rerender: (force?: boolean) => void this.render(force ?? true) };

  constructor(private readonly onDown: () => void) {
    this.browser = new AssetBrowser($('dock-left'), (a) => this.pick(a));
    wireDocks(this.frame);
    this.drawTop();
    this.main.addEventListener('click', (e) => artClick(e.target as HTMLElement));
    this.main.addEventListener('submit', (e) => {
      e.preventDefault();
      artSubmit(e.target as HTMLFormElement);
    });
    this.main.addEventListener('change', (e) => artChange(e.target as HTMLElement));
    $('studio-top').addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-pane-tab]');
      if (tab) showPane(this.frame, tab.dataset.paneTab as 'assets' | 'page' | 'inspector');
    });
    addEventListener('hashchange', () => void this.render(false));
    addEventListener('keydown', (e) => this.key(e));
    showPane(this.frame, 'page');
  }

  /** Loads everything and draws the Studio, then keeps the jobs fresh. */
  async start(): Promise<void> {
    await this.render(true);
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refreshArtJobs(this.context).then(() => this.drawStrip());
      void refreshHandStatus(this.context);
    }, 3000);
  }

  /** Draws the page for the hash, and the docks around it. */
  async render(force = false): Promise<void> {
    if (this.waiting) return;
    const { sub, asset, walker } = where();
    const space = workspaceOf(sub);
    if (space) this.last[space.id] = sub;
    if (asset || walker) this.selected = asset ?? walker;
    this.drawTop();
    try {
      const [html] = await Promise.all([
        artPage(this.context, force, space?.pages),
        force || !this.browser.all.length ? this.loadAssets() : Promise.resolve(),
      ]);
      // Keep what the Owner is typing.
      const typing = this.main.contains(document.activeElement) && typingIn(document.activeElement) && (document.activeElement as HTMLInputElement).type !== 'checkbox';
      if (!typing) {
        this.main.innerHTML = html;
        afterArtRender();
      }
      this.drawInspector();
      this.drawStrip();
    } catch (err) {
      if (err instanceof GameDown) {
        this.waiting = true;
        return this.onDown();
      }
      this.main.innerHTML = `<p class="note">${escapeHtml((err as Error).message)}</p>`;
    }
  }

  private async loadAssets(): Promise<void> {
    try {
      const { assets } = await api<{ assets: StudioAsset[] }>('art/assets');
      this.browser.set(assets);
    } catch (err) {
      if (err instanceof GameDown) throw err;
      $('dock-left').innerHTML = `<h2 class="dock-title">Assets</h2><p class="note">${escapeHtml((err as Error).message)}</p>`;
    }
  }

  /** Selects an asset, and opens its page when it has one. */
  private pick(a: StudioAsset): void {
    this.selected = a.id;
    this.drawInspector();
    if (a.place.page || a.group === 'sounds') location.hash = placeHash(a.place);
    if (this.frame.dataset.pane === 'assets') showPane(this.frame, 'inspector');
  }

  private deselect(): void {
    this.selected = undefined;
    const [path, query] = location.hash.split('?');
    if (query) history.replaceState(null, '', path || '#');
    this.drawInspector();
  }

  private key(e: KeyboardEvent): void {
    // A dialog's own keys come first (review, versions).
    if (document.querySelector('dialog[open]')) return;
    const k = studioKey(e, typingIn(document.activeElement));
    if (!k) return;
    e.preventDefault();
    if ('workspace' in k) {
      const space = WORKSPACES.find((w) => w.key === k.workspace);
      if (space) location.hash = pageHash(pageFor(space, this.last));
    } else if ('search' in k) {
      showPane(this.frame, 'assets');
      this.browser.focusSearch();
    } else this.deselect();
  }

  /** The workspaces, with the open one marked, and the top bar's own pages. */
  private drawTop(): void {
    const { sub } = where();
    const open = workspaceOf(sub)?.id;
    $('workspaces').innerHTML = WORKSPACES.map((w) =>
      `<a href="${pageHash(pageFor(w, this.last))}" title="${escapeHtml(w.about)} (key ${w.key})"${w.id === open ? ' aria-current="page"' : ''}><kbd>${w.key}</kbd> ${w.label}</a>`,
    ).join('');
    $('top-pages').innerHTML = TOP_PAGES.map(([id, label]) => `<a href="${pageHash(id)}"${id === sub ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  }

  private drawInspector(): void {
    const a = this.selected ? this.browser.all.find((x) => x.id === this.selected) : undefined;
    this.browser.select(a?.id);
    $('dock-right').innerHTML = inspectorHtml(a);
  }

  private drawStrip(): void {
    $('strip').innerHTML = stripHtml(artState.data?.jobs ?? []);
  }
}
