import { landChecks, type Bookmark, type LandChecks } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import type { WorldScene } from '../world-scene.ts';

// The parts of the editor's panel about the land as a whole: its bookmarks
// (places to go back to), the checks (shapes, walks, pictures not painted
// yet) and Take a shot. Plain HTML from state, plus the two actions.

/** What the last check of a land found. */
export interface LandCheck {
  region: string;
  found: LandChecks;
  unpainted: string[];
}

/** Checks a land drawn on this screen: shapes, walks, and pictures not painted yet; undefined when it is not in sight. */
export function checkLand(scene: WorldScene, region: string): LandCheck | undefined {
  const map = scene.landMap(region);
  if (!map) return undefined;
  // Pictures the land shows that this screen has none of: people, monsters and pieces.
  const assets = new Set([...map.npcs.map((n) => n.asset), ...map.creatures.map((c) => c.asset), ...map.landmarks.map((l) => l.asset)]);
  const unpainted = [...assets].filter((a) => a && !scene.textures.exists(a)).sort();
  return { region, found: landChecks(map), unpainted };
}

/** How many things a check found. */
export function problemCount(c: LandCheck): number {
  return c.found.shapes.length + c.found.walks.length + c.unpainted.length;
}

/** The check and shot buttons, and what the last check of this land found in three short lists. */
export function checksHtml(c: LandCheck | undefined, region: string): string {
  const buttons = '<p class="checks-actions"><button type="button" class="quiet" data-check>Check this land</button> <button type="button" class="quiet" data-shot title="Saves a picture of what you see">Take a shot here</button></p>';
  if (!c || c.region !== region) return buttons;
  const list = (title: string, items: string[], none: string) =>
    `<h4>${escapeHtml(title)}</h4>${items.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : `<p class="note">${escapeHtml(none)}</p>`}`;
  const n = c.unpainted.length;
  // The Art tab's two image models: about 4 cents a picture, or 12 for the sharper one.
  const cost = n ? `<p class="note">About $${(n * 0.039).toFixed(2)} to $${(n * 0.12).toFixed(2)} to paint them all in the Art tab.</p>` : '';
  return `<details class="checks-box" open><summary>Checks</summary>
    ${list('Shapes', c.found.shapes, 'Every floor, stair and kit building holds together.')}
    ${list('Walks', c.found.walks, 'Everyone and everything here can be walked to from where players arrive.')}
    ${list('Not painted yet', c.unpainted, 'Everything here has its picture.')}${cost}
    </details>${buttons}`;
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
