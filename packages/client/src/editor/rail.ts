import { escapeHtml } from '../ui.ts';
import type { EditorCore, ToolId } from './core.ts';

// The editor's tools in a few groups instead of one wall of buttons: a rail
// of groups (each with a key), and an options bar with the tools of the
// group chosen. Both editor views draw them from here. A kind of edit no
// group names (a new one from a wish) lands in "More", so nothing is lost.
// Buttons: `data-group` on the rail (its `data-tools` lists its tools, for
// playtests and screen readers), `data-tool` in the options bar.

/** A group of tools on the rail. */
export interface ToolGroup {
  id: string;
  name: string;
  /** The letter that chooses it (pressed again: its next tool). */
  key: string;
  /** Its tools, in the order the options bar shows them. */
  tools: ToolId[];
}

/** The rail's groups, in order. */
export const GROUPS: readonly ToolGroup[] = [
  { id: 'select', name: 'Select', key: 'v', tools: ['select', 'area', 'move', 'remove'] },
  { id: 'ground', name: 'Ground', key: 'g', tools: ['paint', 'scenery', 'road'] },
  { id: 'build', name: 'Build', key: 'b', tools: ['kit', 'house', 'storey', 'stairs', 'restyle', 'floors'] },
  { id: 'furnish', name: 'Furnish', key: 'f', tools: ['furniture', 'piece', 'light', 'footprint'] },
  { id: 'life', name: 'Life', key: 'l', tools: ['person', 'quest', 'spawn', 'monsters', 'patrol', 'clear', 'spot'] },
  { id: 'places', name: 'Places', key: 'p', tools: ['bookmark', 'land'] },
];
const MORE: Omit<ToolGroup, 'tools'> = { id: 'more', name: 'More', key: 'm' };

/** The groups with the tools on offer now (set pieces only while their wish is on), and More for any tool no group names. */
export function groups(core: EditorCore): ToolGroup[] {
  const offered = new Set(core.tools().map((t) => t.id));
  const named = new Set(GROUPS.flatMap((g) => g.tools));
  const out = GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => offered.has(t)) })).filter((g) => g.tools.length);
  const rest = [...offered].filter((t) => !named.has(t));
  return rest.length ? [...out, { ...MORE, tools: rest }] : out;
}

/** The group a tool is in. */
export function groupOf(core: EditorCore, tool: ToolId): ToolGroup | undefined {
  return groups(core).find((g) => g.tools.includes(tool));
}

/** The tool a group's key or button chooses: the one last used in it, or its first; pressed while it is chosen, the next one. */
export function toolFor(core: EditorCore, group: ToolGroup, last: Partial<Record<string, ToolId>>, again: boolean): ToolId {
  const now = core.current().id;
  if (again && group.tools.includes(now)) return group.tools[(group.tools.indexOf(now) + 1) % group.tools.length]!;
  const remembered = last[group.id];
  return remembered && group.tools.includes(remembered) ? remembered : group.tools[0]!;
}

/** The rail: one button per group (`data-group`), the chosen one standing out, its key beside its name. */
export function railHtml(core: EditorCore): string {
  const chosen = groupOf(core, core.current().id)?.id;
  return groups(core).map((g) => `<button type="button" data-group="${g.id}" data-tools="${g.tools.join(' ')}" class="${g.id === chosen ? 'on' : 'quiet'}"
      title="${escapeHtml(`${g.name} (${g.key.toUpperCase()})`)}" aria-pressed="${g.id === chosen}">${escapeHtml(g.name)}<kbd>${g.key.toUpperCase()}</kbd></button>`).join('');
}

/** The options bar: the chosen group's tools (`data-tool`), the chosen one standing out. */
export function optionsHtml(core: EditorCore): string {
  const tool = core.current();
  const group = groupOf(core, tool.id);
  if (!group) return '';
  const names = new Map(core.tools().map((t) => [t.id, t.name]));
  return `<span class="seg" role="group" aria-label="${escapeHtml(group.name)} tools">${group.tools.map((t) =>
    `<button type="button" data-tool="${t}" class="${t === tool.id ? 'on' : 'quiet'}" aria-pressed="${t === tool.id}">${escapeHtml(names.get(t) ?? t)}</button>`).join('')}</span>`;
}
