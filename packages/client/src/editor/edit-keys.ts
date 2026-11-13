import type { EditorCore, ToolId } from './core.ts';
import { groupOf, groups, toolFor } from './rail.ts';

// What a key does in edit mode, worked out apart from the page so it can be
// read in one place (and tested): the finder, the picked thing's keys, a
// group's letter, the camera's keys (Tab switches World and Plan), Esc, and undo and redo. The pan keys
// (camera-keys.ts) are heard before these.

/** What a key asks the editor to do. */
export type KeyAction =
  | { find: true }
  | { camera: true }
  | { keys: true }
  | { pick: 'remove' | 'move' | 'copy' }
  | { tool: ToolId }
  | { home: true }
  | { zoom: 1 | -1 }
  | { escape: true }
  | { bookmark: true }
  | { undo: true }
  | { redo: true };

/** The action a key press asks for, or undefined when it is not one of the editor's keys. */
export function keyAction(event: KeyboardEvent, core: EditorCore, lastTool: Partial<Record<string, ToolId>>): KeyAction | undefined {
  const key = event.key.toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;
  const plain = !(ctrl || event.altKey);
  if ((key === 'k' && ctrl) || (key === '/' && plain)) return { find: true };
  if (key === '?' && plain) return { keys: true };
  if (key === 'd' && ctrl) return { bookmark: true };
  if (key === 'tab' && plain && !event.shiftKey) return { camera: true };
  // What is picked: M moves it, Ctrl C copies it, Delete takes it away.
  if (core.hasPick()) {
    if (key === 'delete' || key === 'backspace') return { pick: 'remove' };
    if (key === 'm' && plain) return { pick: 'move' };
    if (key === 'c' && ctrl) return { pick: 'copy' };
  }
  const group = plain && groups(core).find((g) => g.key === key);
  if (group) return { tool: toolFor(core, group, lastTool, groupOf(core, core.current().id)?.id === group.id) };
  if (key === 'home') return { home: true };
  if ((key === '+' || key === '=' || key === '-') && !ctrl) return { zoom: key === '-' ? -1 : 1 };
  if (key === 'escape') return { escape: true };
  if (!ctrl) return undefined;
  if (key === 'z' && !event.shiftKey) return { undo: true };
  if (key === 'y' || (key === 'z' && event.shiftKey)) return { redo: true };
  return undefined;
}
