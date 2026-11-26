// The Art Studio's workspaces: each swaps which of today's pages fills the
// middle (Krita and GIMP keep one window and swap what sits in it). Old links
// keep working: a page's hash (#art/items/Weapons, #characters/mara) still
// opens that page, and the workspace follows from it.

/** A workspace, its key (1 to 5), and the pages it holds, first the one it opens on. */
export interface Workspace {
  id: 'paint' | 'animate' | 'place' | 'sound' | 'queue';
  key: number;
  label: string;
  about: string;
  pages: readonly string[];
}

/** The workspaces, in key order. */
export const WORKSPACES: readonly Workspace[] = [
  { id: 'paint', key: 1, label: 'Paint', about: 'Paint and repaint pictures: items, lands, building looks, HUD and effects.', pages: ['items', 'biomes', 'looks', 'hud-fx'] },
  { id: 'animate', key: 2, label: 'Animate', about: 'Characters, monsters and people: their views, walks, hands and skills.', pages: ['entities', 'characters', 'monsters'] },
  { id: 'place', key: 3, label: 'Place', about: 'How things stand on their tiles: buildings and their furniture.', pages: ['buildings'] },
  { id: 'sound', key: 4, label: 'Sound', about: 'Sound effects and music.', pages: ['sounds'] },
  { id: 'queue', key: 5, label: 'Queue', about: 'What is painting, what is next, what is missing, and the Art Director.', pages: ['queue', 'now', 'missing', 'art-director'] },
];

/** Pages that sit in the top bar rather than a workspace. */
export const TOP_PAGES: readonly [string, string][] = [['map-editor', 'Map editor'], ['models', 'AI Models']];

/** The workspace a page belongs to; none for the top bar's pages. */
export function workspaceOf(page: string): Workspace | undefined {
  return WORKSPACES.find((w) => w.pages.includes(page));
}

/** The page a workspace opens: the one last open in it, else its first. */
export function pageFor(w: Workspace, last: Partial<Record<Workspace['id'], string>>): string {
  const kept = last[w.id];
  return kept && w.pages.includes(kept) ? kept : w.pages[0]!;
}

/** The hash that opens a page, as art-ui's go() writes it. */
export function pageHash(page: string): string {
  return `#art/${page}`;
}

/** An asset's place in today's pages (server art-studio/assets.ts), as the hash that opens it with the asset in view. */
export function placeHash(place: { tab: string; page?: string; walker?: string; asset?: string }): string {
  const sub = place.tab === 'hud' ? 'hud-fx' : place.tab;
  const path = `#art/${sub}${place.page ? `/${encodeURIComponent(place.page)}` : ''}`;
  if (place.walker) return `${path}?walker=${encodeURIComponent(place.walker)}`;
  if (place.asset) return `${path}?asset=${encodeURIComponent(place.asset)}`;
  return path;
}
