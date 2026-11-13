import type { Bookmark } from '@co-mmo/shared';
import type { EditorCore, ToolId } from './core.ts';
import type { Findable } from './palette.ts';
import { groups } from './rail.ts';

// What the editor's finder (palette.ts) lists: every tool on offer (found by
// its name or its group's), the land's bookmarks (by name and note), and the
// editor's actions, each with what to do when it is chosen.

/** Where the finder's things come from, and what choosing each does. */
export interface FindSources {
  core: EditorCore;
  bookmarks: Bookmark[];
  tool: (tool: ToolId) => void;
  go: (bookmark: number) => void;
  /** The editor's actions, by name. */
  actions: [string, () => void][];
}

/** Tools first, then places, then actions. */
export function findables(s: FindSources): Findable[] {
  const groupName = new Map(groups(s.core).flatMap((g) => g.tools.map((t) => [t, g.name] as const)));
  const tools: Findable[] = s.core.tools().map((t) => ({ name: t.name, kind: 'Tool', also: groupName.get(t.id) ?? '', run: () => s.tool(t.id) }));
  const places: Findable[] = s.bookmarks.map((b, i) => ({ name: `Go to ${b.name}`, kind: 'Place', also: b.note ?? '', run: () => s.go(i) }));
  const actions: Findable[] = s.actions.map(([name, run]) => ({ name, kind: 'Do', run }));
  return [...tools, ...places, ...actions];
}
