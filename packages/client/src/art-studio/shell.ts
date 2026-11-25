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
import { SUBTABS, artState, where } from '../art-ui/state.ts';
import { loadArt } from '../editor/art-index.ts';
import { GameDown, api, toast } from '../gods-view/core.ts';
import { escapeHtml } from '../ui.ts';
import { AssetBrowser, type StudioAsset } from './browser.ts';
import { CANVAS_GROUPS, StudioCanvas } from './canvas.ts';
import { showPane, wireDocks } from './docks.ts';
import { inspectorHtml } from './inspector.ts';
import { studioKey, typingIn } from './keys.ts';
import { stripHtml } from './strip.ts';
import { versionsHtml } from './versions.ts';
import { SHELL_PAGES, TOP_PAGES, WORKSPACES, canvasHash, hashPage, pageFor, pageHash, placeHash, workspaceOf, type Workspace } from './workspaces.ts';

const $ = (id: string) => document.getElementById(id)!;

/** The Studio's window: what is open, what is selected, and the docks around the page. */
export class StudioShell {
  private readonly main = $('main');
  private readonly frame = $('studio');
  private readonly browser: AssetBrowser;
  private readonly last: Partial<Record<Workspace['id'], string>> = {};
  private selected: string | undefined;
  /** The earlier version laid against the one shown now in the Versions dock. */
  private version: string | undefined;
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
    $('dock-right').addEventListener('click', (e) => this.versionClick(e.target as HTMLElement));
    $('dock-right').addEventListener('input', (e) => {
      const range = e.target as HTMLInputElement;
      if (range.type === 'range') range.closest<HTMLElement>('.compare')?.style.setProperty('--cut', `${range.value}%`);
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
    const page = hashPage(location.hash, sub);
    const space = workspaceOf(page);
    if (space) this.last[space.id] = page;
    if ((asset || walker) && (asset ?? walker) !== this.selected) {
      this.selected = asset ?? walker;
      this.version = undefined;
    }
    this.drawTop();
    try {
      const [html] = await Promise.all([
        artPage(this.context, force, space?.pages),
        force || !this.browser.all.length ? this.loadAssets() : Promise.resolve(),
      ]);
      // Keep what the Owner is typing.
      const typing = this.main.contains(document.activeElement) && typingIn(document.activeElement) && (document.activeElement as HTMLInputElement).type !== 'checkbox';
      const nav = this.pagesNav(space, page);
      if (page === 'canvas') await this.drawCanvas(nav);
      else if (!typing) {
        this.main.innerHTML = nav + html;
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
    this.version = undefined;
    // In the Place workspace an asset opens on the canvas; elsewhere on its page.
    const onCanvas = workspaceOf(hashPage(location.hash, where().sub))?.id === 'place' && CANVAS_GROUPS.includes(a.group);
    if (onCanvas) location.hash = canvasHash(a.id);
    else if (a.place.page || a.group === 'sounds') location.hash = placeHash(a.place);
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
    const sub = hashPage(location.hash, where().sub);
    const open = workspaceOf(sub)?.id;
    $('workspaces').innerHTML = WORKSPACES.map((w) =>
      `<a href="${pageHash(pageFor(w, this.last))}" title="${escapeHtml(w.about)} (key ${w.key})"${w.id === open ? ' aria-current="page"' : ''}><kbd>${w.key}</kbd> ${w.label}</a>`,
    ).join('');
    $('top-pages').innerHTML = TOP_PAGES.map(([id, label]) => `<a href="${pageHash(id)}"${id === sub ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  }

  private drawInspector(): void {
    const a = this.selected ? this.browser.all.find((x) => x.id === this.selected) : undefined;
    this.browser.select(a?.id);
    const item = a && artState.data?.items.find((i) => i.id === a.id);
    $('dock-right').innerHTML = inspectorHtml(a) + versionsHtml(item, this.version);
  }

  /** A workspace's own page tabs, when it holds one of the shell's pages (art-ui draws the others' tabs). */
  private pagesNav(space: Workspace | undefined, page: string): string {
    if (!space || !space.pages.some((p) => SHELL_PAGES.some(([id]) => id === p))) return '';
    const label = (id: string) => SHELL_PAGES.find(([x]) => x === id)?.[1] ?? SUBTABS.find(([x]) => x === id)?.[1] ?? id;
    return `<nav class="subtabs">${space.pages.map((p) => `<a href="${pageHash(p)}"${p === page ? ' aria-current="page"' : ''}>${escapeHtml(label(p))}</a>`).join('')}</nav>`;
  }

  /** The canvas page: the selected asset on its tiles, or how to pick one. */
  private async drawCanvas(nav: string): Promise<void> {
    const a = this.selected ? this.browser.all.find((x) => x.id === this.selected) : undefined;
    if (!a || !CANVAS_GROUPS.includes(a.group)) {
      this.main.innerHTML = `${nav}<p class="note">Pick a set piece, spot, stairway, tree or rock, or someone who walks, in the assets on the left to stand it on its tiles here.</p>`;
      return;
    }
    this.main.innerHTML = `${nav}<div class="canvas-page"></div>`;
    await new StudioCanvas(this.main.querySelector('.canvas-page')!, a, await loadArt()).mount();
  }

  /** The Versions dock's buttons: lay a version against the one shown now, or put it back. */
  private versionClick(target: HTMLElement): void {
    const pick = target.closest<HTMLElement>('[data-version]');
    if (pick) {
      this.version = pick.dataset.version;
      return this.drawInspector();
    }
    const back = target.closest<HTMLButtonElement>('[data-restore]');
    if (!back) return;
    back.disabled = true;
    void api('art/restore', 'POST', { asset: back.dataset.of, version: back.dataset.restore }).then(
      () => {
        toast('Put back. Players see it after they reload; the one it replaced is kept here.');
        this.version = undefined;
        void this.render(true);
      },
      (err: Error) => {
        back.disabled = false;
        toast(err.message);
      },
    );
  }

  private drawStrip(): void {
    $('strip').innerHTML = stripHtml(artState.data?.jobs ?? []);
  }
}
