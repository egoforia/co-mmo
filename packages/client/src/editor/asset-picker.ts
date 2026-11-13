import type { FieldChoice } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { artKnown, loadArt, pictureFile } from './art-index.ts';

// The asset picker: things to place are chosen from their pictures, not from
// a list of names. Search by name; show what is kept (starred), used lately,
// already in this land's look, or not painted yet; hover a picture to see it
// large with the tiles it stands on. The same picker serves set pieces,
// furniture, people's looks and monster kinds, from a making tool's form or
// the inspector, in both editor views. Kept and recent are this browser's
// own (localStorage), a convenience only.

/** Where kept and recent pictures are remembered, on this browser only. */
const KEPT_KEY = 'co-mmo.editor.assets.kept';
const RECENT_KEY = 'co-mmo.editor.assets.recent';
/** How many recent choices are remembered. */
const RECENT = 12;

/** The picker's filters, in order. */
const FILTERS = [['all', 'All'], ['kept', 'Kept'], ['recent', 'Recent'], ['land', 'In this land'], ['unpainted', 'Not painted yet']] as const;
type Filter = (typeof FILTERS)[number][0];

/** What the picker offers this time. */
export interface PickRequest {
  title: string;
  choices: FieldChoice[];
  chosen?: string;
  /** The pictures the land shown already uses, for "In this land". */
  landArt?: Set<string>;
  choose: (id: string) => void;
}

function readList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // No storage here: kept and recent last until the page is reloaded.
  }
}

/** The choices a filter and a search leave, kept ones first, then in their own order. */
export function pickable(choices: FieldChoice[], filter: string, typed: string, kept: string[], recent: string[], landArt: Set<string> = new Set(), painted: (art?: string) => boolean = () => true): FieldChoice[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = choices.filter((c) => {
    if (!words.every((w) => c.name.toLowerCase().includes(w))) return false;
    if (filter === 'kept') return kept.includes(c.id);
    if (filter === 'recent') return recent.includes(c.id);
    if (filter === 'land') return !!c.art && landArt.has(c.art);
    if (filter === 'unpainted') return !painted(c.art);
    return true;
  });
  if (filter === 'recent') return shown.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
  return shown.sort((a, b) => Number(kept.includes(b.id)) - Number(kept.includes(a.id)));
}

/** The picker's window, made once per page and filled each time it opens. */
export class AssetPicker {
  private readonly el = document.createElement('div');
  private request?: PickRequest;
  private filter: Filter = 'all';
  private typed = '';
  private hovered?: string;

  constructor() {
    this.el.className = 'asset-picker';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.addEventListener('click', (e) => this.clicked(e));
    this.el.addEventListener('input', (e) => {
      this.typed = (e.target as HTMLInputElement).value;
      this.draw(false);
    });
    this.el.addEventListener('mouseover', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-asset]');
      if (tile && tile.dataset.asset !== this.hovered) {
        this.hovered = tile.dataset.asset;
        this.preview();
      }
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      else if (e.key === 'Enter') {
        const first = this.shown()[0];
        if (first) this.use(first.id);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    document.body.append(this.el);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Opens with these choices; the pictures load the first time. */
  show(request: PickRequest): void {
    this.request = request;
    this.typed = '';
    this.hovered = request.chosen;
    this.el.hidden = false;
    this.draw(true);
    if (!artKnown()) void loadArt().then(() => this.open && this.draw(true));
  }

  close(): void {
    this.el.hidden = true;
    this.request = undefined;
  }

  private shown(): FieldChoice[] {
    const r = this.request;
    return r ? pickable(r.choices, this.filter, this.typed, readList(KEPT_KEY), readList(RECENT_KEY), r.landArt, (art) => !!pictureFile(art)) : [];
  }

  private clicked(e: Event): void {
    const t = e.target as HTMLElement;
    const keep = t.closest<HTMLElement>('[data-asset-keep]')?.dataset.assetKeep;
    if (keep) {
      const kept = readList(KEPT_KEY);
      writeList(KEPT_KEY, kept.includes(keep) ? kept.filter((k) => k !== keep) : [...kept, keep]);
      return this.draw(false);
    }
    const filter = t.closest<HTMLElement>('[data-asset-filter]')?.dataset.assetFilter;
    if (filter) {
      this.filter = filter as Filter;
      return this.draw(false);
    }
    if (t.closest('[data-asset-close]') || t === this.el) return this.close();
    const id = t.closest<HTMLElement>('[data-asset]')?.dataset.asset;
    if (id) this.use(id);
  }

  private use(id: string): void {
    const choose = this.request?.choose;
    writeList(RECENT_KEY, [id, ...readList(RECENT_KEY).filter((r) => r !== id)].slice(0, RECENT));
    this.close();
    choose?.(id);
  }

  /** Draws the window; the search box is kept (and keeps its focus) when only the list changes. */
  private draw(whole: boolean): void {
    const r = this.request;
    if (!r) return;
    const kept = readList(KEPT_KEY);
    if (whole) {
      this.el.innerHTML = `<div class="asset-box"><header><strong>${escapeHtml(r.title)}</strong>
        <input name="asset-search" type="search" autocomplete="off" placeholder="Search by name…" aria-label="Search" />
        <button type="button" class="quiet" data-asset-close aria-label="Close">×</button></header>
        <nav class="asset-filters"></nav><div class="asset-body"><ol class="asset-grid"></ol><aside class="asset-preview"></aside></div></div>`;
      this.el.querySelector<HTMLInputElement>('input')!.focus();
    }
    this.el.querySelector('.asset-filters')!.innerHTML = FILTERS.map(([id, name]) =>
      `<button type="button" data-asset-filter="${id}" class="${id === this.filter ? 'on' : 'quiet'}">${name}${id === 'kept' && kept.length ? ` (${kept.length})` : ''}</button>`).join('');
    const shown = this.shown();
    this.el.querySelector('.asset-grid')!.innerHTML = shown.length ? shown.map((c) => {
      const file = pictureFile(c.art);
      const star = kept.includes(c.id);
      return `<li data-asset="${escapeHtml(c.id)}" class="${c.id === r.chosen ? 'chosen' : ''}" title="${escapeHtml(c.name)}">
        ${file ? `<img src="${escapeHtml(file)}" alt="" loading="lazy" />` : '<span class="unpainted">Not painted yet</span>'}
        <span class="name">${escapeHtml(c.name)}</span>
        <button type="button" class="keep${star ? ' on' : ''}" data-asset-keep="${escapeHtml(c.id)}" aria-label="${star ? 'Stop keeping' : 'Keep'}" title="${star ? 'Kept: click to let go' : 'Keep it at the front'}">${star ? '★' : '☆'}</button></li>`;
    }).join('') : `<li class="none">${this.filter === 'kept' ? 'Nothing kept yet: star a picture to keep it here.' : 'Nothing by that name here.'}</li>`;
    this.preview();
  }

  /** The picture under the pointer (or the one chosen), large, with its name and the tiles it stands on. */
  private preview(): void {
    const c = this.request?.choices.find((x) => x.id === this.hovered);
    const pane = this.el.querySelector('.asset-preview');
    if (!pane) return;
    if (!c) {
      pane.innerHTML = '<p class="note">Hover a picture to see it large.</p>';
      return;
    }
    const file = pictureFile(c.art);
    pane.innerHTML = `${file ? `<img src="${escapeHtml(file)}" alt="${escapeHtml(c.name)}" />` : '<p class="unpainted">Not painted yet. It shows once it is painted in the Art tab.</p>'}
      <strong>${escapeHtml(c.name)}</strong>${c.size ? `<span class="note">Stands on ${c.size[0]} × ${c.size[1]} tile${c.size[0] * c.size[1] === 1 ? '' : 's'}</span>` : ''}
      ${this.request?.landArt?.has(c.art ?? '') ? '<span class="note">Already in this land</span>' : ''}`;
  }
}

/** The picture choices of a map's things: what its people, monsters and pieces look like. */
export function landArt(map: { npcs: { asset: string }[]; creatures: { asset: string }[]; landmarks: { asset: string }[] } | undefined): Set<string> {
  return new Set(map ? [...map.npcs.map((n) => n.asset), ...map.creatures.map((c) => c.asset), ...map.landmarks.map((l) => l.asset)] : []);
}

let shared: AssetPicker | undefined;

/** Opens the page's one picker for a setting of the editor core (`data-asset-field`); false when the setting has no pictures. */
export function pickFor(core: { assetChoices(name: string): { label: string; choices: FieldChoice[]; value: string } | undefined; set(name: string, raw: string): boolean }, name: string, map: Parameters<typeof landArt>[0], done: () => void): boolean {
  const found = core.assetChoices(name);
  if (!found) return false;
  shared ??= new AssetPicker();
  shared.show({ title: `Choose: ${found.label}`, choices: found.choices, chosen: found.value, landArt: landArt(map), choose: (id) => {
    core.set(name, id);
    done();
  } });
  return true;
}
