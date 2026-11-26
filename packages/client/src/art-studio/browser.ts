// The asset browser dock: every picture, walker and sound the Studio knows
// (GET /api/admin/art/assets), in groups as chips, with a land and status
// filter and a search, like the asset browsers of Godot and Krita. Picking one
// selects it for the Inspector and opens it on its page.

import type { AssetFit } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';

/** The browser's groups, in chip order, with their words. */
export const GROUPS: readonly [string, string][] = [
  ['all', 'All'], ['characters', 'Characters'], ['monsters', 'Monsters'], ['items', 'Items'], ['scenery', 'Scenery'],
  ['pieces', 'Pieces'], ['spots', 'Spots'], ['stairs', 'Stairs'], ['buildings', 'Buildings'], ['hud', 'HUD'], ['sounds', 'Sounds'],
];

/** One entry of the list, as the server sends it. */
export interface StudioAsset {
  id: string;
  name: string;
  group: string;
  land?: string;
  footprint?: { width: number; height: number };
  status: 'painted' | 'stand-in' | 'missing';
  thumb?: string;
  /** How it sits on its tiles, when fitted in the Studio (asset-fit.ts). */
  fit?: AssetFit;
  place: { tab: string; page?: string; walker?: string; asset?: string };
}

/** What the browser shows: a group, a land, a status and the words searched for. */
export interface BrowserFilter {
  group: string;
  land: string;
  status: string;
  search: string;
}

/** The most rows drawn at once; a search narrows the rest. */
export const SHOWN = 300;

/** The assets a filter keeps, in the server's order. Every searched word must be in the name, id or land. */
export function filterAssets(assets: readonly StudioAsset[], f: BrowserFilter): StudioAsset[] {
  const words = f.search.toLowerCase().split(/\s+/).filter(Boolean);
  return assets.filter((a) => {
    if (f.group !== 'all' && a.group !== f.group) return false;
    if (f.land !== 'all' && a.land !== f.land) return false;
    if (f.status !== 'all' && a.status !== f.status) return false;
    const text = `${a.name} ${a.id} ${a.land ?? ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** How many assets each group holds, for the chips. */
export function groupCounts(assets: readonly StudioAsset[]): Record<string, number> {
  const counts: Record<string, number> = { all: assets.length };
  for (const a of assets) counts[a.group] = (counts[a.group] ?? 0) + 1;
  return counts;
}

const STATUS_WORDS: Record<StudioAsset['status'], string> = { painted: 'painted', 'stand-in': 'stand-in shown', missing: 'not painted yet' };

/** The browser dock, drawn into `el`. */
export class AssetBrowser {
  private assets: StudioAsset[] = [];
  private filter: BrowserFilter = { group: 'all', land: 'all', status: 'all', search: '' };
  private selected: string | undefined;

  constructor(
    private readonly el: HTMLElement,
    private readonly pick: (asset: StudioAsset) => void,
    /** Called when the filters change what is shown. */
    private readonly filtered: () => void = () => {},
  ) {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const chip = target.closest<HTMLElement>('[data-group]');
      if (chip) {
        this.filter.group = chip.dataset.group!;
        return this.draw();
      }
      const row = target.closest<HTMLElement>('[data-asset]');
      const asset = row && this.assets.find((a) => a.id === row.dataset.asset);
      if (asset) this.pick(asset);
    });
    el.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement | HTMLSelectElement;
      if (input.name === 'search') this.filter.search = input.value;
      else if (input.name === 'land') this.filter.land = input.value;
      else if (input.name === 'status') this.filter.status = input.value;
      else return;
      this.drawList();
    });
  }

  /** Every asset, as the server sent them. */
  get all(): readonly StudioAsset[] {
    return this.assets;
  }

  /** Takes a new list and draws it. */
  set(assets: StudioAsset[]): void {
    this.assets = assets;
    this.draw();
  }

  /** The assets the filters keep now. */
  shown(): StudioAsset[] {
    return filterAssets(this.assets, this.filter);
  }

  /** Marks the selected asset's row. */
  select(id: string | undefined): void {
    this.selected = id;
    for (const row of this.el.querySelectorAll<HTMLElement>('[data-asset]')) row.classList.toggle('selected', row.dataset.asset === id);
  }

  /** Puts the cursor in the search box. */
  focusSearch(): void {
    this.el.querySelector<HTMLInputElement>('input[name=search]')?.focus();
  }

  private draw(): void {
    const counts = groupCounts(this.assets);
    const lands = [...new Set(this.assets.map((a) => a.land).filter((l): l is string => !!l))].sort();
    const f = this.filter;
    const option = (value: string, label: string, on: string) => `<option value="${escapeHtml(value)}"${value === on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    this.el.innerHTML = `
      <h2 class="dock-title">Assets</h2>
      <div class="asset-chips" role="toolbar" aria-label="Kinds of asset">${GROUPS.filter(([id]) => id === 'all' || counts[id]).map(([id, label]) => `<button type="button" class="chip${id === f.group ? ' on' : ''}" data-group="${id}" aria-pressed="${id === f.group}">${label} <small>${counts[id] ?? 0}</small></button>`).join('')}</div>
      <input type="search" name="search" placeholder="Search names and ids  ( / )" value="${escapeHtml(f.search)}" aria-label="Search assets" />
      <div class="asset-selects">
        <select name="land" aria-label="Land">${option('all', 'Every land', f.land)}${lands.map((l) => option(l, l.replace(/-/g, ' '), f.land)).join('')}</select>
        <select name="status" aria-label="Painted or not">${option('all', 'Any state', f.status)}${option('painted', 'Painted', f.status)}${option('stand-in', 'Stand-in shown', f.status)}${option('missing', 'Not painted yet', f.status)}</select>
      </div>
      <ul class="asset-list" aria-label="Assets"></ul>
      <p class="note asset-more"></p>`;
    this.drawList();
  }

  private drawList(): void {
    const list = this.el.querySelector('.asset-list');
    const more = this.el.querySelector('.asset-more');
    if (!list || !more) return;
    const kept = filterAssets(this.assets, this.filter);
    list.innerHTML = kept.slice(0, SHOWN).map((a) => {
      const thumb = a.thumb ? `<img src="${escapeHtml(a.thumb)}" alt="" loading="lazy" />` : `<span class="no-thumb" aria-hidden="true">${a.group === 'sounds' ? '♪' : '?'}</span>`;
      const feet = a.footprint ? ` · ${a.footprint.width} × ${a.footprint.height}` : '';
      return `<li><button type="button" data-asset="${escapeHtml(a.id)}" class="${a.id === this.selected ? 'selected' : ''}">${thumb}<span><b>${escapeHtml(a.name)}</b><small class="${a.status}">${STATUS_WORDS[a.status]}${feet}</small></span></button></li>`;
    }).join('');
    this.filtered();
    more.textContent = !kept.length ? 'Nothing matches.' : kept.length > SHOWN ? `Showing ${SHOWN} of ${kept.length}. Search to narrow them.` : `${kept.length} shown.`;
  }
}
