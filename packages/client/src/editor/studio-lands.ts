import { BIOMES, type BiomeId, type WorldEditDraft } from '@co-mmo/shared';
import { loadToken } from '../api.ts';
import { artState, esc } from '../art-ui/state.ts';

// The Studio map's workshop lands: make a blank land off the map to build
// and try things in (the Owner and Stewards), save a land's edits to a file,
// and lay a file's edits on the land shown. The map page (studio-map.ts)
// draws this card and hands it its clicks, files and form.

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = loadToken();
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? 'The editor could not reach the server. Try again.');
  return json as T;
}

/** The card: a new land's name and look, and the land's edits to and from a file. */
export function landsCard(biomes: string[]): string {
  return `<section class="studio-card map-lands-card">
    <h3>Workshop lands</h3>
    <p class="note">A blank land off the map, to build and try things in. Go there with <code>/teleport</code> and its name.</p>
    <form id="map-land-form" class="form">
      <label>Name <input name="name" maxlength="40" required placeholder="Stair Lab"></label>
      <label>Look <select name="biome">${biomes.map((b) => `<option value="${esc(b)}">${esc(BIOMES[b as BiomeId]?.name ?? b)}</option>`).join('')}</select></label>
      <div class="card-actions"><button type="submit">Make a workshop land</button></div>
    </form>
    <div class="card-actions">
      <button type="button" class="quiet" data-map-export>Save this land's edits to a file</button>
      <label class="quiet file-pick">Lay edits from a file <input type="file" accept=".json,application/json" data-map-import></label>
    </div>
  </section>`;
}

/** Makes the land the form names; the new land's id. */
export async function makeLand(form: HTMLFormElement): Promise<string> {
  const data = new FormData(form);
  const made = await call<{ region: string }>('/api/world-edits/lands', { name: data.get('name'), biome: data.get('biome') });
  artState.ctx.toast('The workshop land is ready.');
  return made.region;
}

/** Downloads a land's edits as a file. */
export async function saveEdits(region: string): Promise<void> {
  const file = await call<{ name: string; edits: WorldEditDraft[] }>(`/api/world-edits?region=${encodeURIComponent(region)}&export=1`);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  link.download = `${region}-edits.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Lays a file's edits on a land: those that fit; says how many. */
export async function layFile(region: string, input: HTMLInputElement): Promise<void> {
  const text = await input.files?.[0]?.text();
  input.value = '';
  if (!text) return;
  let drafts: unknown;
  try {
    const file = JSON.parse(text);
    drafts = Array.isArray(file) ? file : file?.edits;
  } catch {
    throw new Error('That file is not a land’s edits. Pick one saved from this page.');
  }
  if (!Array.isArray(drafts) || !drafts.length) throw new Error('That file has no edits in it.');
  const laid = await call<{ applied: number }>('/api/world-edits/import', { region, drafts });
  const left = drafts.length - laid.applied;
  artState.ctx.toast(`Laid ${laid.applied} edit${laid.applied === 1 ? '' : 's'} as drafts${left ? `; ${left} did not fit this land` : ''}.`);
}
