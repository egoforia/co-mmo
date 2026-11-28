// The Centre page (Place workspace): auto-centre for a whole group at once.
// It measures every fittable asset the browser shows, proposes a fit for
// each, and saves the ones left ticked. A proposal the reading is unsure of,
// or one that changes nothing, starts unticked.

import { fitWords, type ArtManifest } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { centreFit, type BaseMeasure } from './auto-centre.ts';
import type { StudioAsset } from './browser.ts';
import { canvasFloor } from './canvas.ts';
import { FIT_GROUPS, SCALE_GROUPS, type FitState } from './fit-tool.ts';

/** The most assets measured at once. */
export const CENTRE_MOST = 200;

/** One row of the page: an asset and what auto-centre proposes. */
export interface Proposal {
  asset: StudioAsset;
  fit?: FitState;
  sure?: 'high' | 'low';
  why?: string;
  /** For a picture with a footprint: whether its base runs at its tiles' angle and way. */
  verdict?: { ok?: boolean; words: string };
}

/** True when a proposal moves the picture from where it stands now by more than a pixel. */
export function proposalMoves(p: Proposal): boolean {
  if (!p.fit) return false;
  const now = p.asset.fit;
  return Math.abs(p.fit.offset[0] - (now?.offset[0] ?? 0)) > 1 || Math.abs(p.fit.offset[1] - (now?.offset[1] ?? 0)) > 1 || Math.abs(p.fit.scale - (now?.scale ?? 1)) > 0.005;
}

/** Proposals for measured assets. */
export function proposals(assets: readonly StudioAsset[], measures: Record<string, BaseMeasure | { why: string }>, manifest: ArtManifest): Proposal[] {
  return assets.map((asset) => {
    const m = measures[asset.id];
    if (!m) return { asset, why: 'Not measured.' };
    if ('why' in m) return { asset, why: m.why };
    const fit = centreFit(m, canvasFloor(asset), manifest[asset.id]?.view === 'isometric', SCALE_GROUPS.includes(asset.group));
    return { asset, fit, sure: m.sure, ...(m.verdict ? { verdict: m.verdict } : {}) };
  });
}

/** The assets the page works on: the fittable ones the browser shows. */
export function centreTargets(shown: readonly StudioAsset[]): StudioAsset[] {
  return shown.filter((a) => FIT_GROUPS.includes(a.group)).slice(0, CENTRE_MOST);
}

/** The page before measuring. */
export function centreIntroHtml(targets: readonly StudioAsset[]): string {
  if (!targets.length) return '<p class="note">Choose set pieces, spots, stairs or scenery in the assets on the left; this page centres all of those shown.</p>';
  return `
    <p>Auto-centre stands where each picture meets the ground on the middle of its tiles, or its feet on their corners when it can find them, and checks that its base runs at its tiles' angle. It reads the pictures' see-through edges, so it is free. You tick which to keep before anything is saved.</p>
    <button type="button" data-centre-measure>Measure the ${targets.length} shown</button>`;
}

/** The page with proposals. */
export function centreHtml(list: readonly Proposal[]): string {
  const ticked = (p: Proposal) => p.sure === 'high' && proposalMoves(p);
  const rows = list.map((p) => {
    const thumb = p.asset.thumb ? `<img src="${escapeHtml(p.asset.thumb)}" alt="" loading="lazy" />` : '';
    const now = p.asset.fit ? fitWords(p.asset.fit) : 'where it was painted';
    const next = p.fit ? fitWords({ offset: p.fit.offset, ...(p.fit.scale !== 1 ? { scale: p.fit.scale } : {}) }) : escapeHtml(p.why ?? '');
    const note = p.fit ? (p.sure === 'low' ? ' <small class="bad">unsure: its foot is in pieces</small>' : proposalMoves(p) ? '' : ' <small>already there</small>') : '';
    const box = p.fit ? `<input type="checkbox" name="centre" value="${escapeHtml(p.asset.id)}"${ticked(p) ? ' checked' : ''} aria-label="Keep ${escapeHtml(p.asset.name)}" />` : '';
    return `<tr><td>${box}</td><td class="centre-thumb">${thumb}</td><td><a href="#art/canvas?asset=${encodeURIComponent(p.asset.id)}">${escapeHtml(p.asset.name)}</a></td><td>${escapeHtml(now)}</td><td>${p.fit ? escapeHtml(next) : next}${note}</td><td>${baseHtml(p.verdict)}</td></tr>`;
  }).join('');
  const count = list.filter(ticked).length;
  const wrong = list.filter((p) => p.verdict?.ok === false).length;
  const summary = wrong ? `<p class="bad">${wrong} of ${list.length} are painted at the wrong angle or turned the wrong way for their tiles. Moving them cannot fix that: paint them again (each is shown before it is paid for).</p>` : '';
  return `
    ${summary}
    <table class="centre-table"><thead><tr><th></th><th></th><th>Asset</th><th>Now</th><th>Auto-centre</th><th>Base</th></tr></thead><tbody>${rows}</tbody></table>
    <p><button type="button" data-centre-save>Save the ${count} ticked</button> <span class="note">Each is a fit like any other: undone in God's View, or put back in the Offset panel.</span></p>`;
}

/** The base check's words for one picture, marked when it is wrong (assets/feet.ts on the server). */
export function baseHtml(verdict: Proposal['verdict']): string {
  if (!verdict) return '';
  if (verdict.ok === false) return `<small class="bad">${escapeHtml(verdict.words)}</small>`;
  return `<small>${escapeHtml(verdict.words)}</small>`;
}
