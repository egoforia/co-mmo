// The Inspector's Create with AI section: every paint the selected asset can
// have (its picture, a normal map, a walker's four ways or one way, a walk
// clip, a sound), each opening the same review the pages use (openReview in
// art-ui/dialogs.ts). What is sent and what it costs are shown there, and
// nothing is painted until it is approved.

import { ISO_WAYS, ISO_WAY_LABELS } from '@co-mmo/shared';
import { usd, type ArtOverview, type Ask } from '../art-ui/state.ts';
import { escapeHtml } from '../ui.ts';
import type { StudioAsset } from './browser.ts';

/** One paint the dock offers. */
export interface CreateAction {
  label: string;
  ask: Ask;
  usd: number;
  /** True when the review asks for the Owner's words too. */
  note?: boolean;
}

/** The paints an asset can have, from the Art tab's own overview. */
export function createActions(a: StudioAsset, data: Pick<ArtOverview, 'items' | 'walkers' | 'sounds'>): CreateAction[] | string {
  const walker = data.walkers.find((w) => w.id === a.id);
  if (walker) {
    const missing = ISO_WAYS.filter((d) => !walker.standing[d]?.url).length;
    return [
      { label: missing === 4 ? 'Paint the four ways together' : 'Paint all four ways again, together', ask: { what: 'ways', walker: walker.id }, usd: walker.viewUsd },
      ...ISO_WAYS.map((d): CreateAction => ({ label: `${walker.standing[d]?.url ? 'Paint again' : 'Paint'}: ${ISO_WAY_LABELS[d]}`, ask: { what: 'view', walker: walker.id, direction: d }, usd: walker.viewUsd })),
      ...ISO_WAYS.filter((d) => walker.standing[d]?.url).map((d): CreateAction => ({
        label: `${walker.walks[d] ? 'Make the walk clip again' : 'Make a walk clip'}: ${ISO_WAY_LABELS[d]}`,
        ask: { what: 'clip', walker: walker.id, body: walker.body ?? 'two-legged', direction: d },
        usd: walker.clipUsd,
        note: true,
      })),
    ];
  }
  const sound = data.sounds.find((s) => s.id === a.id);
  if (sound) return sound.makeable ? [{ label: sound.url ? 'Make it again' : 'Make it', ask: { what: 'sound', sound: sound.id }, usd: sound.estimateUsd, note: true }] : sound.why ?? 'It cannot be made here.';
  const item = data.items.find((i) => i.id === a.id);
  if (!item) return 'Paint it on its own page.';
  const paint: CreateAction[] = item.repaintable
    ? [{ label: item.source === 'missing' ? 'Paint it' : item.standIn ? 'Paint its own picture' : 'Paint it again', ask: { what: 'paint', asset: item.id }, usd: item.estimateUsd, note: item.takesNote }]
    : [];
  const normal: CreateAction[] = item.normalPaintable && item.url
    ? [{ label: item.normalMap ? 'Paint its normal map again' : 'Paint a normal map', ask: { what: 'normal', asset: item.id }, usd: item.estimateUsd }]
    : [];
  const all = [...paint, ...normal];
  return all.length ? all : item.why ?? 'It cannot be painted here.';
}

/** The Create with AI section, or nothing while the Art tab's overview is loading. */
export function createDockHtml(a: StudioAsset | undefined, data: Pick<ArtOverview, 'items' | 'walkers' | 'sounds'> | undefined): string {
  if (!a || !data) return '';
  const actions = createActions(a, data);
  const body = typeof actions === 'string'
    ? `<p class="note">${escapeHtml(actions)}</p>`
    : `<p class="create-dock">${actions.map((x) => `<button type="button" class="quiet" data-art-review="${escapeHtml(JSON.stringify(x.ask))}" data-note="${x.note ? 'yes' : ''}">${escapeHtml(x.label)} · about ${usd(x.usd)}</button>`).join('')}</p>`;
  return `
    <h2 class="dock-title">Create with AI</h2>
    <p class="note">Each shows exactly what is sent to the model and what it costs. Nothing is painted until you approve it.</p>
    ${body}`;
}
