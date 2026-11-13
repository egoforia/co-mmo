import { describe, expect, it } from 'vitest';
import { EditorCore } from '../src/editor/core.ts';
import { keyAction } from '../src/editor/edit-keys.ts';
import { KEY_LISTS, keysSheetHtml } from '../src/editor/keys-sheet.ts';
import { PANEL_WIDTH, panelWidth } from '../src/editor/panel-size.ts';
import { groups } from '../src/editor/rail.ts';

// The sheet of keys says every key the editor hears, and the keys it names
// do what it says; the panel is as wide as it is dragged, within bounds.

const key = (k: string, more: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...more }) as KeyboardEvent;

describe('the sheet of keys', () => {
  it('opens with ?', () => {
    expect(keyAction(key('?', { shiftKey: true }), new EditorCore(), {})).toEqual({ keys: true });
  });

  it('names every tool group\'s letter, and every other list', () => {
    const core = new EditorCore();
    const html = keysSheetHtml(core);
    for (const g of groups(core)) expect(html).toContain(`<kbd>${g.key.toUpperCase()}</kbd>`);
    for (const [title, keys] of KEY_LISTS) {
      expect(html).toContain(title);
      for (const [, what] of keys) expect(html).toContain(what.replace('&', '&amp;'));
    }
  });

  it('names keys that do what it says', () => {
    const core = new EditorCore();
    expect(keyAction(key('Tab'), core, {})).toEqual({ camera: true });
    expect(keyAction(key('Home'), core, {})).toEqual({ home: true });
    expect(keyAction(key('k', { ctrlKey: true }), core, {})).toEqual({ find: true });
    expect(keyAction(key('/'), core, {})).toEqual({ find: true });
    expect(keyAction(key('d', { ctrlKey: true }), core, {})).toEqual({ bookmark: true });
    expect(keyAction(key('z', { ctrlKey: true }), core, {})).toEqual({ undo: true });
    expect(keyAction(key('y', { ctrlKey: true }), core, {})).toEqual({ redo: true });
    expect(keyAction(key('Z', { ctrlKey: true, shiftKey: true }), core, {})).toEqual({ redo: true });
    expect(keyAction(key('-'), core, {})).toEqual({ zoom: -1 });
    expect(keyAction(key('Escape'), core, {})).toEqual({ escape: true });
  });
});

describe('the panel\'s width', () => {
  it('follows the drag, between its least and most, leaving the world room', () => {
    expect(panelWidth(400, 1600)).toBe(400);
    expect(panelWidth(100, 1600)).toBe(PANEL_WIDTH.least);
    expect(panelWidth(2000, 1600)).toBe(PANEL_WIDTH.most);
    expect(panelWidth(600, 800)).toBe(480);
  });
});
