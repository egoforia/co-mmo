import { landChecks, type Bookmark, type LandChecks, type RegionMap } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import type { WorldScene } from '../world-scene.ts';
import { changesHtml } from './changes.ts';
import type { EditList } from './core.ts';

// The land panel: what the editor's panel shows while nothing is selected,
// the land as a whole in five tabs (`data-land-tab`). Changes lists its
// edits (changes.ts); Places its bookmarks, with Bookmark this view
// (`data-bookmark-view`, Ctrl D); Checks what is wrong with it (shapes, walks,
// pictures not painted yet), run again after each change, with Take a shot;
// Architect the AI Map Architect (architect.ts); Land its settings
// (`data-land-apply`), workshop lands and files (lands-io.ts). Plain HTML
// from state, plus the checks and the shot.

/** The land panel's tabs, in order. */
export const LAND_TABS = [['changes', 'Changes'], ['places', 'Places'], ['checks', 'Checks'], ['architect', 'Architect'], ['land', 'Land']] as const;
export type LandTab = (typeof LAND_TABS)[number][0];

/** What the land panel draws. */
export interface LandPanelState {
  tab: LandTab;
  region: string;
  list: EditList;
  map: RegionMap | undefined;
  /** The Changes tab's filter: 'all' or a rail group. */
  filter: string;
  marks: Bookmark[];
  /** The name Bookmark this view gives. */
  viewName: string;
  checks: LandCheck | undefined;
  /** The land kind's settings as inputs (core.formHtml). */
  landForm: string;
  /** The Architect's card (architectHtml), and how many steps it holds. */
  architect: string;
  steps: number;
  /** Workshop lands and files (landsHtml), under the land's settings. */
  lands: string;
}

/** The land panel: its tabs, each with a count where one helps, and the tab chosen. */
export function landPanelHtml(s: LandPanelState): string {
  const drafts = s.list.edits.filter((e) => e.draft).length;
  const problems = s.checks?.region === s.region ? problemCount(s.checks) : undefined;
  const count: Record<LandTab, string> = { changes: drafts ? ` (${drafts})` : '', places: s.marks.length ? ` (${s.marks.length})` : '', checks: problems ? ` (${problems})` : '', architect: s.steps ? ` (${s.steps})` : '', land: '' };
  const tabs = LAND_TABS.map(([id, name]) => `<button type="button" role="tab" data-land-tab="${id}" aria-selected="${id === s.tab}" class="${id === s.tab ? 'on' : 'quiet'}${id === 'checks' && problems ? ' warn' : ''}">${name}${count[id]}</button>`).join('');
  const body = s.tab === 'changes' ? changesHtml(s.list, s.map, s.filter)
    : s.tab === 'places' ? placesHtml(s.marks, s.viewName)
    : s.tab === 'checks' ? checksHtml(s.checks, s.region)
    : s.tab === 'architect' ? s.architect
    : `<p class="note">The weather here, and where players arrive (the middle of the screen when ticked).</p><div class="settings">${s.landForm}</div><button type="button" data-land-apply>Set for this land</button>${s.lands}`;
  return `<nav class="land-tabs" role="tablist" aria-label="This land">${tabs}</nav><div class="land-tab">${body}</div>`;
}

/** The Places tab: Bookmark this view, then the land's bookmarks with Go. */
function placesHtml(marks: Bookmark[], viewName: string): string {
  return `<div class="bookmark-view"><input name="view-name" type="text" maxlength="40" placeholder="A name for this view" value="${escapeHtml(viewName)}" />
    <button type="button" data-bookmark-view title="Ctrl D">Bookmark this view <kbd>Ctrl D</kbd></button></div>
    ${marks.length ? bookmarksHtml(marks, true) : '<p class="note">No bookmarks here yet.</p>'}`;
}

/** The tiles a check names, to mark them in the world: every "(x, y)" in what it found. */
export function problemTiles(c: LandCheck): [number, number][] {
  return [...c.found.shapes, ...c.found.walks].flatMap((t) => [...t.matchAll(/\((\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]));
}

/** What the last check of a land found. */
export interface LandCheck {
  region: string;
  found: LandChecks;
  unpainted: string[];
}

/** Checks a land: shapes, walks, and pictures not painted yet (`painted` says which are). */
export function checkLand(map: RegionMap, painted: (asset: string) => boolean): LandCheck {
  // Pictures the land shows that have none yet: people, monsters and pieces.
  const assets = new Set([...map.npcs.map((n) => n.asset), ...map.creatures.map((c) => c.asset), ...map.landmarks.map((l) => l.asset)]);
  const unpainted = [...assets].filter((a) => a && !painted(a)).sort();
  return { region: map.def.id, found: landChecks(map), unpainted };
}

/** How many things a check found. */
export function problemCount(c: LandCheck): number {
  return c.found.shapes.length + c.found.walks.length + c.unpainted.length;
}

/** The check and shot buttons, and what the last check of this land found in three short lists. */
export function checksHtml(c: LandCheck | undefined, region: string): string {
  const buttons = '<p class="checks-actions"><button type="button" class="quiet" data-check>Check again</button> <button type="button" class="quiet" data-shot title="Saves a picture of what you see">Take a shot here</button></p>';
  if (!c || c.region !== region) return buttons;
  const list = (title: string, items: string[], none: string) =>
    `<h4>${escapeHtml(title)}</h4>${items.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : `<p class="note">${escapeHtml(none)}</p>`}`;
  const n = c.unpainted.length;
  // The Art tab's two image models: about 4 cents a picture, or 12 for the sharper one.
  const cost = n ? `<p class="note">About $${(n * 0.039).toFixed(2)} to $${(n * 0.12).toFixed(2)} to paint them all in the Art tab.</p>` : '';
  return `<div class="checks-box"><p class="note">Checked after each change. Places it names are marked in red in the world.</p>
    ${list('Shapes', c.found.shapes, 'Every floor, stair and kit building holds together.')}
    ${list('Walks', c.found.walks, 'Everyone and everything here can be walked to from where players arrive.')}
    ${list('Not painted yet', c.unpainted, 'Everything here has its picture.')}${cost}
    </div>${buttons}`;
}

/** A land's bookmarks, each with a button to go there (`data-go`), folded so a long list leaves the edits in sight. */
export function bookmarksHtml(marks: Bookmark[], open: boolean): string {
  if (!marks.length) return '';
  const items = marks.map((b, i) => `<li><span><strong>${escapeHtml(b.name)}</strong>${b.note ? ` <span class="note">${escapeHtml(b.note)}</span>` : ''}</span>
    <button type="button" class="quiet" data-go="${i}" title="Go there">Go</button></li>`);
  return `<details class="bookmarks-box"${open ? ' open' : ''}><summary>Bookmarks (${marks.length})</summary><ol class="bookmarks">${items.join('')}</ol></details>`;
}

/** Saves a picture of the game as it is drawn now (the editor's frame is HTML, so it is not in it); says how it went. */
export function takeShot(scene: WorldScene, region: string, say: (words: string) => void): void {
  const at = scene.playerPosition;
  const name = `co-mmo-${region}-${Math.floor(at.x)}-${Math.floor(at.y)}.png`;
  scene.game.renderer.snapshot((image) => {
    if (!(image instanceof HTMLImageElement)) return say('The picture could not be taken.');
    const link = document.createElement('a');
    link.href = image.src;
    link.download = name;
    link.click();
    say(`Saved ${name}.`);
  });
}
