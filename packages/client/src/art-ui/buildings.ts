// The Art tab's Buildings page: every building in the world, how it stands
// in the isometric camera (a kit house in its look, or tall walls in its own
// wall texture), the kit house's drawn views, and the furniture inside with
// the tiles each piece blocks. A footprint changed here is a world edit, so
// the world editor's list shows it and can take it back.

import type { buildingKit } from '@co-mmo/shared';
import { loadToken, worldEdits } from '../api.ts';
import { artState, esc } from './state.ts';

/** A piece of furniture as the server lists it. */
export interface FurnitureView {
  asset: string;
  name: string;
  at: [number, number];
  footprint: [number, number];
  floor: number;
  editable: boolean;
}

/** One building as the server lists it (server/src/art-buildings.ts). */
export interface BuildingView {
  region: string;
  regionName: string;
  index: number;
  style: string;
  name: string;
  floor: [number, number];
  stands: 'kit' | 'walls';
  look?: string;
  note: string;
  house?: buildingKit.KitHouseInfo;
  furniture: FurnitureView[];
}

/** Every building, loaded when the page is opened. */
export async function loadBuildings(): Promise<void> {
  artState.buildings = (await artState.ctx.api<{ buildings: BuildingView[] }>('art/buildings')).buildings;
}

/** The Buildings page, as HTML. */
export function buildingsPage(): string {
  const all = artState.buildings ?? [];
  if (!all.length) return '<p class="note">This world has no buildings yet.</p>';
  const lands = [...new Set(all.map((b) => b.regionName))];
  return `
    <p class="note">How each building stands in the game, and the tiles each piece of furniture blocks. A kit house shows the views the server drew for it; the others stand as tall walls in their own wall texture. Changing a footprint is free, shows at once, and the world editor can take it back.</p>
    ${lands.map((land) => `<h2>${esc(land)}</h2><div class="buildings">${all.filter((b) => b.regionName === land).map(buildingHtml).join('')}</div>`).join('')}`;
}

function buildingHtml(b: BuildingView): string {
  return `
    <div class="building">
      <h3>${esc(b.name)}</h3>
      <p class="note">Floor ${b.floor[0]} × ${b.floor[1]} tiles${b.look ? ` · ${esc(b.look)}` : ''}. ${esc(b.note)}</p>
      ${b.house ? viewsHtml(b.house) : ''}
      ${b.furniture.length ? furnitureHtml(b) : '<p class="note">No furniture.</p>'}
    </div>`;
}

function viewsHtml(house: buildingKit.KitHouseInfo): string {
  if (house.status === 'building') return '<p class="note">Its views are still being drawn; look again shortly.</p>';
  if (house.status === 'failed' || !house.views) return `<p class="note bad">Not shown yet: ${esc((house.failed ?? ['its look has textures still to paint']).join(', '))}.</p>`;
  const label = (name: string) => (name === 'outside' ? 'Outside' : `Inside, storey ${name.replace('storey-', '')}`);
  return `<div class="house-views">${Object.entries(house.views).map(([name, v]) => `<figure><a href="${esc(v.picture)}" target="_blank" rel="noopener"><img src="${esc(v.picture)}" alt="${esc(label(name))}"></a><figcaption>${esc(label(name))}</figcaption></figure>`).join('')}</div>`;
}

function furnitureHtml(b: BuildingView): string {
  const row = (f: FurnitureView) => {
    const size = f.editable
      ? `<form class="footprint" data-region="${esc(b.region)}" data-at="${f.at.join(',')}"><input name="w" type="number" min="1" max="8" value="${f.footprint[0]}" aria-label="Tiles across"> × <input name="h" type="number" min="1" max="8" value="${f.footprint[1]}" aria-label="Tiles deep"> <button type="submit" class="quiet">Save</button></form>`
      : `${f.footprint[0]} × ${f.footprint[1]} <small>(on another floor)</small>`;
    return `<tr><td>${esc(f.name)}</td><td>${f.floor === 0 ? 'Ground' : f.floor > 0 ? `${f.floor} up` : `${-f.floor} down`}</td><td>${size}</td></tr>`;
  };
  return `<table class="furniture"><thead><tr><th>Furniture</th><th>Floor</th><th>Tiles it blocks (across × deep)</th></tr></thead><tbody>${b.furniture.map(row).join('')}</tbody></table>`;
}

/** Saves a footprint form; false when the form was not one. */
export function footprintSubmit(form: HTMLFormElement): boolean {
  if (!form.classList.contains('footprint')) return false;
  const data = new FormData(form);
  const footprint: [number, number] = [Number(data.get('w')), Number(data.get('h'))];
  const at = form.dataset.at!.split(',').map(Number) as [number, number];
  const token = loadToken();
  if (!token) return artState.ctx.toast('Sign in again to change the world.'), true;
  void worldEdits(token, form.dataset.region!, { edit: { kind: 'footprint', at, footprint } }).then(
    () => { artState.ctx.toast('Saved. Players see it at once.'); artState.ctx.rerender(); },
    (err: Error) => artState.ctx.toast(err.message),
  );
  return true;
}
