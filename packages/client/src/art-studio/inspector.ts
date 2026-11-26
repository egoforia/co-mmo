// The Inspector dock: the selected asset's properties as a two-column table,
// as Tiled's Properties and Godot's Inspector show them. The shell adds the
// Offset and Hitbox sections (fit-tool.ts, hitbox-tool.ts) and Create with
// AI (create-dock.ts) below it.

import { fitWords } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import type { StudioAsset } from './browser.ts';
import { CANVAS_GROUPS } from './canvas.ts';
import { canvasHash, placeHash } from './workspaces.ts';

const GROUP_WORDS: Record<string, string> = {
  characters: 'Character or person', monsters: 'Monster', items: 'Item', scenery: 'Scenery', pieces: 'Set piece or furniture',
  spots: 'Gathering spot', stairs: 'Stairs or ladder', buildings: 'Building', hud: 'HUD or effect', sounds: 'Sound',
};
const STATUS_WORDS: Record<StudioAsset['status'], string> = { painted: 'Painted', 'stand-in': 'Not painted yet; a stand-in shows', missing: 'Not painted yet' };

/** The Inspector's HTML for an asset, or a hint when none is selected. */
export function inspectorHtml(a: StudioAsset | undefined): string {
  if (!a) return '<h2 class="dock-title">Inspector</h2><p class="note">Pick an asset on the left to see it here.</p>';
  const rows: [string, string][] = [
    ['Name', escapeHtml(a.name)],
    ['Id', `<code>${escapeHtml(a.id)}</code>`],
    ['Kind', escapeHtml(GROUP_WORDS[a.group] ?? a.group)],
    ...(a.land ? [['Land', escapeHtml(a.land.replace(/-/g, ' '))] as [string, string]] : []),
    ...(a.footprint ? [['Footprint', `${a.footprint.width} × ${a.footprint.height} tiles`] as [string, string]] : []),
    ['State', STATUS_WORDS[a.status]],
    ...(a.fit ? [['Fit', escapeHtml(fitWords(a.fit))] as [string, string]] : []),
  ];
  const picture = a.thumb ? `<img class="inspector-picture" src="${escapeHtml(a.thumb)}" alt="${escapeHtml(a.name)}" />` : '';
  const page = a.place.page || a.group === 'sounds' ? `<a class="button" href="${escapeHtml(placeHash(a.place))}">Show it on its page</a>` : '';
  const canvas = CANVAS_GROUPS.includes(a.group) ? `<a class="button" href="${escapeHtml(canvasHash(a.id))}">Stand it on its tiles</a>` : '';
  const open = `<p class="inspector-links">${canvas} ${page}</p>`;
  return `
    <h2 class="dock-title">Inspector</h2>
    ${picture}
    <table class="props"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
    ${open}`;
}
