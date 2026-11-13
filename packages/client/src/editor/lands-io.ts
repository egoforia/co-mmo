import { BIOMES, type BiomeId, type RegionMap, type WorldEdit, type WorldEditDraft } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';

// Lands as a whole, for the editor: any land's map and edits by its id (the
// Plan camera shows lands far from where you stand), a workshop land made
// off the map to build and try things in (the Owner and Stewards), and a
// land's edits saved to a file or laid from one. The land panel's Land tab
// draws the form (`#land-form`), Save (`data-land-export`) and the file
// picker (`data-land-import`); each call answers in words to show.

/** A land as the Plan camera reads it, with every land's name for the land menu. */
export interface LandView {
  region: string;
  regions: { id: string; name: string; biome: string; workshop?: boolean }[];
  /** The looks a new workshop land may take. */
  workshopBiomes: string[];
  map: RegionMap;
  edits: WorldEdit[];
  undone: number;
}

async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(json.message ?? 'The editor could not reach the server. Try again.');
  return json as T;
}

/** A land's map and edits, and the names of all lands. */
export function readLand(token: string, region: string): Promise<LandView> {
  return call<LandView>(token, `/api/world-edits?region=${encodeURIComponent(region)}&includeMap=1`);
}

/** The Land tab's part about workshop lands and files. */
export function landsHtml(biomes: string[]): string {
  return `<h4>Workshop lands</h4>
    <p class="note">A blank land off the map, to build and try things in. Choose it in the Plan camera's land menu, or go there with <code>/teleport</code> and its name.</p>
    <form id="land-form" class="settings">
      <label>Name <input name="land-name" maxlength="40" required placeholder="Stair Lab" /></label>
      <label>Look <select name="land-biome">${biomes.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(BIOMES[b as BiomeId]?.name ?? b)}</option>`).join('')}</select></label>
      <button type="submit">Make a workshop land</button>
    </form>
    <h4>Files</h4>
    <p><button type="button" class="quiet" data-land-export>Save this land's edits to a file</button></p>
    <label class="quiet file-pick">Lay edits from a file <input type="file" accept=".json,application/json" data-land-import /></label>`;
}

/** Makes the land the form names; the new land's id. */
export async function makeLand(token: string, form: HTMLFormElement): Promise<string> {
  const data = new FormData(form);
  const made = await call<{ region: string }>(token, '/api/world-edits/lands', { name: data.get('land-name'), biome: data.get('land-biome') });
  return made.region;
}

/** Downloads a land's edits as a file. */
export async function saveEdits(token: string, region: string): Promise<void> {
  const file = await call<{ name: string; edits: WorldEditDraft[] }>(token, `/api/world-edits?region=${encodeURIComponent(region)}&export=1`);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  link.download = `${region}-edits.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Lays a file's edits on a land, those that fit, as drafts; says how it went. */
export async function layFile(token: string, region: string, input: HTMLInputElement): Promise<string> {
  const text = await input.files?.[0]?.text();
  input.value = '';
  if (!text) return '';
  let drafts: unknown;
  try {
    const file = JSON.parse(text);
    drafts = Array.isArray(file) ? file : file?.edits;
  } catch {
    throw new Error('That file is not a land’s edits. Pick one saved from the editor.');
  }
  if (!Array.isArray(drafts) || !drafts.length) throw new Error('That file has no edits in it.');
  const laid = await call<{ applied: number }>(token, '/api/world-edits/import', { region, drafts });
  const left = drafts.length - laid.applied;
  return `Laid ${laid.applied} edit${laid.applied === 1 ? '' : 's'} as drafts${left ? `; ${left} did not fit this land` : ''}.`;
}
