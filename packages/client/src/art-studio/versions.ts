// The Versions dock, under the Inspector: the picture shown now and every
// earlier one (art-history.ts), side by side as thumbnails. Pick one to lay
// it against the one shown now with a before/after slider, as photo editors
// compare, and put it back for free (art/restore keeps the one it replaces).

import { type ArtItem, when } from '../art-ui/state.ts';
import { escapeHtml } from '../ui.ts';

/** One version in the dock. */
export interface ShownVersion {
  id: string;
  label: string;
  url: string;
}

/** The versions of a picture, the one shown now first. */
export function versionsOf(item: Pick<ArtItem, 'url' | 'versions' | 'shipped'>): ShownVersion[] {
  const list: ShownVersion[] = [];
  if (item.url) list.push({ id: 'now', label: 'Shown now', url: item.url });
  for (const v of item.versions ?? []) list.push({ id: v.id, label: `Put aside ${when(Number.parseInt(v.id, 36))}`, url: v.url });
  if (item.shipped) list.push({ id: 'shipped', label: 'Shipped with the game', url: item.shipped.url });
  return list;
}

/** The dock's HTML, with `chosen` laid against the one shown now. */
export function versionsHtml(item: Pick<ArtItem, 'id' | 'url' | 'versions' | 'shipped'> | undefined, chosen: string | undefined): string {
  if (!item) return '';
  const list = versionsOf(item);
  if (list.length < 2) return `<h2 class="dock-title">Versions</h2><p class="note">${list.length ? 'Only the one shown now. Painting it again keeps this one here.' : 'Nothing painted yet.'}</p>`;
  const pick = list.find((v) => v.id === chosen && v.id !== 'now') ?? list[1]!;
  const now = list[0]!;
  return `
    <h2 class="dock-title">Versions</h2>
    <ol class="versions">${list.map((v) => `<li><button type="button" data-version="${escapeHtml(v.id)}" aria-pressed="${v.id === pick.id}" title="${escapeHtml(v.label)}"><img src="${escapeHtml(v.url)}" alt="" loading="lazy" /><small>${escapeHtml(v.label)}</small></button></li>`).join('')}</ol>
    <div class="compare" style="--cut: 50%">
      <img src="${escapeHtml(pick.url)}" alt="${escapeHtml(pick.label)}" />
      <img class="after" src="${escapeHtml(now.url)}" alt="Shown now" />
      <input type="range" min="0" max="100" value="50" aria-label="Before and after" />
    </div>
    <p class="note compare-words">Left: ${escapeHtml(pick.label)} · right: shown now</p>
    <button type="button" data-restore="${escapeHtml(pick.id)}" data-of="${escapeHtml(item.id)}">Put this one back</button>`;
}
