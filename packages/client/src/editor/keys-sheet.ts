import { escapeHtml } from '../ui.ts';
import type { EditorCore } from './core.ts';
import { groups } from './rail.ts';

// The sheet of edit mode's keys (?, or Keys in the status strip): every key
// the editor hears, in a few short lists, the tool groups' letters read from
// the rail so a new group shows up here too. The keys themselves are heard in
// edit-keys.ts and camera-keys.ts; this only says what they are.

/** The keys that are not a tool group's, by list: [keys, what they do]. */
export const KEY_LISTS: [string, [string, string][]][] = [
  ['Camera', [
    ['Tab', 'Switch between the World and the Plan camera'],
    ['W A S D, arrows', 'Pan (Shift: faster)'],
    ['Wheel, + −', 'Zoom in and out'],
    ['Right drag', 'Pan'],
    ['Home', 'Back to you'],
  ]],
  ['What is picked', [
    ['M', 'Move it'],
    ['Ctrl C', 'Copy it'],
    ['Delete', 'Take it away'],
  ]],
  ['Editor', [
    ['Ctrl K, /', 'Find a tool, a place or an action, or ask the Architect'],
    ['Ctrl D', 'Bookmark this view'],
    ['Ctrl Z', 'Undo'],
    ['Ctrl Y, Ctrl Shift Z', 'Redo'],
    ['?', 'This sheet'],
    ['Esc', 'Stop what a tool is doing, then close the editor'],
  ]],
];

/** The sheet's box, hidden until asked for. */
export function keysSheet(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'editor-keys';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Keys');
  return el;
}

/** The sheet: the tool groups' letters, then the other lists. */
export function keysSheetHtml(core: EditorCore): string {
  const names = new Map(core.tools().map((t) => [t.id, t.name]));
  const tools: [string, string][] = groups(core).map((g) => [g.key.toUpperCase(), `${g.name}: ${g.tools.map((t) => names.get(t) ?? t).join(', ')}`]);
  const list = (title: string, keys: [string, string][], note = '') => `<section><h4>${escapeHtml(title)}</h4>${note}<dl>${keys.map(([k, what]) =>
    `<dt>${k.split(', ').map((one) => `<kbd>${escapeHtml(one)}</kbd>`).join(' ')}</dt><dd>${escapeHtml(what)}</dd>`).join('')}</dl></section>`;
  return `<header><h3>Keys</h3><button type="button" class="quiet" data-keys-close aria-label="Close">×</button></header>
    <div class="lists">${list('Tools', tools, '<p class="note">A letter again: the next tool of its group.</p>')}${KEY_LISTS.map(([title, keys]) => list(title, keys)).join('')}</div>`;
}
