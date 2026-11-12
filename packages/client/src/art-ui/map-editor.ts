// In-Studio Region Map Preview & Manual + AI World Editor (#map-editor):
// - Preview any region (Sanctum, Whispering Woods, Sunlit Shore, Mirage Desert, Frostpeak, Mushroom Hollow, + wished lands)
// - Multi-floor inspection (Basement -1, Ground 0, Upper +1/+2), Collision Hitboxes, Gathering Spots, Spawns, and Landmarks
// - All 10 Manual WorldEditDraft pointer tools (look, paint, move, road, house, floors, piece, spot, footprint, spawn, clear) + Undo/Redo
// - AI Map Architect: natural-language prompt -> dry-run preview (POST /api/world-edits/ai-preview) -> visual diff overlay -> batch apply (POST /api/world-edits/ai-apply)

import {
  BUILDING_STYLES,
  CREATURES,
  ITEMS,
  KIT_HOUSE_FLOORS,
  MAX_CLEAR_RADIUS,
  MAX_FLOORS,
  MAX_SPAWN,
  MAX_STROKE,
  PAINT_TILES,
  EDIT_KINDS,
  editWords,
  SPOTS,
  Tile,
  buildingAt,
  houseCorner,
  isBlocking,
  landmarkAt,
  setPiece,
  setPieces,
  tileAt,
  type PaintTile,
  type RegionMap,
  type TilePoint,
  type WorldEdit,
  type WorldEditDraft,
} from '@co-mmo/shared';
import { loadToken } from '../api.ts';
import { artState, esc, usd } from './state.ts';

type StudioMapTool = 'look' | 'paint' | 'move' | 'road' | 'house' | 'floors' | 'piece' | 'spot' | 'footprint' | 'spawn' | 'clear';

const STUDIO_TOOLS: { id: StudioMapTool; name: string; hint: string }[] = [
  { id: 'look', name: '🔍 Look', hint: 'Click any tile on the map to inspect its terrain, building, gathering spot, landmark, or monster spawn.' },
  { id: 'paint', name: '🖌 Paint', hint: 'Click or drag on the map to lay ground, paths, water, trees, rocks, or walls (a path over water becomes a bridge).' },
  { id: 'move', name: '✋ Move', hint: 'Click a tree, rock, water, or set piece to pick it up, then click where it goes (or Take it away).' },
  { id: 'road', name: '🛤 Road', hint: 'Click where the road starts, then click where it ends (runs across, then down, 2 tiles wide).' },
  { id: 'house', name: '🏠 House', hint: 'Click the doorstep tile: the house stands just north of it with its doorway on that spot.' },
  { id: 'floors', name: '🪜 Floors', hint: 'Click a building to give it upper storeys and basements joined by stairs or ladders.' },
  { id: 'spot', name: '⛏ Gathering', hint: 'Click open ground to place one of the 24 regional gathering spots (or choose Take away to remove one).' },
  { id: 'footprint', name: '📐 Footprint', hint: 'Click a piece of furniture or landmark to change how many tiles across × deep it blocks.' },
  { id: 'piece', name: '🗿 Set piece', hint: 'Click open ground or a floor to stand a wished set piece there.' },
  { id: 'spawn', name: '🐉 Monsters', hint: 'Click open ground where monsters should live and respawn.' },
  { id: 'clear', name: '🧹 Clear', hint: 'Click to clear monster spawns within the chosen tile radius.' },
];

const PAINT_NAMES: Record<PaintTile, string> = {
  ground: 'Ground',
  path: 'Path',
  water: 'Water',
  tree: 'Tree',
  rock: 'Rock',
  wall: 'Wall',
};

const BIOME_COLORS: Record<string, { ground: string; path: string; water: string; tree: string; rock: string; wall: string; floor: string }> = {
  sanctum: { ground: '#6b6650', path: '#b8aa86', water: '#3b7a9e', tree: '#3c6e3f', rock: '#8a877c', wall: '#d6ccb2', floor: '#9c8665' },
  'whispering-woods': { ground: '#2f4d2e', path: '#7a6345', water: '#2c5e6e', tree: '#1e3820', rock: '#5b665f', wall: '#5c4632', floor: '#7d6040' },
  'sunlit-shore': { ground: '#c2a86f', path: '#dfd0a8', water: '#2e6f7a', tree: '#4e8248', rock: '#7d7a72', wall: '#c7b89b', floor: '#a68b60' },
  'mirage-desert': { ground: '#b88748', path: '#d9b577', water: '#2d7a78', tree: '#5e783c', rock: '#8f6439', wall: '#d4a36a', floor: '#a87b48' },
  frostpeak: { ground: '#7c99b0', path: '#a8bfd1', water: '#3d6685', tree: '#3b5c63', rock: '#5c6d7e', wall: '#b8cce0', floor: '#786858' },
  'mushroom-hollow': { ground: '#4a3a66', path: '#735d96', water: '#354d73', tree: '#7a4988', rock: '#5c5270', wall: '#6e578c', floor: '#614c78' },
};

export interface RegionInspectPayload {
  region: string;
  regions: { id: string; name: string; biome: string }[];
  map: RegionMap;
  edits: WorldEdit[];
  undone: number;
}

export interface AiPreviewStep {
  draft: WorldEditDraft;
  label: string;
  valid: boolean;
  reason?: string;
  checked: boolean;
}

interface MapStudioState {
  regionId: string;
  floor: number;
  tool: StudioMapTool;
  paint: PaintTile;
  brush: number;
  houseStyle: string;
  houseSize: number;
  floorsUp: number;
  floorsDown: number;
  ladders: boolean;
  piece: string;
  spot: string;
  footprintW: number;
  footprintH: number;
  creature: string;
  count: number;
  radius: number;
  showHitboxes: boolean;
  showSpots: boolean;
  showSpawns: boolean;
  showGrid: boolean;
  hoverTile: TilePoint | null;
  picked: { at: TilePoint; what: string; target?: string } | null;
  roadFrom: TilePoint | null;
  status: string;
  data: RegionInspectPayload | null;
  aiPrompt: string;
  aiSummary: string;
  aiUsd: number;
  aiSteps: AiPreviewStep[];
}

const mapState: MapStudioState = {
  regionId: 'sanctum',
  floor: 0,
  tool: 'look',
  paint: 'path',
  brush: 1,
  houseStyle: Object.values(BUILDING_STYLES).find((s) => s.kit)?.id ?? Object.keys(BUILDING_STYLES)[0]!,
  houseSize: 1,
  floorsUp: 1,
  floorsDown: 0,
  ladders: false,
  piece: '',
  spot: Object.keys(SPOTS)[0] ?? '',
  footprintW: 2,
  footprintH: 2,
  creature: Object.keys(CREATURES)[0] ?? '',
  count: 3,
  radius: 6,
  showHitboxes: false,
  showSpots: true,
  showSpawns: true,
  showGrid: true,
  hoverTile: null,
  picked: null,
  roadFrom: null,
  status: 'Click any tile on the map to inspect or edit it.',
  data: null,
  aiPrompt: '',
  aiSummary: '',
  aiUsd: 0,
  aiSteps: [],
};

async function mapApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = loadToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export async function loadMapEditorData(region = mapState.regionId): Promise<void> {
  mapState.regionId = region;
  mapState.data = await mapApi<RegionInspectPayload>(`/api/world-edits?region=${encodeURIComponent(region)}&includeMap=1`);
}

export function mapEditorPage(): string {
  const d = mapState.data;
  if (!d) return '<p class="note">Loading region map &amp; world editor…</p>';

  const pieces = setPieces();
  if (!pieces.some((p) => p.id === mapState.piece)) mapState.piece = pieces[0]?.id ?? '';
  const creatures = Object.entries(CREATURES).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  if (!mapState.creature && creatures[0]) mapState.creature = creatures[0][0];

  const option = (val: string, label: string, sel: boolean) =>
    `<option value="${esc(val)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;

  const toolDef = STUDIO_TOOLS.find((t) => t.id === mapState.tool) ?? STUDIO_TOOLS[0]!;

  const toolSettings: Record<StudioMapTool, string> = {
    look: '',
    paint: `<label>Tile <select data-map-opt="paint">${PAINT_TILES.map((t) => option(t, PAINT_NAMES[t], t === mapState.paint)).join('')}</select></label>
      <label>Brush <select data-map-opt="brush">${[1, 3, 5].map((n) => option(String(n), `${n} × ${n}`, n === mapState.brush)).join('')}</select></label>`,
    move: mapState.picked ? `<button type="button" class="quiet warn-btn" data-map-take-away>🗑 Take "${esc(mapState.picked.what)}" away</button>` : '',
    road: mapState.roadFrom ? `<span class="tag-pill">Start: [${mapState.roadFrom[0]}, ${mapState.roadFrom[1]}] — click road end</span>` : '',
    house: `<label>Building Look <select data-map-opt="houseStyle">${Object.values(BUILDING_STYLES).map((s) => option(s.id, `${s.name}${s.kit ? ' (kit)' : ''}`, s.id === mapState.houseStyle)).join('')}</select></label>
      <label>Floor Size <select data-map-opt="houseSize">${KIT_HOUSE_FLOORS.map((f, i) => option(String(i), `${f.name} (${f.floor[0]}×${f.floor[1]})`, i === mapState.houseSize)).join('')}</select></label>`,
    floors: `<label>Storeys Up <select data-map-opt="floorsUp">${Array.from({ length: MAX_FLOORS.up + 1 }, (_, n) => option(String(n), String(n), n === mapState.floorsUp)).join('')}</select></label>
      <label>Basements Down <select data-map-opt="floorsDown">${Array.from({ length: MAX_FLOORS.down + 1 }, (_, n) => option(String(n), String(n), n === mapState.floorsDown)).join('')}</select></label>
      <label>Joined By <select data-map-opt="ladders">${option('stairs', 'Stairs', !mapState.ladders)}${option('ladders', 'Ladders', mapState.ladders)}</select></label>`,
    spot: `<label>Gathering Spot <select data-map-opt="spot">${option('', '🗑 Take away spot', !mapState.spot)}${Object.entries(SPOTS)
      .map(([id, s]) => option(id, `${s.name} → ${ITEMS[s.material]?.name ?? s.material}`, id === mapState.spot))
      .join('')}</select></label>`,
    footprint: `<label>Tiles Across (W) <input type="number" min="1" max="8" data-map-opt="footprintW" value="${mapState.footprintW}"></label>
      <label>Tiles Deep (H) <input type="number" min="1" max="8" data-map-opt="footprintH" value="${mapState.footprintH}"></label>`,
    piece: pieces.length
      ? `<label>Set Piece <select data-map-opt="piece">${pieces.map((p) => option(p.id, p.name, p.id === mapState.piece)).join('')}</select></label>`
      : '<small class="note">No wished set pieces active.</small>',
    spawn: `<label>Monster <select data-map-opt="creature">${creatures.map(([id, c]) => option(id, `${c.name} (Lv.${c.level})`, id === mapState.creature)).join('')}</select></label>
      <label>Count <input type="number" min="1" max="${MAX_SPAWN}" data-map-opt="count" value="${mapState.count}"></label>`,
    clear: `<label>Clear Radius <input type="number" min="1" max="${MAX_CLEAR_RADIUS}" data-map-opt="radius" value="${mapState.radius}"></label>`,
  };

  const checkedCount = mapState.aiSteps.filter((s) => s.checked && s.valid).length;

  return `
    <div class="studio-split-header">
      <div>
        <h2>🗺 In-Studio Region Map Preview &amp; World Editor</h2>
        <p class="note">Inspect and edit any region map across all floors using the 10 manual pointer tools or the <b>AI Map Architect</b> (dry-run preview with visual diff markers before applying).</p>
      </div>
      <div class="map-top-controls">
        <label>Region
          <select data-map-region>
            ${d.regions.map((r) => option(r.id, `${r.name} (${r.biome})`, r.id === d.region)).join('')}
          </select>
        </label>
        <div class="btn-group" role="group" aria-label="Floor selector">
          ${[
            [-1, 'Basement -1'],
            [0, 'Ground 0'],
            [1, 'Upper +1'],
            [2, 'Upper +2'],
          ]
            .map(
              ([fl, lbl]) =>
                `<button type="button" class="quiet${mapState.floor === fl ? ' active-pill' : ''}" data-map-floor="${fl}">${esc(String(lbl))}</button>`,
            )
            .join('')}
        </div>
        <label class="check"><input type="checkbox" data-map-layer="showHitboxes"${mapState.showHitboxes ? ' checked' : ''}> Hitboxes</label>
        <label class="check"><input type="checkbox" data-map-layer="showSpots"${mapState.showSpots ? ' checked' : ''}> Gathering Spots (${d.map.spots?.length ?? 0})</label>
        <label class="check"><input type="checkbox" data-map-layer="showSpawns"${mapState.showSpawns ? ' checked' : ''}> NPCs &amp; Spawns</label>
      </div>
    </div>

    <!-- Manual 10-Tool Bar -->
    <div class="studio-card map-toolbar-card">
      <div class="map-tools-row">
        ${STUDIO_TOOLS.map(
          (t) =>
            `<button type="button" class="quiet${mapState.tool === t.id ? ' active-pill' : ''}" data-map-tool="${t.id}">${t.name}</button>`,
        ).join('')}
      </div>
      <div class="map-tool-subbar">
        <span class="note">${esc(toolDef.hint)}</span>
        <div class="map-tool-options">${toolSettings[mapState.tool]}</div>
      </div>
      <div class="map-status-bar">
        <span id="map-status-text">${esc(mapState.status)}</span>
        <span id="map-hover-coords" class="coord-pill">${mapState.hoverTile ? `Tile [${mapState.hoverTile[0]}, ${mapState.hoverTile[1]}]` : 'Point at map'}</span>
      </div>
    </div>

    <div class="map-editor-grid">
      <!-- Left: Interactive Region Map Canvas -->
      <div class="studio-card map-canvas-card">
        <canvas id="studio-map-canvas" width="600" height="600"></canvas>
        <div class="map-legend">
          <span><i class="swatch" style="background:#f2dc6b"></i> Buildings (${d.map.buildings.length})</span>
          <span><i class="swatch" style="background:#a7f070"></i> Gathering Spots (${d.map.spots?.length ?? 0})</span>
          <span><i class="swatch" style="background:#6fc3df"></i> NPCs (${d.map.npcs.length})</span>
          <span><i class="swatch" style="background:#f6757a"></i> Monster Spawns (${d.map.creatures.length})</span>
          <span><i class="swatch" style="background:#2ce8f5"></i> AI Preview Diff (${checkedCount})</span>
        </div>
      </div>

      <!-- Right: AI Map Architect + Edit History -->
      <div class="map-side-stack">
        <section class="studio-card ai-architect-card">
          <h3>✦ AI Map Architect (Dry-Run &amp; Batch Apply)</h3>
          <p class="note">Describe a layout change in plain words. The AI Architect proposes validated <code>WorldEditDraft</code> steps and highlights them in cyan on the map before anything changes.</p>
          <form id="map-ai-form" class="form">
            <textarea name="prompt" rows="3" placeholder="e.g. Lay a stone road from 22,28 to 36,28, add 2 gathering spots along the path, and clear monsters near the road">${esc(mapState.aiPrompt)}</textarea>
            <div class="card-actions">
              <button type="submit">✦ Preview AI Edits (Dry-Run)</button>
              <button type="button" class="quiet" data-map-ai-example="Lay a stone road from the region center east by 8 tiles and place 2 gathering spots beside it">Try Example</button>
            </div>
          </form>

          ${
            mapState.aiSteps.length
              ? `<div class="ai-preview-results">
                  <p class="note"><b>${esc(mapState.aiSummary)}</b> ${mapState.aiUsd ? `<small>(${usd(mapState.aiUsd)})</small>` : ''}</p>
                  <ul class="ai-step-list">
                    ${mapState.aiSteps
                      .map(
                        (s, i) => `
                      <li class="${s.valid ? 'ok' : 'bad'}">
                        <label class="check">
                          <input type="checkbox" data-map-ai-check="${i}"${s.checked && s.valid ? ' checked' : ''}${s.valid ? '' : ' disabled'}>
                          <span><b>${esc(s.label)}</b> <small>(${esc(s.draft.kind)})</small></span>
                        </label>
                        ${s.reason ? `<small class="bad"> — ${esc(s.reason)}</small>` : '<small class="ok"> ✓ Validated</small>'}
                      </li>`,
                      )
                      .join('')}
                  </ul>
                  <div class="card-actions">
                    <button type="button" data-map-ai-apply${checkedCount ? '' : ' disabled'}>✓ Apply ${checkedCount} Checked Step${checkedCount === 1 ? '' : 's'}</button>
                    <button type="button" class="quiet" data-map-ai-discard>Discard Preview</button>
                  </div>
                </div>`
              : ''
          }
        </section>

        <section class="studio-card map-history-card">
          <div class="studio-split-header">
            <h3>Edits in ${esc(d.map.def.name)} (${d.edits.length})</h3>
            <div class="card-actions">
              <button type="button" class="quiet" data-map-undo${d.edits.length ? '' : ' disabled'}>↩ Undo</button>
              <button type="button" class="quiet" data-map-redo${d.undone ? '' : ' disabled'}>↪ Redo (${d.undone})</button>
            </div>
          </div>
          <ol class="edits map-edits-list">
            ${
              d.edits.length
                ? [...d.edits]
                    .reverse()
                    .map(
                      (e) => `
                  <li>
                    <span>${esc(editWords(e))}${d.map?.unlaid?.includes(e.id) ? ' <em class="note">(no longer fits)</em>' : ''}</span>
                    <small class="by">by ${esc(e.by)}</small>
                    <button type="button" class="quiet" data-map-remove="${esc(e.id)}" title="Take this edit out">✕</button>
                  </li>`,
                    )
                    .join('')
                : '<li class="note">No edits in this region yet.</li>'
            }
          </ol>
        </section>
      </div>
    </div>`;
}

export function mountMapEditorCanvas(): void {
  const canvas = document.getElementById('studio-map-canvas') as HTMLCanvasElement | null;
  if (!canvas || !mapState.data) return;
  drawMapEditorCanvas(canvas);
  wireMapEditorEvents(canvas);
}

function drawMapEditorCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  const d = mapState.data;
  if (!ctx || !d) return;
  const map = d.map;
  const w = map.width;
  const h = map.height;
  const cellW = canvas.width / w;
  const cellH = canvas.height / h;

  const palette = BIOME_COLORS[map.def.biome] ?? BIOME_COLORS.sanctum!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tileAt(map, x, y, mapState.floor);
      let fill = palette.ground;
      if (t === Tile.Path || t === Tile.Bridge) fill = palette.path;
      else if (t === Tile.Water) fill = palette.water;
      else if (t === Tile.Tree) fill = palette.tree;
      else if (t === Tile.Rock) fill = palette.rock;
      else if (t === Tile.Wall) fill = palette.wall;
      else if (t === Tile.Floor || t === Tile.Door) fill = palette.floor;
      else if (t === Tile.Blocked) fill = '#3d2847';
      else if (mapState.floor !== 0 && t === Tile.Ground) fill = '#130f1e';

      ctx.fillStyle = fill;
      ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));

      if (mapState.showHitboxes && isBlocking(t)) {
        ctx.fillStyle = t === Tile.Wall || t === Tile.Blocked ? 'rgba(246, 117, 122, 0.42)' : 'rgba(242, 160, 107, 0.36)';
        ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }
  }

  // Subtle tile grid
  if (mapState.showGrid) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= w; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x * cellW, 0);
      ctx.lineTo(x * cellW, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 5) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellH);
      ctx.lineTo(canvas.width, y * cellH);
      ctx.stroke();
    }
  }

  // Buildings outline
  ctx.save();
  ctx.strokeStyle = '#f2dc6b';
  ctx.lineWidth = 1.5;
  for (const b of map.buildings) {
    ctx.strokeRect(b.x * cellW, b.y * cellH, b.width * cellW, b.height * cellH);
  }
  ctx.restore();

  // Gathering Spots
  if (mapState.showSpots && mapState.floor === 0) {
    ctx.save();
    for (const s of map.spots ?? []) {
      ctx.fillStyle = '#a7f070';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc((s.x + 0.5) * cellW, (s.y + 0.5) * cellH, Math.max(4, cellW * 0.45), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // NPCs & Monster Spawns
  if (mapState.showSpawns && mapState.floor === 0) {
    ctx.save();
    for (const n of map.npcs) {
      ctx.fillStyle = '#6fc3df';
      ctx.fillRect((n.x + 0.15) * cellW, (n.y + 0.15) * cellH, cellW * 0.7, cellH * 0.7);
    }
    for (const sp of map.creatures) {
      ctx.fillStyle = '#f6757a';
      ctx.beginPath();
      ctx.arc((sp.x + 0.5) * cellW, (sp.y + 0.5) * cellH, Math.max(4, cellW * 0.45), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // AI Architect Dry-Run Diff Overlay
  ctx.save();
  ctx.strokeStyle = '#2ce8f5';
  ctx.fillStyle = 'rgba(44, 232, 245, 0.28)';
  ctx.lineWidth = 2;
  for (const step of mapState.aiSteps) {
    if (!step.checked || !step.valid) continue;
    const dr = step.draft;
    if (dr.kind === 'paint') {
      for (const [tx, ty] of dr.tiles) {
        ctx.fillRect(tx * cellW, ty * cellH, cellW, cellH);
        ctx.strokeRect(tx * cellW, ty * cellH, cellW, cellH);
      }
    } else if (dr.kind === 'road') {
      const [x0, y0] = dr.from;
      const [x1, y1] = dr.to;
      ctx.fillRect(Math.min(x0, x1) * cellW, y0 * cellH, (Math.abs(x1 - x0) + 1) * cellW, 2 * cellH);
      ctx.fillRect(x1 * cellW, Math.min(y0, y1) * cellH, 2 * cellW, (Math.abs(y1 - y0) + 2) * cellH);
    } else if (dr.kind === 'house') {
      ctx.fillRect(dr.at[0] * cellW, dr.at[1] * cellH, (dr.floor[0] + 2) * cellW, (dr.floor[1] + 2) * cellH);
      ctx.strokeRect(dr.at[0] * cellW, dr.at[1] * cellH, (dr.floor[0] + 2) * cellW, (dr.floor[1] + 2) * cellH);
    } else if ('at' in dr && Array.isArray(dr.at)) {
      ctx.fillRect(dr.at[0] * cellW, dr.at[1] * cellH, cellW, cellH);
      ctx.strokeRect(dr.at[0] * cellW, dr.at[1] * cellH, cellW, cellH);
    }
  }
  ctx.restore();

  // Hover tool cursor outline
  if (mapState.hoverTile) {
    const [hx, hy] = mapState.hoverTile;
    ctx.save();
    ctx.strokeStyle = '#feae34';
    ctx.lineWidth = 2;
    if (mapState.tool === 'paint') {
      const half = Math.floor(mapState.brush / 2);
      ctx.strokeRect((hx - half) * cellW, (hy - half) * cellH, mapState.brush * cellW, mapState.brush * cellH);
    } else if (mapState.tool === 'house') {
      const floor = KIT_HOUSE_FLOORS[mapState.houseSize]!.floor;
      const [cx, cy] = houseCorner([hx, hy], floor);
      ctx.strokeRect(cx * cellW, cy * cellH, (floor[0] + 2) * cellW, (floor[1] + 2) * cellH);
    } else if (mapState.tool === 'clear') {
      const r = mapState.radius;
      ctx.strokeRect((hx - r) * cellW, (hy - r) * cellH, (r * 2 + 1) * cellW, (r * 2 + 1) * cellH);
    } else {
      ctx.strokeRect(hx * cellW, hy * cellH, cellW, cellH);
    }
    ctx.restore();
  }
}

function wireMapEditorEvents(canvas: HTMLCanvasElement): void {
  let paintingStroke: Map<string, TilePoint> | null = null;

  const tileFromMouse = (e: MouseEvent): TilePoint | null => {
    const d = mapState.data;
    if (!d) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * d.map.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * d.map.height);
    if (x < 0 || y < 0 || x >= d.map.width || y >= d.map.height) return null;
    return [x, y];
  };

  const addBrushTiles = (stroke: Map<string, TilePoint>, [cx, cy]: TilePoint) => {
    const d = mapState.data!;
    const half = Math.floor(mapState.brush / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (stroke.size >= MAX_STROKE) return;
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx >= 0 && ty >= 0 && tx < d.map.width && ty < d.map.height) {
          stroke.set(`${tx},${ty}`, [tx, ty]);
        }
      }
    }
  };

  canvas.onmousemove = (e) => {
    const pt = tileFromMouse(e);
    mapState.hoverTile = pt;
    const coordsEl = document.getElementById('map-hover-coords');
    if (coordsEl) coordsEl.textContent = pt ? `Tile [${pt[0]}, ${pt[1]}]` : 'Point at map';
    if (paintingStroke && pt && mapState.tool === 'paint') {
      addBrushTiles(paintingStroke, pt);
    }
    drawMapEditorCanvas(canvas);
  };

  canvas.onmousedown = (e) => {
    const pt = tileFromMouse(e);
    if (!pt || !mapState.data) return;
    if (mapState.tool === 'paint') {
      paintingStroke = new Map();
      addBrushTiles(paintingStroke, pt);
      drawMapEditorCanvas(canvas);
      return;
    }
    void handleTilePress(pt);
  };

  const finishStroke = () => {
    if (!paintingStroke) return;
    const tiles = [...paintingStroke.values()];
    paintingStroke = null;
    if (tiles.length) {
      void sendMapAction({ edit: { kind: 'paint', tile: mapState.paint, tiles } });
    }
  };

  canvas.onmouseup = finishStroke;
  canvas.onmouseleave = () => {
    mapState.hoverTile = null;
    finishStroke();
    drawMapEditorCanvas(canvas);
  };
}

function describeStudioTile(map: RegionMap, [x, y]: TilePoint): string {
  const spot = map.spots?.find((s) => s.x === x && s.y === y);
  if (spot) return `Gathering Spot: ${SPOTS[spot.kind]?.name ?? spot.kind} at [${x}, ${y}]`;
  const npc = map.npcs.find((n) => Math.round(n.x) === x && Math.round(n.y) === y);
  if (npc) return `NPC: ${npc.name} (${npc.id}) at [${x}, ${y}]`;
  const sp = map.creatures.find((s) => Math.round(s.x) === x && Math.round(s.y) === y);
  if (sp) return `Monster Spawn: ${CREATURES[sp.kind]?.name ?? sp.kind} at [${x}, ${y}]`;
  const lm = landmarkAt(map, [x, y]);
  if (lm) return `Landmark / Furniture: ${setPiece(lm.asset)?.name ?? lm.asset} (${lm.footprint.width}×${lm.footprint.height}) at [${x}, ${y}]`;
  const b = buildingAt(map, [x, y]);
  if (b) return `Building: ${BUILDING_STYLES[b.style]?.name ?? b.style} (${b.width}×${b.height}) at [${x}, ${y}]`;
  const t = tileAt(map, x, y, mapState.floor);
  return `Tile [${x}, ${y}] (Floor ${mapState.floor}): ${Tile[t] ?? t}`;
}

async function handleTilePress(at: TilePoint): Promise<void> {
  const d = mapState.data;
  if (!d) return;
  const map = d.map;

  switch (mapState.tool) {
    case 'look': {
      mapState.status = describeStudioTile(map, at);
      const statusEl = document.getElementById('map-status-text');
      if (statusEl) statusEl.textContent = mapState.status;
      return;
    }
    case 'move': {
      if (!mapState.picked) {
        const lm = landmarkAt(map, at, mapState.floor);
        const t = map.tiles[at[1] * map.width + at[0]] as Tile;
        if (!lm && (mapState.floor || ![Tile.Tree, Tile.Rock, Tile.Water].includes(t))) {
          mapState.status = 'Nothing movable at that tile: click a tree, rock, water, or set piece.';
          artState.ctx.rerender();
          return;
        }
        mapState.picked = { at, what: lm ? (setPiece(lm.asset)?.name ?? lm.asset) : Tile[t]!, ...(lm?.id ? { target: lm.id } : {}) };
        mapState.status = `Picked up ${mapState.picked.what} at [${at[0]}, ${at[1]}]. Click destination tile or "Take away".`;
        artState.ctx.rerender();
        return;
      }
      const { at: from, target } = mapState.picked;
      mapState.picked = null;
      await sendMapAction({ edit: { kind: 'move', from, to: at, ...(target ? { target } : {}) } });
      return;
    }
    case 'road': {
      if (!mapState.roadFrom) {
        mapState.roadFrom = at;
        mapState.status = `Road start set at [${at[0]}, ${at[1]}]. Click where the road ends.`;
        artState.ctx.rerender();
        return;
      }
      const from = mapState.roadFrom;
      mapState.roadFrom = null;
      await sendMapAction({ edit: { kind: 'road', from, to: at } });
      return;
    }
    case 'house': {
      const floor = KIT_HOUSE_FLOORS[mapState.houseSize]!.floor;
      await sendMapAction({ edit: { kind: 'house', at: houseCorner(at, floor), floor, style: mapState.houseStyle } });
      return;
    }
    case 'floors': {
      const building = buildingAt(map, at);
      if (!building) {
        mapState.status = 'Click inside a building to set its upper storeys and basements.';
        artState.ctx.rerender();
        return;
      }
      await sendMapAction({
        edit: {
          kind: 'floors',
          at,
          up: mapState.floorsUp,
          down: mapState.floorsDown,
          ...(mapState.ladders ? { ladders: true } : {}),
          ...(building.id ? { target: building.id } : {}),
        },
      });
      return;
    }
    case 'spot': {
      await sendMapAction({ edit: { kind: 'spot', spot: mapState.spot || null, at } });
      return;
    }
    case 'footprint': {
      const lm = landmarkAt(map, at, mapState.floor);
      await sendMapAction({ edit: { kind: 'footprint', at, footprint: [mapState.footprintW, mapState.footprintH], ...(lm?.id ? { target: lm.id } : {}) } });
      return;
    }
    case 'piece': {
      if (!mapState.piece) {
        mapState.status = 'No set piece selected.';
        artState.ctx.rerender();
        return;
      }
      await sendMapAction({ edit: { kind: 'piece', piece: mapState.piece, at } });
      return;
    }
    case 'spawn': {
      if (!mapState.creature) return;
      await sendMapAction({ edit: { kind: 'spawn', creature: mapState.creature, at, count: mapState.count } });
      return;
    }
    case 'clear': {
      await sendMapAction({ edit: { kind: 'clear', at, radius: mapState.radius } });
      return;
    }
    default:
      return;
  }
}

async function sendMapAction(action: Record<string, unknown>): Promise<void> {
  // Tools that work on every floor work on the floor shown; the rest work on the ground, as before.
  const edit = action.edit as WorldEditDraft | undefined;
  if (edit && EDIT_KINDS[edit.kind]?.onFloors) action = { ...action, edit: { ...edit, level: mapState.floor } };
  try {
    await mapApi('/api/world-edits', 'POST', { region: mapState.regionId, ...action });
    await loadMapEditorData(mapState.regionId);
    mapState.status = 'Saved world edit. Players in the region see it immediately.';
    artState.ctx.rerender();
  } catch (err) {
    mapState.status = (err as Error).message;
    artState.ctx.toast((err as Error).message);
    artState.ctx.rerender();
  }
}

export function handleMapEditorClick(t: HTMLButtonElement): boolean {
  if (t.dataset.mapTool) {
    mapState.tool = t.dataset.mapTool as StudioMapTool;
    mapState.picked = null;
    mapState.roadFrom = null;
    artState.ctx.rerender();
    return true;
  }
  if (t.dataset.mapFloor !== undefined) {
    mapState.floor = Number(t.dataset.mapFloor);
    artState.ctx.rerender();
    return true;
  }
  if (t.dataset.mapTakeAway !== undefined && mapState.picked) {
    const { at: from, target } = mapState.picked;
    mapState.picked = null;
    void sendMapAction({ edit: { kind: 'move', from, to: null, ...(target ? { target } : {}) } });
    return true;
  }
  if (t.dataset.mapUndo !== undefined) {
    void sendMapAction({ undo: true });
    return true;
  }
  if (t.dataset.mapRedo !== undefined) {
    void sendMapAction({ redo: true });
    return true;
  }
  if (t.dataset.mapRemove) {
    void sendMapAction({ remove: t.dataset.mapRemove });
    return true;
  }
  if (t.dataset.mapAiExample) {
    mapState.aiPrompt = t.dataset.mapAiExample;
    artState.ctx.rerender();
    return true;
  }
  if (t.dataset.mapAiDiscard !== undefined) {
    mapState.aiSteps = [];
    mapState.aiSummary = '';
    artState.ctx.rerender();
    return true;
  }
  if (t.dataset.mapAiApply !== undefined) {
    const drafts = mapState.aiSteps.filter((s) => s.checked && s.valid).map((s) => s.draft);
    if (!drafts.length) return true;
    t.disabled = true;
    t.textContent = 'Applying…';
    void mapApi<{ applied: number; rejected: { index: number; reason: string }[] }>('/api/world-edits/ai-apply', 'POST', {
      region: mapState.regionId,
      drafts,
    })
      .then(async (res) => {
        mapState.aiSteps = [];
        mapState.aiSummary = '';
        await loadMapEditorData(mapState.regionId);
        artState.ctx.toast(`Applied ${res.applied} AI world edit${res.applied === 1 ? '' : 's'}.`);
        artState.ctx.rerender();
      })
      .catch((err: Error) => {
        t.disabled = false;
        artState.ctx.toast(err.message);
      });
    return true;
  }
  return false;
}

export function handleMapEditorChange(target: HTMLElement): boolean {
  if (target.dataset.mapRegion !== undefined) {
    const region = (target as HTMLSelectElement).value;
    void loadMapEditorData(region).then(() => artState.ctx.rerender());
    return true;
  }
  if (target.dataset.mapLayer) {
    const key = target.dataset.mapLayer as 'showHitboxes' | 'showSpots' | 'showSpawns';
    mapState[key] = (target as HTMLInputElement).checked;
    mountMapEditorCanvas();
    return true;
  }
  if (target.dataset.mapAiCheck !== undefined) {
    const idx = Number(target.dataset.mapAiCheck);
    if (mapState.aiSteps[idx]) {
      mapState.aiSteps[idx]!.checked = (target as HTMLInputElement).checked;
      artState.ctx.rerender();
    }
    return true;
  }
  if (target.dataset.mapOpt) {
    const opt = target.dataset.mapOpt;
    const val = (target as HTMLInputElement | HTMLSelectElement).value;
    if (opt === 'paint') mapState.paint = val as PaintTile;
    else if (opt === 'brush') mapState.brush = Number(val);
    else if (opt === 'houseStyle') mapState.houseStyle = val;
    else if (opt === 'houseSize') mapState.houseSize = Number(val);
    else if (opt === 'floorsUp') mapState.floorsUp = Number(val);
    else if (opt === 'floorsDown') mapState.floorsDown = Number(val);
    else if (opt === 'ladders') mapState.ladders = val === 'ladders';
    else if (opt === 'spot') mapState.spot = val;
    else if (opt === 'footprintW') mapState.footprintW = Math.max(1, Math.min(8, Number(val) || 1));
    else if (opt === 'footprintH') mapState.footprintH = Math.max(1, Math.min(8, Number(val) || 1));
    else if (opt === 'piece') mapState.piece = val;
    else if (opt === 'creature') mapState.creature = val;
    else if (opt === 'count') mapState.count = Math.max(1, Math.min(MAX_SPAWN, Number(val) || 1));
    else if (opt === 'radius') mapState.radius = Math.max(1, Math.min(MAX_CLEAR_RADIUS, Number(val) || 1));
    return true;
  }
  return false;
}

export function handleMapEditorSubmit(form: HTMLFormElement): boolean {
  if (form.id !== 'map-ai-form') return false;
  const prompt = String(new FormData(form).get('prompt') ?? '').trim();
  if (!prompt) return true;
  mapState.aiPrompt = prompt;
  const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '✦ Designing Dry-Run…';
  }
  void mapApi<{
    summary: string;
    usd: number;
    steps: { draft: WorldEditDraft; label: string; valid: boolean; reason?: string }[];
  }>('/api/world-edits/ai-preview', 'POST', { region: mapState.regionId, prompt })
    .then((res) => {
      mapState.aiSummary = res.summary;
      mapState.aiUsd = res.usd;
      mapState.aiSteps = res.steps.map((s) => ({ ...s, checked: s.valid }));
      artState.ctx.toast(`AI Map Architect proposed ${res.steps.length} step${res.steps.length === 1 ? '' : 's'}.`);
      artState.ctx.rerender();
    })
    .catch((err: Error) => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✦ Preview AI Edits (Dry-Run)';
      }
      artState.ctx.toast(err.message);
    });
  return true;
}
