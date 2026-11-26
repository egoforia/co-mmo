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
import { glowOf } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { AssetBrowser, type StudioAsset } from './browser.ts';
import { centreFit, type BaseMeasure } from './auto-centre.ts';
import { CANVAS_GROUPS, StudioCanvas, canvasFloor } from './canvas.ts';
import { centreHtml, centreIntroHtml, centreTargets, proposals, type Proposal } from './centre-page.ts';
import { FIT_GROUPS, FitDraft, SCALE_GROUPS, fitFromFields, fitPanelHtml } from './fit-tool.ts';
import { HITBOX_GROUPS, alikeAssets, hitboxPanelHtml, saveTiles } from './hitbox-tool.ts';
import { LIGHT_GROUPS, lightButton, lightFromFields, lightPanelHtml } from './light-tool.ts';
import { showPane, wireDocks } from './docks.ts';
import { inspectorHtml } from './inspector.ts';
import { studioKey, typingIn } from './keys.ts';
import { stripHtml } from './strip.ts';
import { createDockHtml, spotKindOf } from './create-dock.ts';
import { FrameStrip, spotStatesHtml } from './frame-strip.ts';
import { versionsHtml } from './versions.ts';
import { SHELL_PAGES, TOP_PAGES, WORKSPACES, canvasHash, hashPage, pageFor, pageHash, placeHash, workspaceOf, type Workspace } from './workspaces.ts';

const $ = (id: string) => document.getElementById(id)!;

/** The Studio's window: what is open, what is selected, and the docks around the page. */
export class StudioShell {
  private readonly main = $('main');
  private readonly frame = $('studio');
  private readonly browser: AssetBrowser;
  private readonly frames = new FrameStrip($('frames'));
  private readonly last: Partial<Record<Workspace['id'], string>> = {};
  private selected: string | undefined;
  /** The canvas shown now, and the fit being changed on it. */
  private canvas: StudioCanvas | undefined;
  private draft: FitDraft | undefined;
  /** True while the Hitbox tool is on (B). */
  private hitbox = false;
  /** The earlier version laid against the one shown now in the Versions dock. */
  private version: string | undefined;
  private waiting = false;
  private readonly context: ArtContext = { api, toast, rerender: (force?: boolean) => void this.render(force ?? true) };

  constructor(private readonly onDown: () => void) {
    this.browser = new AssetBrowser($('dock-left'), (a) => this.pick(a), () => {
      // The Centre page works on what the browser shows, so it follows the filters until measured.
      const page = this.main.querySelector('.centre-page');
      if (page && !this.centring.length) page.innerHTML = centreIntroHtml(centreTargets(this.browser.shown()));
    });
    wireDocks(this.frame);
    this.drawTop();
    this.main.addEventListener('click', (e) => {
      artClick(e.target as HTMLElement);
      this.pickCard(e.target as HTMLElement);
    });
    this.main.addEventListener('submit', (e) => {
      e.preventDefault();
      artSubmit(e.target as HTMLFormElement);
    });
    this.main.addEventListener('change', (e) => {
      if ((e.target as HTMLInputElement).name === 'centre') return this.countTicked();
      artChange(e.target as HTMLElement);
    });
    this.main.addEventListener('click', (e) => this.centreClick(e.target as HTMLElement));
    $('studio-top').addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-pane-tab]');
      if (tab) showPane(this.frame, tab.dataset.paneTab as 'assets' | 'page' | 'inspector');
    });
    $('dock-right').addEventListener('click', (e) => this.versionClick(e.target as HTMLElement));
    $('dock-right').addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.type === 'range') input.closest<HTMLElement>('.compare')?.style.setProperty('--cut', `${input.value}%`);
      else if (input.name.startsWith('fit-') && this.draft) {
        this.draft.set(fitFromFields($('dock-right'), this.draft.state));
        this.canvas?.draw();
        this.drawFitWords();
      } else if (input.name.startsWith('light-') && this.draft && this.selected) {
        this.draft.set(lightFromFields($('dock-right'), this.draft.state, glowOf(this.selected)));
        this.canvas?.draw();
        this.drawFitWords();
      }
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
      else if (page === 'centre') this.drawCentre(nav);
      else if (!typing) {
        this.canvas = this.draft = undefined;
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

  /**
   * Clicking a picture's card on a page (Paint, Animate, Sound) selects it,
   * so the Inspector shows it; its buttons, links and fields keep their own
   * clicks. The address keeps it, as the browser's own picks do.
   */
  private pickCard(target: HTMLElement): void {
    if (target.closest('button, a, input, textarea, select, summary, label, details.hands, canvas, dialog')) return;
    const card = target.closest<HTMLElement>('[data-asset-card], .walker[data-walker]');
    const id = card?.dataset.assetCard ?? card?.dataset.walker;
    if (!card || !id || id === this.selected) return;
    this.selected = id;
    this.version = undefined;
    const [path] = location.hash.split('?');
    history.replaceState(null, '', `${path || '#'}?${card.dataset.assetCard ? 'asset' : 'walker'}=${encodeURIComponent(id)}`);
    this.drawInspector();
    if (this.frame.dataset.pane === 'page' && matchMedia('(max-width: 960px)').matches) showPane(this.frame, 'inspector');
  }

  /** Marks the selected asset's card on the page. */
  private markCard(): void {
    for (const el of this.main.querySelectorAll('[data-picked]')) el.removeAttribute('data-picked');
    if (!this.selected) return;
    const id = CSS.escape(this.selected);
    this.main.querySelector(`[data-asset-card="${id}"], .walker[data-walker="${id}"]`)?.setAttribute('data-picked', '');
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
    // The arrows, B, C and Ctrl Z belong to the page unless a picture is being fitted.
    if (('nudge' in k || 'undo' in k || 'centre' in k || 'hitbox' in k) && !this.draft) return;
    e.preventDefault();
    if ('centre' in k) return void this.centreOne();
    if ('hitbox' in k) return this.toggleHitbox();
    if ('nudge' in k || 'undo' in k) {
      if (!this.draft || !this.canvas) return;
      if ('nudge' in k) this.draft.nudge(k.nudge[0], k.nudge[1]);
      else this.draft.undo();
      this.canvas.draw();
      this.drawFitPanel();
      return;
    }
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
    this.markCard();
    const item = a && artState.data?.items.find((i) => i.id === a.id);
    const fit = a && this.draft ? `<section class="fit-panel">${this.fitHtml(a, this.draft)}</section>` : '';
    $('dock-right').innerHTML = inspectorHtml(a) + fit + createDockHtml(a, artState.data ?? undefined) + versionsHtml(item, this.version);
    const walker = a && artState.data?.walkers.find((w) => w.id === a.id);
    const spot = a && !walker ? spotKindOf(a.id) ?? spotKindOf(a.id.replace(/-(?:picked|growing)$/, '')) : undefined;
    if (spot) this.frames.showHtml(spotStatesHtml(spot, artState.data?.items ?? []));
    else this.frames.show(walker);
  }

  /** Draws the Offset section again, keeping the field being typed in. */
  private drawFitPanel(): void {
    const a = this.selected ? this.browser.all.find((x) => x.id === this.selected) : undefined;
    const panel = $('dock-right').querySelector('.fit-panel');
    if (panel && a && this.draft) panel.innerHTML = this.fitHtml(a, this.draft);
  }

  /** The Offset section, with the Hitbox and Light sections for a set piece. */
  private fitHtml(a: StudioAsset, draft: FitDraft): string {
    const hitbox = HITBOX_GROUPS.includes(a.group) ? hitboxPanelHtml(a, draft, this.hitbox, alikeAssets(a, this.browser.shown()).length) : '';
    const light = LIGHT_GROUPS.includes(a.group) ? `<section class="light-panel">${lightPanelHtml(a, draft)}</section>` : '';
    return fitPanelHtml(a, draft, hitbox + light);
  }

  /** Turns the Hitbox tool on or off, for a set piece on the canvas. */
  private toggleHitbox(): void {
    const a = this.selected ? this.browser.all.find((x) => x.id === this.selected) : undefined;
    if (!a || !HITBOX_GROUPS.includes(a.group) || !this.canvas) return;
    this.hitbox = !this.hitbox;
    this.canvas.setHitbox(this.hitbox);
    this.drawFitPanel();
  }

  /** Gives the other set pieces shown with this footprint the tiles chosen here, each keeping its own offset and size. */
  private saveAlike(a: StudioAsset, button: HTMLButtonElement): void {
    const alike = alikeAssets(a, this.browser.shown());
    if (!this.draft || !alike.length || !confirm(`Give ${alike.length} other set pieces these blocked tiles, for everyone?`)) return;
    button.disabled = true;
    void saveTiles(alike, this.draft.state.blocks, api, toast).then(() => this.render(true));
  }

  /** The words under the Offset fields, while they are typed in. */
  private drawFitWords(): void {
    const a = this.selected ? this.browser.all.find((x) => x.id === this.selected) : undefined;
    const panel = $('dock-right').querySelector('.fit-panel');
    if (!panel || !a || !this.draft) return;
    const fresh = document.createElement('div');
    fresh.innerHTML = this.fitHtml(a, this.draft);
    panel.querySelector('.fit-words')!.replaceWith(fresh.querySelector('.fit-words')!);
    panel.querySelector('[data-fit-save]')!.replaceWith(fresh.querySelector('[data-fit-save]')!);
    for (const sel of ['.light-words', '[data-light-usual]', '[data-light-off]']) {
      const now = fresh.querySelector(sel);
      if (now) panel.querySelector(sel)?.replaceWith(now);
    }
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
    this.draft = FIT_GROUPS.includes(a.group) ? new FitDraft(a.fit) : undefined;
    this.hitbox = false;
    this.canvas = new StudioCanvas(this.main.querySelector('.canvas-page')!, a, await loadArt(), this.draft, () => this.drawFitPanel());
    this.drawInspector();
    await this.canvas.mount();
  }

  /** Where the selected picture meets the ground, centred on its tiles in the draft (not saved yet). */
  private async centreOne(): Promise<void> {
    const a = this.selected ? this.browser.all.find((x) => x.id === this.selected) : undefined;
    if (!a || !this.draft || !this.canvas) return;
    try {
      const { measures } = await api<{ measures: Record<string, BaseMeasure | { why: string }> }>('art/measure', 'POST', { assets: [a.id] });
      const m = measures[a.id];
      if (!m || 'why' in m) return toast(m?.why ?? 'It could not be measured.');
      const art = await loadArt();
      this.draft.set({ ...this.draft.state, ...centreFit(m, canvasFloor(a), art[a.id]?.view === 'isometric', SCALE_GROUPS.includes(a.group)) });
      this.canvas.draw();
      this.drawFitPanel();
      if (m.sure === 'low') toast('Centred, but its foot is in pieces: check it by eye before saving.');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  private centring: Proposal[] = [];

  /** The Centre page: the fittable assets shown on the left, measured on request. */
  private drawCentre(nav: string): void {
    this.canvas = this.draft = undefined;
    this.centring = [];
    this.main.innerHTML = `${nav}<div class="centre-page">${centreIntroHtml(centreTargets(this.browser.shown()))}</div>`;
  }

  private centreClick(target: HTMLElement): void {
    const page = this.main.querySelector<HTMLElement>('.centre-page');
    if (!page) return;
    const measure = target.closest<HTMLButtonElement>('[data-centre-measure]');
    if (measure) {
      measure.disabled = true;
      measure.textContent = 'Measuring…';
      const targets = centreTargets(this.browser.shown());
      void Promise.all([api<{ measures: Record<string, BaseMeasure | { why: string }> }>('art/measure', 'POST', { assets: targets.map((a) => a.id) }), loadArt()]).then(
        ([{ measures }, art]) => {
          this.centring = proposals(targets, measures, art);
          page.innerHTML = centreHtml(this.centring);
        },
        (err: Error) => {
          measure.disabled = false;
          toast(err.message);
        },
      );
      return;
    }
    const save = target.closest<HTMLButtonElement>('[data-centre-save]');
    if (!save) return;
    const ticked = new Set([...page.querySelectorAll<HTMLInputElement>('input[name=centre]:checked')].map((i) => i.value));
    const chosen = this.centring.filter((p) => p.fit && ticked.has(p.asset.id));
    if (!chosen.length) return toast('Tick the ones to keep first.');
    save.disabled = true;
    void (async () => {
      let saved = 0;
      for (const p of chosen) {
        try {
          await api('art/fit', 'POST', { asset: p.asset.id, offset: p.fit!.offset, scale: p.fit!.scale, blocks: p.asset.fit?.blocks, light: p.asset.fit?.light });
          saved++;
        } catch (err) {
          toast(`${p.asset.name}: ${(err as Error).message}`);
        }
      }
      toast(`Centred ${saved} of ${chosen.length}. Players see them at once.`);
      void this.render(true);
    })();
  }

  /** The save button's count, as boxes are ticked. */
  private countTicked(): void {
    const n = this.main.querySelectorAll('.centre-page input[name=centre]:checked').length;
    const save = this.main.querySelector('[data-centre-save]');
    if (save) save.textContent = `Save the ${n} ticked`;
  }

  /** Saves the fit being changed, or puts the picture back where it was painted: players see it at once. */
  private saveFit(asset: string, reset: boolean, button: HTMLButtonElement): void {
    if (reset && !confirm('Put this picture back where it was painted, for everyone?')) return;
    button.disabled = true;
    const body = reset ? { asset } : { asset, offset: this.draft?.state.offset, scale: this.draft?.state.scale, blocks: this.draft?.state.blocks, light: this.draft?.state.light };
    void api('art/fit', reset ? 'DELETE' : 'POST', body).then(
      () => {
        toast(reset ? 'Back where it was painted. Players see it at once.' : 'Fit saved. Players see it at once; undo it in God\'s View like any wish.');
        void this.render(true);
      },
      (err: Error) => {
        button.disabled = false;
        toast(err.message);
      },
    );
  }

  /** The Versions dock's buttons: lay a version against the one shown now, or put it back. */
  private versionClick(target: HTMLElement): void {
    // Create with AI opens the same review as the pages (art-ui/dialogs.ts).
    if (target.closest('[data-art-review]')) return void artClick(target);
    if (target.closest('[data-fit-centre]')) return void this.centreOne();
    if (target.closest('[data-hitbox-edit]')) return this.toggleHitbox();
    const lit = this.draft && lightButton(target, this.draft.state);
    if (lit && this.draft) {
      this.draft.set(lit);
      this.canvas?.draw();
      return this.drawFitPanel();
    }
    if (target.closest('[data-hitbox-all]') && this.draft) {
      const { blocks: _, ...every } = this.draft.state;
      this.draft.set(every);
      this.canvas?.draw();
      return this.drawFitPanel();
    }
    const alike = target.closest<HTMLButtonElement>('[data-hitbox-alike]');
    const picked = this.selected ? this.browser.all.find((x) => x.id === this.selected) : undefined;
    if (alike && picked) return this.saveAlike(picked, alike);
    const save = target.closest<HTMLButtonElement>('[data-fit-save]');
    const reset = target.closest<HTMLButtonElement>('[data-fit-reset]');
    if ((save || reset) && this.selected) return this.saveFit(this.selected, !!reset, (save ?? reset)!);
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
