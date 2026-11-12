import type { EditKind } from '../kind.ts';
import { floorOf } from '../tiles.ts';
import { BOOKMARK_TEXT } from '../types.ts';

/** A named place to look from, on any floor, and a line on what it tests. */
export const BOOKMARK: EditKind<'bookmark'> = {
  kind: 'bookmark',
  name: 'Bookmark',
  hint: 'Name a place to look from and say what it is for, then click it. The editor lists it to go back to, and the screenshot list reads it.',
  pointer: 'click',
  onFloors: true,
  fields: [
    { key: 'name', label: 'Name', type: 'text', max: BOOKMARK_TEXT.name, default: '' },
    { key: 'note', label: 'What it tests', type: 'text', max: BOOKMARK_TEXT.note, default: '' },
  ],
  shape: '{"kind":"bookmark","at":[x,y],"name":"Terrace rim","note":"what to look for there"}',
  // The middle of the tile clicked, where a player would stand.
  make: (use, v) => ({ kind: 'bookmark', at: [use.at[0] + 0.5, use.at[1] + 0.5], name: String(v.name).trim(), ...(String(v.note).trim() ? { note: String(v.note).trim() } : {}) }),
  check(map, edit) {
    if (typeof edit.name !== 'string' || !edit.name.trim()) return 'Give the bookmark a name.';
    if (edit.name.length > BOOKMARK_TEXT.name) return `Keep the name to ${BOOKMARK_TEXT.name} letters.`;
    if (edit.note !== undefined && (typeof edit.note !== 'string' || edit.note.length > BOOKMARK_TEXT.note)) return `Keep what it tests to ${BOOKMARK_TEXT.note} letters.`;
    const [x, y] = Array.isArray(edit.at) ? edit.at : [NaN, NaN];
    if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= map.width || y >= map.height) return 'That spot is off the edge of this land.';
    return map.bookmarks?.some((b) => b.name === edit.name.trim()) ? 'A bookmark of that name is already here. Pick another name.' : undefined;
  },
  apply(map, edit) {
    (map.bookmarks ??= []).push({ id: edit.id, name: edit.name, x: edit.at[0], y: edit.at[1], floor: floorOf(edit), ...(edit.note ? { note: edit.note } : {}) });
    return true;
  },
  keep: (d) => ({ kind: 'bookmark', at: d.at, name: d.name.trim(), ...(d.note?.trim() ? { note: d.note.trim() } : {}) }),
  words: (e) => `Bookmark “${e.name}”${e.note ? `: ${e.note}` : ''}`,
};
