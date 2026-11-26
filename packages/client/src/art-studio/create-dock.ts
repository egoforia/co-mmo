// The Inspector's Create with AI section: every paint the selected asset can
// have (its picture, a normal map, a walker's four ways or one way, a walk
// clip, a sound), each opening the same review the pages use (openReview in
// art-ui/dialogs.ts). What is sent and what it costs are shown there, and
// nothing is painted until it is approved.

import { BUILDING_STYLES, ISO_WAYS, ISO_WAY_LABELS, SPOTS, SPOT_STATES, spotStateArt } from '@co-mmo/shared';
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
  /** Words already written in the review's "Anything to change?", which the Owner can still change. */
  words?: string;
}

/** What Remove its floor asks: the picture painted again from itself, the same but for the floor patch some were painted standing on. */
export const NO_FLOOR_WORDS = 'Remove the floor, ground patch, deck, tile, rug or base plate under it, so it stands straight on the magenta background. Keep everything else exactly the same: the same shape, colours, size, position and angle.';

/** Groups whose pictures stand on tiles, and so may have been painted with a floor under them. */
const FLOORED_GROUPS = ['pieces', 'spots', 'stairs', 'scenery'];

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
  // Painted again from itself (a repaint sends the picture along), told to leave the floor out.
  const floor: CreateAction[] = item.repaintable && item.url && FLOORED_GROUPS.includes(a.group) && sentAlong(item.id)
    ? [{ label: 'Remove its floor', ask: { what: 'paint', asset: item.id }, usd: item.estimateUsd, note: true, words: NO_FLOOR_WORDS }]
    : [];
  const all = [...paint, ...floor, ...normal, ...stateActions(item.id, data.items)];
  return all.length ? all : item.why ?? 'It cannot be painted here.';
}

/**
 * True when painting it again sends its own picture along, so it comes back
 * the same but for what the words change: the game's own kit pictures. A
 * wish's pictures and building furniture are painted from words only.
 */
export function sentAlong(id: string): boolean {
  return !id.includes(':') && !Object.values(BUILDING_STYLES).some((s) => id.startsWith(`${s.id}-`));
}

/** The Create with AI section, or nothing while the Art tab's overview is loading. */
export function createDockHtml(a: StudioAsset | undefined, data: Pick<ArtOverview, 'items' | 'walkers' | 'sounds'> | undefined): string {
  if (!a || !data) return '';
  const actions = createActions(a, data);
  const body = typeof actions === 'string'
    ? `<p class="note">${escapeHtml(actions)}</p>`
    : `<p class="create-dock">${actions.map((x) => `<button type="button" class="quiet" data-art-review="${escapeHtml(JSON.stringify(x.ask))}" data-note="${x.note ? 'yes' : ''}"${x.words ? ` data-note-text="${escapeHtml(x.words)}"` : ''}>${escapeHtml(x.label)} · about ${usd(x.usd)}</button>`).join('')}</p>`;
  return `
    <h2 class="dock-title">Create with AI</h2>
    <p class="note">Each shows exactly what is sent to the model and what it costs. Nothing is painted until you approve it.</p>
    ${body}`;
}

/** The spot kind whose Ready picture `id` is, if it is one. */
export function spotKindOf(id: string): string | undefined {
  return Object.keys(SPOTS).find((k) => SPOTS[k]!.art === id);
}

/** A spot's Picked and Growing pictures not painted yet, in one review; and those of every spot of its land. */
export function stateActions(id: string, items: ArtOverview['items']): CreateAction[] {
  const kind = spotKindOf(id);
  const ready = kind ? items.find((i) => i.id === id) : undefined;
  if (!kind || !ready?.url) return [];
  const missing = (kinds: string[]) => items.filter((i) => kinds.some((k) => SPOT_STATES.some((st) => spotStateArt(k, st.id) === i.id)) && i.repaintable && i.source === 'missing');
  const mine = missing([kind]);
  const land = SPOTS[kind]!.biome;
  const all = missing(Object.keys(SPOTS).filter((k) => SPOTS[k]!.biome === land));
  const cost = (list: typeof items) => list.reduce((n, i) => n + i.estimateUsd, 0);
  return [
    ...(mine.length ? [{ label: `Paint its ${mine.length === 2 ? 'Picked and Growing pictures' : 'missing state picture'}`, ask: { what: 'paint-group', group: `spot-states:${kind}` } as Ask, usd: cost(mine) }] : []),
    ...(all.length > mine.length ? [{ label: `Paint the ${all.length} missing state pictures of every spot in its land`, ask: { what: 'paint-group', group: `spot-states:${land}` } as Ask, usd: cost(all) }] : []),
  ];
}
