// The Art tab's "Finding hands" line: what the hand finder is doing on its
// own, or why it is not, linking to the character page's hand finder.

import { type ArtContext, type ArtItem, DIRECTIONS, type WalkerView, artState, esc, go, when } from './state.ts';

/** What the hand finder is doing, as the server tells it. */
export interface HandStatus {
  running: boolean;
  done: number;
  total: number;
  looking?: string;
  last?: { at: number; looked: number; found: number };
  blocked?: string;
  waiting: number;
}

/** The walker a hand picture belongs to: its walks, its standing pictures, or its look. */
export function walkerOf(id: string | undefined, walkers: WalkerView[]): WalkerView | undefined {
  if (!id) return undefined;
  return walkers.find((w) => id === w.id || id.startsWith(`${w.id}-walk-`) || id.startsWith(`${w.id}-stand-`));
}

/** The picture being looked at, in words: a character's walk, or an item's name. */
export function lookingAt(id: string, walkers: WalkerView[], items: ArtItem[]): string {
  const w = walkerOf(id, walkers);
  if (w) {
    const way = DIRECTIONS.find(([d]) => id === `${w.id}-walk-${d}`)?.[1];
    return way ? `${w.name} walking ${way}` : w.name;
  }
  return items.find((i) => i.id === id)?.name ?? 'a held item';
}

/** Where the line leads: the page of the character being looked at, or the first character page. */
export function handLink(status: HandStatus, walkers: WalkerView[]): { href: string; walker?: string } {
  const w = walkerOf(status.looking, walkers);
  return w ? { href: go(w.place.tab, w.place.page), walker: w.id } : { href: go('characters') };
}

const pictures = (n: number) => `${n} ${n === 1 ? 'picture' : 'pictures'}`;

/** The line's words, as HTML; empty when there is nothing to do. */
export function handStatusHtml(status: HandStatus | null, walkers: WalkerView[], items: ArtItem[]): string {
  if (!status || (!status.running && !status.waiting)) return '';
  const link = handLink(status, walkers);
  const open = `<a href="${esc(link.href)}" data-art-go data-hands-focus="${esc(link.walker ?? '')}">`;
  if (status.running && status.total) {
    const now = status.looking ? ` · looking at ${esc(lookingAt(status.looking, walkers, items))}` : '';
    return `${open}<b>Finding hands… ${Math.min(status.done + 1, status.total)} of ${status.total}</b>${now}</a>`;
  }
  const waiting = `${pictures(status.waiting)} ${status.waiting === 1 ? 'is' : 'are'} waiting for their hands or grip to be found.`;
  if (status.blocked) return `${open}<b class="bad">${waiting}</b> ${esc(status.blocked)}</a>`;
  const last = status.last ? ` Last looked ${esc(when(status.last.at))}: found in ${status.last.found} of ${pictures(status.last.looked)}.` : '';
  return `${open}<b>${waiting}</b> The hand finder looks every few minutes.${last}</a>`;
}

/** The line's last status, so a redraw of the tab shows it at once. */
let latest: HandStatus | null = null;

/** Asks the server what the hand finder is doing; null when it cannot say. */
export async function loadHandStatus(context: ArtContext): Promise<HandStatus | null> {
  latest = await context.api<HandStatus>('art/hands/status').catch(() => null);
  return latest;
}

/** The line as the Art tab draws it, hidden when there is nothing to do. */
export function handStatusLine(): string {
  const html = handStatusHtml(latest, artState.data?.walkers ?? [], artState.data?.items ?? []);
  return `<p id="hand-status" class="hand-status"${html ? '' : ' hidden'}>${html}</p>`;
}

/** Keeps the line fresh, and marks the walker being looked at, without touching anything else on the page. */
export async function refreshHandStatus(context: ArtContext): Promise<void> {
  const line = document.getElementById('hand-status');
  if (!line || !artState.data) return;
  await loadHandStatus(context);
  if (!document.body.contains(line)) return;
  const html = handStatusHtml(latest, artState.data.walkers, artState.data.items);
  line.hidden = !html;
  if (line.innerHTML !== html) line.innerHTML = html;
  markLooking();
}

/** Marks the walker card and walk being looked at now. */
function markLooking(): void {
  const id = latest?.running ? latest.looking : undefined;
  const walker = walkerOf(id, artState.data?.walkers ?? [])?.id;
  for (const card of document.querySelectorAll<HTMLElement>('.walker[data-walker]')) card.classList.toggle('looking', card.dataset.walker === walker);
  for (const row of document.querySelectorAll<HTMLElement>('.hand-row[data-art-id]')) row.classList.toggle('looking', row.dataset.artId === id);
}

/** The hand finder to open and scroll to once the page it leads to is drawn: a walker's id, or '' for the first. */
let focusing: string | undefined;

/** Follows the line: the page it leads to is drawn, then its hand finder is opened and focused. */
export function followHandStatus(link: HTMLAnchorElement): void {
  focusing = link.dataset.handsFocus ?? '';
  if (focusing) artState.openHands.add(focusing);
  // The same page is drawn again, so its hand finder is still opened.
  if (location.hash === link.getAttribute('href')) artState.ctx.rerender();
}

/** After the Art tab is drawn: opens, scrolls to and focuses the hand finder the line led to. */
export function focusHandFinder(): void {
  markLooking();
  if (focusing === undefined) return;
  const walker = focusing;
  focusing = undefined;
  const panel = document.querySelector<HTMLDetailsElement>(walker ? `details.hands[data-walker="${CSS.escape(walker)}"]` : 'details.hands');
  if (!panel) return;
  panel.open = true;
  if (panel.dataset.walker) artState.openHands.add(panel.dataset.walker);
  panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
  panel.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
}
