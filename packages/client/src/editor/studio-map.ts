import { MAX_FLOORS, Tile, isBlocking, tileAt, type Outline, type RegionMap, type TilePoint, type WorldEdit, type WorldEditDraft } from '@co-mmo/shared';
import { loadToken } from '../api.ts';
import { artState, esc, usd } from '../art-ui/state.ts';
import { landsCard, layFile, makeLand, saveEdits } from './studio-lands.ts';
import { EditorCore, draftsHtml, editListHtml, historyHtml, toolsHtml, type ToolStep } from './core.ts';

// The world editor's second view: the Art Studio's map of a whole land
// (Map Preview & Editor), seen from above, any floor, zoomed in or out, with
// the AI Map Architect beside it. The tools, their settings and what they
// make come from the editor core (core.ts), the same as the window in the
// game. The map is the editor's own plan of the land, coloured by tile, never
// game art.

const BIOME_COLORS: Record<string, { ground: string; path: string; water: string; tree: string; rock: string; wall: string; floor: string }> = {
  sanctum: { ground: '#6b6650', path: '#b8aa86', water: '#3b7a9e', tree: '#3c6e3f', rock: '#8a877c', wall: '#d6ccb2', floor: '#9c8665' },
  'whispering-woods': { ground: '#2f4d2e', path: '#7a6345', water: '#2c5e6e', tree: '#1e3820', rock: '#5b665f', wall: '#5c4632', floor: '#7d6040' },
  'sunlit-shore': { ground: '#c2a86f', path: '#dfd0a8', water: '#2e6f7a', tree: '#4e8248', rock: '#7d7a72', wall: '#c7b89b', floor: '#a68b60' },
  'mirage-desert': { ground: '#b88748', path: '#d9b577', water: '#2d7a78', tree: '#5e783c', rock: '#8f6439', wall: '#d4a36a', floor: '#a87b48' },
  frostpeak: { ground: '#7c99b0', path: '#a8bfd1', water: '#3d6685', tree: '#3b5c63', rock: '#5c6d7e', wall: '#b8cce0', floor: '#786858' },
  'mushroom-hollow': { ground: '#4a3a66', path: '#735d96', water: '#354d73', tree: '#7a4988', rock: '#5c5270', wall: '#6e578c', floor: '#614c78' },
};
const TONES: Record<NonNullable<Outline['tone']>, string> = { aim: '#feae34', held: '#6fd08c', warn: '#f6757a' };

/** The map fits this many pixels across when zoomed all the way out. */
const FIT = 600;
/** The most pixels a tile gets, zoomed all the way in. */
const MOST = 32;

export interface RegionInspectPayload {
  region: string;
  regions: { id: string; name: string; biome: string; workshop?: boolean }[];
  /** The looks a new workshop land may take. */
  workshopBiomes: string[];
  map: RegionMap;
  edits: WorldEdit[];
  undone: number;
}

/** One step the AI Map Architect proposes, as the server checked it. */
interface AiStep {
  draft: WorldEditDraft;
  summary: string;
  valid: boolean;
  why?: string;
  checked: boolean;
}

const core = new EditorCore();
const state = {
  regionId: 'sanctum',
  floor: 0,
  /** Pixels per tile; 0 until the first land is shown, then fitted to it. */
  cell: 0,
  /** Which part of the map the scroll box shows, as the fraction across and down of its middle. */
  view: { x: 0.5, y: 0.5 },
  layers: { showHitboxes: false, showSpots: true, showSpawns: true },
  /** New edits go live at once instead of waiting as drafts. */
  live: false,
  hover: null as TilePoint | null,
  status: 'Click any tile on the map to look at it or edit it.',
  data: null as RegionInspectPayload | null,
  ai: { prompt: '', summary: '', usd: 0, steps: [] as AiStep[] },
};

async function mapApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = loadToken();
  const res = await fetch(path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? 'The editor could not reach the server. Try again.');
  return json as T;
}

/** Loads a land's map and edits for the Studio. */
export async function loadMapEditorData(region = state.regionId): Promise<void> {
  if (region !== state.regionId) state.cell = 0;
  state.regionId = region;
  state.data = await mapApi<RegionInspectPayload>(`/api/world-edits?region=${encodeURIComponent(region)}&includeMap=1`);
}

/** The pixels per tile that fit the whole land in view. */
function fitted(map: RegionMap): number {
  return Math.max(1, FIT / Math.max(map.width, map.height));
}

function floorName(n: number): string {
  return n === 0 ? 'Ground' : n > 0 ? `${n} up` : `${-n} down`;
}

/** The Studio's Map Preview & Editor page. */
export function mapEditorPage(): string {
  const d = state.data;
  if (!d) return '<p class="note">Loading the land’s map…</p>';
  if (!state.cell) state.cell = fitted(d.map);
  const option = (val: string, label: string, sel: boolean) => `<option value="${esc(val)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const checked = state.ai.steps.filter((s) => s.checked && s.valid).length;
  const floors = Array.from({ length: MAX_FLOORS.up + MAX_FLOORS.down + 1 }, (_, i) => MAX_FLOORS.up - i);
  const layer = (key: keyof typeof state.layers, label: string) => `<label class="check"><input type="checkbox" data-map-layer="${key}"${state.layers[key] ? ' checked' : ''}> ${label}</label>`;
  return `
    <div class="studio-map">
    <div class="studio-split-header">
      <div>
        <h2>Map Preview &amp; Editor</h2>
        <p class="note">Look at any land from above, on any floor, and change it with the same tools as the editor in the game, or ask the <b>AI Map Architect</b> and check its steps on the map before anything changes.</p>
      </div>
      <div class="map-top-controls">
        <label>Land <select data-map-region>${d.regions.map((r) => option(r.id, `${r.name} (${r.workshop ? 'workshop' : r.biome})`, r.id === d.region)).join('')}</select></label>
        <div class="btn-group" role="group" aria-label="Floor">${floors.map((n) => `<button type="button" class="quiet${state.floor === n ? ' active-pill' : ''}" data-map-floor="${n}">${floorName(n)}</button>`).join('')}</div>
        <div class="btn-group" role="group" aria-label="Zoom">
          <button type="button" class="quiet" data-map-zoom="out" aria-label="Zoom out" title="Zoom out"${state.cell <= fitted(d.map) ? ' disabled' : ''}>−</button>
          <span class="coord-pill">${Math.round((state.cell / fitted(d.map)) * 100)}%</span>
          <button type="button" class="quiet" data-map-zoom="in" aria-label="Zoom in" title="Zoom in"${state.cell >= MOST ? ' disabled' : ''}>+</button>
        </div>
        ${layer('showHitboxes', 'Hitboxes')}${layer('showSpots', `Gathering spots (${d.map.spots?.length ?? 0})`)}${layer('showSpawns', 'People &amp; monsters')}
      </div>
    </div>
    <div class="studio-card map-toolbar-card">
      <div class="map-tools-row">${toolsHtml(core)}</div>
      <div class="map-tool-subbar">
        <span class="note">${esc(core.current().hint)}</span>
        <div class="map-tool-options">${core.settingsHtml()}</div>
      </div>
      <div class="map-status-bar">
        <span id="map-status-text">${esc(state.status)}</span>
        <span id="map-hover-coords" class="coord-pill">${state.hover ? `Tile ${state.hover[0]}, ${state.hover[1]}` : 'Point at the map'}</span>
      </div>
    </div>
    <div class="map-editor-grid">
      <div class="studio-card map-canvas-card">
        <div class="studio-map-scroll"><canvas id="studio-map-canvas" width="${Math.ceil(d.map.width * state.cell)}" height="${Math.ceil(d.map.height * state.cell)}"></canvas></div>
        <div class="map-legend">
          <span><i class="swatch" style="background:#f2dc6b"></i> Buildings (${d.map.buildings.length})</span>
          <span><i class="swatch" style="background:#a7f070"></i> Gathering spots (${d.map.spots?.length ?? 0})</span>
          <span><i class="swatch" style="background:#6fc3df"></i> People (${d.map.npcs.length})</span>
          <span><i class="swatch" style="background:#f6757a"></i> Monsters (${d.map.creatures.length})</span>
          <span><i class="swatch" style="background:#2ce8f5"></i> AI steps (${checked})</span>
        </div>
      </div>
      <div class="map-side-stack">
        <section class="studio-card ai-architect-card">
          <h3>AI Map Architect</h3>
          <p class="note">Say in plain words what to change. The Architect proposes steps, checks each one and marks them on the map in cyan before anything changes.</p>
          <form id="map-ai-form" class="form">
            <textarea name="prompt" rows="3" placeholder="Lay a stone road from 22,28 to 36,28 and put two gathering spots beside it">${esc(state.ai.prompt)}</textarea>
            <div class="card-actions"><button type="submit">Show the steps</button></div>
          </form>
          ${state.ai.steps.length ? `<div class="ai-preview-results">
            <p class="note"><b>${esc(state.ai.summary)}</b> ${state.ai.usd ? `<small>(${usd(state.ai.usd)})</small>` : ''}</p>
            <ul class="ai-step-list">${state.ai.steps.map((s, i) => `<li class="${s.valid ? 'ok' : 'bad'}"><label class="check">
              <input type="checkbox" data-map-ai-check="${i}"${s.checked && s.valid ? ' checked' : ''}${s.valid ? '' : ' disabled'}>
              <span>${esc(s.summary)}</span></label>${s.why ? `<small class="bad"> ${esc(s.why)}</small>` : ''}</li>`).join('')}</ul>
            <div class="card-actions">
              <button type="button" data-map-ai-apply${checked ? '' : ' disabled'}>Make ${checked} step${checked === 1 ? '' : 's'}</button>
              <button type="button" class="quiet" data-map-ai-discard>Never mind</button>
            </div></div>` : ''}
        </section>
        <section class="studio-card map-history-card">
          <div class="studio-split-header"><h3>Edits in ${esc(d.map.def.name)} (${d.edits.length})</h3>${historyHtml(d)}</div>
          ${draftsHtml(d, state.live)}
          <div class="map-edits-list">${editListHtml({ ...d, unlaid: d.map.unlaid })}</div>
        </section>
        ${landsCard(d.workshopBiomes ?? [])}
      </div>
    </div>
    </div>`;
}

/** Draws the map and listens to the pointer on it, after each render. */
export function mountMapEditorCanvas(): void {
  const canvas = document.getElementById('studio-map-canvas') as HTMLCanvasElement | null;
  if (!canvas || !state.data) return;
  const box = canvas.parentElement!;
  box.scrollLeft = state.view.x * canvas.width - box.clientWidth / 2;
  box.scrollTop = state.view.y * canvas.height - box.clientHeight / 2;
  box.onscroll = () => {
    state.view = { x: (box.scrollLeft + box.clientWidth / 2) / canvas.width, y: (box.scrollTop + box.clientHeight / 2) / canvas.height };
  };
  draw(canvas);
  wire(canvas);
}

function draw(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d');
  const d = state.data;
  if (!g || !d) return;
  const { map } = d;
  const c = state.cell;
  const palette = BIOME_COLORS[map.def.biome] ?? BIOME_COLORS.sanctum!;
  const box = (x: number, y: number, w = 1, h = 1) => g.fillRect(x * c, y * c, w * c, h * c);
  g.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = tileAt(map, x, y, state.floor);
      g.fillStyle = t === Tile.Path || t === Tile.Bridge ? palette.path : t === Tile.Water ? palette.water : t === Tile.Tree ? palette.tree
        : t === Tile.Rock ? palette.rock : t === Tile.Wall ? palette.wall : t === Tile.Floor || t === Tile.Door ? palette.floor
          : t === Tile.Blocked ? '#3d2847' : state.floor ? '#130f1e' : palette.ground;
      g.fillRect(x * c, y * c, Math.ceil(c), Math.ceil(c));
      if (state.layers.showHitboxes && isBlocking(t)) {
        g.fillStyle = t === Tile.Wall || t === Tile.Blocked ? 'rgba(246, 117, 122, 0.42)' : 'rgba(242, 160, 107, 0.36)';
        box(x, y);
      }
    }
  }
  // A faint line every five tiles.
  g.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  g.lineWidth = 0.5;
  for (let x = 0; x <= map.width; x += 5) g.strokeRect(x * c, 0, 0, canvas.height);
  for (let y = 0; y <= map.height; y += 5) g.strokeRect(0, y * c, canvas.width, 0);
  g.strokeStyle = '#f2dc6b';
  g.lineWidth = 1.5;
  for (const b of map.buildings) g.strokeRect(b.x * c, b.y * c, b.width * c, b.height * c);
  const dot = (x: number, y: number, colour: string) => {
    g.fillStyle = colour;
    g.beginPath();
    g.arc((x + 0.5) * c, (y + 0.5) * c, Math.max(3, c * 0.45), 0, Math.PI * 2);
    g.fill();
  };
  if (state.layers.showSpots && !state.floor) for (const s of map.spots ?? []) dot(s.x, s.y, '#a7f070');
  if (state.layers.showSpawns) {
    for (const n of map.npcs) if ((n.floor ?? 0) === state.floor) dot(Math.round(n.x), Math.round(n.y), '#6fc3df');
    for (const s of map.creatures) if ((s.floor ?? 0) === state.floor) dot(Math.round(s.x), Math.round(s.y), '#f6757a');
  }
  // The AI Architect's checked steps.
  g.fillStyle = 'rgba(44, 232, 245, 0.32)';
  for (const step of state.ai.steps) {
    if (!step.checked || !step.valid) continue;
    const dr = step.draft;
    if (dr.kind === 'paint') for (const [x, y] of dr.tiles) box(x, y);
    else if (dr.kind === 'road') {
      const [[x0, y0], [x1, y1]] = [dr.from, dr.to];
      box(Math.min(x0, x1), y0, Math.abs(x1 - x0) + 1, 2);
      box(x1, Math.min(y0, y1), 2, Math.abs(y1 - y0) + 2);
    } else if (dr.kind === 'house') box(dr.at[0], dr.at[1], dr.floor[0] + 2, dr.floor[1] + 2);
    else if ('at' in dr && Array.isArray(dr.at)) box(dr.at[0], dr.at[1]);
  }
  if (state.hover) {
    g.lineWidth = 2;
    for (const o of core.outlines(state.regionId, map, state.hover, state.floor)) {
      g.strokeStyle = TONES[o.tone ?? 'aim'];
      g.strokeRect(o.x * c, o.y * c, o.w * c, o.h * c);
    }
  }
}

function wire(canvas: HTMLCanvasElement): void {
  const tileOf = (e: MouseEvent): TilePoint | null => {
    const map = state.data?.map;
    if (!map) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * map.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * map.height);
    return x >= 0 && y >= 0 && x < map.width && y < map.height ? [x, y] : null;
  };
  canvas.onmousemove = (e) => {
    state.hover = tileOf(e);
    const coords = document.getElementById('map-hover-coords');
    if (coords) coords.textContent = state.hover ? `Tile ${state.hover[0]}, ${state.hover[1]}` : 'Point at the map';
    if (state.hover && e.buttons & 1) core.drag(state.regionId, state.data!.map, state.hover);
    draw(canvas);
  };
  canvas.onmousedown = (e) => {
    const at = tileOf(e);
    if (at && state.data) void step(core.press(state.regionId, state.data.map, at, state.floor));
  };
  canvas.onmouseup = () => void step(core.release());
  canvas.onmouseleave = () => {
    state.hover = null;
    void step(core.release());
    draw(canvas);
  };
}

/** Does what a tool asks: says something, or sends the edit it made. */
async function step(s: ToolStep): Promise<void> {
  if (s.drafts) return send({ edits: s.drafts, live: state.live });
  if (s.draft) return send({ edit: s.draft, live: state.live });
  if (s.say !== undefined) {
    state.status = s.say;
    artState.ctx.rerender();
  }
}

async function send(action: Record<string, unknown>): Promise<void> {
  try {
    const path = 'edit' in action || 'edits' in action ? '' : `/${Object.keys(action)[0]}`;
    const body = 'remove' in action ? { id: action.remove } : 'edit' in action || 'edits' in action ? action : {};
    await mapApi('/api/world-edits' + path, 'POST', { region: state.regionId, ...body });
    await loadMapEditorData(state.regionId);
    state.status = 'undo' in action ? 'Taken back.' : 'redo' in action ? 'Made again.' : 'remove' in action ? 'Taken out.'
      : 'publish' in action ? 'Published. Everyone in this land sees it now.' : 'discard' in action ? 'Drafts thrown away. Redo brings them back.'
      : state.live ? 'Done. Everyone in this land sees it now.' : 'Drafted. Only editors see it until you publish.';
  } catch (err) {
    state.status = (err as Error).message;
  }
  artState.ctx.rerender();
}

/** Zooms in or out about the middle of what is shown. */
function zoom(dir: 'in' | 'out'): void {
  const fit = fitted(state.data!.map);
  state.cell = dir === 'in' ? Math.min(MOST, state.cell * 1.5) : Math.max(fit, state.cell / 1.5);
}

/** The page's buttons; false when the button is not the map's. */
export function handleMapEditorClick(t: HTMLButtonElement): boolean {
  if (!t.closest('.studio-map') || !state.data) return false;
  const d = t.dataset;
  if (d.tool) core.choose(d.tool);
  else if (d.mapFloor !== undefined) state.floor = Number(d.mapFloor);
  else if (d.mapZoom) zoom(d.mapZoom === 'in' ? 'in' : 'out');
  else if (d.away !== undefined) return void step(core.takeAway(state.floor)), true;
  else if (d.pick) return void step(core.pickAction(d.pick)), true;
  else if (d.undo !== undefined) return void send({ undo: true }), true;
  else if (d.redo !== undefined) return void send({ redo: true }), true;
  else if (d.remove) return void send({ remove: d.remove }), true;
  else if (d.publish !== undefined) return void send({ publish: true }), true;
  else if (d.discard !== undefined) return void send({ discard: true }), true;
  else if (d.mapAiDiscard !== undefined) state.ai = { ...state.ai, summary: '', steps: [] };
  else if (d.mapAiApply !== undefined) return applyAi(t), true;
  else if (d.mapExport !== undefined) return void saveEdits(state.regionId).catch((err: Error) => artState.ctx.toast(err.message)), true;
  else return false;
  artState.ctx.rerender();
  return true;
}

function applyAi(t: HTMLButtonElement): void {
  const drafts = state.ai.steps.filter((s) => s.checked && s.valid).map((s) => s.draft);
  if (!drafts.length) return;
  t.disabled = true;
  void mapApi<{ applied: number }>('/api/world-edits/ai-apply', 'POST', { region: state.regionId, drafts, live: state.live })
    .then(async (res) => {
      state.ai = { ...state.ai, summary: '', steps: [] };
      await loadMapEditorData(state.regionId);
      artState.ctx.toast(`Made ${res.applied} change${res.applied === 1 ? '' : 's'}.`);
      artState.ctx.rerender();
    })
    .catch((err: Error) => {
      t.disabled = false;
      artState.ctx.toast(err.message);
    });
}

/** The page's pickers; false when the change is not the map's. */
export function handleMapEditorChange(target: HTMLElement): boolean {
  if (!target.closest('.studio-map')) return false;
  const input = target as HTMLInputElement;
  if (input.dataset.mapRegion !== undefined) {
    void loadMapEditorData(input.value).then(() => artState.ctx.rerender());
    return true;
  }
  if (input.name === 'live') {
    state.live = input.checked;
    return true;
  }
  if (input.dataset.mapLayer) {
    state.layers[input.dataset.mapLayer as keyof typeof state.layers] = input.checked;
    mountMapEditorCanvas();
    return true;
  }
  if (input.dataset.mapImport !== undefined) {
    void layFile(state.regionId, input)
      .then(() => loadMapEditorData(state.regionId))
      .then(() => artState.ctx.rerender())
      .catch((err: Error) => artState.ctx.toast(err.message));
    return true;
  }
  if (input.dataset.mapAiCheck !== undefined) {
    const s = state.ai.steps[Number(input.dataset.mapAiCheck)];
    if (s) s.checked = input.checked;
    artState.ctx.rerender();
    return true;
  }
  if (!core.set(input.name, input.value, input.checked)) return false;
  // Settings can change what the tool says below them (the kit building's shape checks).
  if (core.hasNotes()) artState.ctx.rerender();
  return true;
}

/** The AI Map Architect's form; false when the form is not it. */
export function handleMapEditorSubmit(form: HTMLFormElement): boolean {
  if (form.id === 'map-land-form') {
    void makeLand(form)
      .then((region) => loadMapEditorData(region))
      .then(() => artState.ctx.rerender())
      .catch((err: Error) => artState.ctx.toast(err.message));
    return true;
  }
  if (form.id !== 'map-ai-form') return false;
  const prompt = String(new FormData(form).get('prompt') ?? '').trim();
  if (!prompt) return true;
  state.ai.prompt = prompt;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) button.disabled = true;
  void mapApi<{ rationale: string; usd: number; steps: Omit<AiStep, 'checked'>[] }>('/api/world-edits/ai-preview', 'POST', { region: state.regionId, prompt })
    .then((res) => {
      state.ai = { prompt, summary: res.rationale, usd: res.usd, steps: res.steps.map((s) => ({ ...s, checked: s.valid })) };
      artState.ctx.rerender();
    })
    .catch((err: Error) => {
      if (button) button.disabled = false;
      artState.ctx.toast(err.message);
    });
  return true;
}
