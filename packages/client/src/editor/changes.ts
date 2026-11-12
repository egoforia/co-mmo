import { BUILDING_STYLES, editWords, type EditKindId, type Outline, type RegionMap, type WorldEdit } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import type { EditList } from './core.ts';
import { GROUPS } from './rail.ts';

// The land panel's Changes tab: a land's edits in three lists (drafts only
// editors see, published ones everyone sees, and what the land was built
// with), filtered by the rail's groups. Each row says where it is: hovering
// outlines it in the world (`data-edit`), Go takes the camera there
// (`data-edit-go`, `data-built-go`), × takes an edit out (`data-remove`).

/** The rail group each kind of edit is listed under, the inspector's kinds with the things they change. */
const GROUP_OF: Partial<Record<EditKindId, string>> = {
  ...Object.fromEntries(GROUPS.flatMap((g) => g.tools.map((t) => [t, g.id]))),
  move: 'select', remove: 'select', restyle: 'build', floors: 'build', footprint: 'furnish', monsters: 'life', patrol: 'life', clear: 'life', quest: 'life',
};

/** Where an edit is, on its floor: the box of tiles it covers when it has a size, else the tile it names. */
export function editBox(edit: WorldEdit): (Outline & { level: number }) | undefined {
  const e = edit as WorldEdit & { at?: [number, number]; from?: [number, number]; to?: [number, number] | null; tiles?: [number, number][]; size?: [number, number]; floor?: [number, number] };
  const at = e.at ?? e.from ?? e.tiles?.[0];
  if (!at) return undefined;
  const [w, h] = e.size ?? (e.kind === 'house' && e.floor ? [e.floor[0] + 2, e.floor[1] + 2] : [1, 1]);
  return { x: Math.floor(at[0]), y: Math.floor(at[1]), w, h, level: edit.level ?? 0 };
}

/** One edit's row: what it did, who, and its buttons. */
function row(e: WorldEdit, unlaid: Set<string>): string {
  const box = editBox(e);
  return `<li data-edit="${escapeHtml(e.id)}"${e.draft ? ' class="draft"' : ''}><span>${escapeHtml(editWords(e))}${unlaid.has(e.id) ? ' <em class="note">(no longer fits)</em>' : ''}</span><span class="by">${escapeHtml(e.by)}</span>
    ${box ? `<button type="button" class="quiet" data-edit-go="${escapeHtml(e.id)}" title="Look at it">Go</button>` : '<span></span>'}
    <button type="button" class="quiet" data-remove="${escapeHtml(e.id)}" aria-label="Take this edit out" title="Take this edit out">×</button></li>`;
}

/** What the land was built with: its buildings and people, each with Go (`data-built-go="x,y,floor"`). */
function builtIn(map: RegionMap | undefined, filter: string): string {
  if (!map) return '';
  const things = [
    ...(filter === 'all' || filter === 'build' ? map.buildings.filter((b) => b.id?.startsWith('gen:')).map((b) => ({ name: BUILDING_STYLES[b.style]?.name ?? 'A building', at: `${b.x + Math.floor(b.width / 2)},${b.y + Math.floor(b.height / 2)},0` })) : []),
    ...(filter === 'all' || filter === 'life' ? map.npcs.filter((n) => !n.id.includes(':person')).map((n) => ({ name: n.name, at: `${Math.floor(n.x)},${Math.floor(n.y)},${n.floor ?? 0}` })) : []),
  ];
  if (!things.length) return '';
  return `<details class="built-in"><summary>Built in (${things.length})</summary><ol class="edits">${things.map((t) =>
    `<li><span>${escapeHtml(t.name)}</span><span></span><button type="button" class="quiet" data-built-go="${t.at}" title="Look at it">Go</button><span></span></li>`).join('')}</ol></details>`;
}

/** The Changes tab: a filter by group (`name="changes-filter"`), then drafts, published and built in. */
export function changesHtml(list: EditList, map: RegionMap | undefined, filter: string): string {
  const unlaid = new Set(list.unlaid ?? []);
  const shown = [...list.edits].reverse().filter((e) => filter === 'all' || GROUP_OF[e.kind] === filter);
  const drafts = shown.filter((e) => e.draft);
  const live = shown.filter((e) => !e.draft);
  const options = [['all', 'Every kind'], ...GROUPS.map((g) => [g.id, g.name])].map(([id, name]) => `<option value="${id}"${id === filter ? ' selected' : ''}>${escapeHtml(name!)}</option>`).join('');
  const part = (title: string, items: WorldEdit[], none: string) =>
    `<h4>${escapeHtml(title)} (${items.length})</h4>${items.length ? `<ol class="edits">${items.map((e) => row(e, unlaid)).join('')}</ol>` : `<p class="note">${escapeHtml(none)}</p>`}`;
  return `<label class="filter">Show <select name="changes-filter">${options}</select></label>
    ${part('Drafts', drafts, 'No drafts: nothing waits to be published.')}
    ${part('Published', live, 'Nothing published here yet.')}
    ${builtIn(map, filter)}`;
}
