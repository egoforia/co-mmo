import {
  BEHAVIORS,
  BUILDING_STYLES,
  CREATURES,
  PERSON_LOOKS,
  SEA_CAVE_PIECES,
  SPOTS,
  Tile,
  designSpec,
  editShapes,
  tileAt,
  type RegionMap,
  type TilePoint,
  type WorldEditDraft,
} from '@co-mmo/shared';
import { parseJsonObject } from './ai/chat.ts';
import type { AiServices } from './ai/services.ts';
import type { Budget } from './budget.ts';
import type { PreviewStep, WorldEditor } from './world-editor.ts';

/**
 * AI Map Architect (`world-edit-ai.ts`): translates natural-language map
 * layout instructions into a validated sequence of `WorldEditDraft[]` steps
 * dry-run against a clone of the region map.
 */
export async function planAiWorldEdits(options: {
  regionId: string;
  prompt: string;
  focus?: TilePoint;
  by: string;
  editor: WorldEditor;
  ai?: AiServices;
  budget?: Budget;
}): Promise<{ rationale: string; steps: PreviewStep[]; usd: number }> {
  const { regionId, prompt, by, editor, ai, budget } = options;
  const info = editor.inspectRegion(regionId);
  const map = info.map;
  if (!map) {
    return { rationale: 'There is no land by that name.', steps: [], usd: 0 };
  }

  const center: TilePoint = options.focus && Number.isInteger(options.focus[0]) && Number.isInteger(options.focus[1])
    ? [Math.max(2, Math.min(map.width - 3, options.focus[0])), Math.max(2, Math.min(map.height - 3, options.focus[1]))]
    : findOpenCenter(map);

  let drafts: WorldEditDraft[] = [];
  let rationale = '';
  let usd = 0;

  const model = ai?.godModels()[0];
  if (model && model.provider !== 'offline' && !budget?.paused()) {
    try {
      const styleIds = Object.keys(BUILDING_STYLES);
      const spotIds = Object.keys(SPOTS);
      const creatureIds = Object.keys(CREATURES);
      const pieceIds = SEA_CAVE_PIECES.map((p) => p.id);
      const res = await model.complete({
        system: [
          'You are the AI Map Architect for co-MMO, editing a 2:1 isometric tile region map.',
          `Region "${map.def.name}" (${map.def.biome}), size ${map.width}x${map.height}, focus tile [${center[0]}, ${center[1]}].`,
          `Available building styles: ${styleIds.join(', ')}. House floor sizes: [6,6], [10,8], [14,10].`,
          `Available gathering spots: ${spotIds.join(', ')}.`,
          `Available creatures: ${creatureIds.join(', ')}.`,
          `Available kit pieces: ${pieceIds.slice(0, 20).join(', ')}.`,
          `Building styles the kit can build (for "kit"): ${styleIds.filter((id) => BUILDING_STYLES[id]!.kit).join(', ')}.`,
          `Looks for people: ${PERSON_LOOKS.map((l) => l.id).join(', ')}. Monster ways: ${BEHAVIORS.join(', ')}.`,
          ...landContext(map, center),
          'Produce 1 to 6 WorldEditDraft JSON objects matching the user instruction.',
          'Valid draft shapes:',
          ...editShapes(),
          'Reply with JSON: {"rationale":"short 1-sentence explanation","drafts":[...]}',
        ].join('\n'),
        purpose: 'AI Map Architect',
        messages: [{ role: 'user', content: prompt.trim().slice(0, 1000) }],
        json: true,
        maxTokens: 1200,
      });
      usd = res.usd;
      budget?.spend('chat', model, usd);
      const parsed = parseJsonObject(res.text);
      if (typeof parsed?.rationale === 'string') rationale = parsed.rationale.trim();
      if (Array.isArray(parsed?.drafts)) {
        drafts = (parsed.drafts as WorldEditDraft[]).slice(0, 8);
      }
    } catch {
      // Fall back to deterministic rule-based planner below.
    }
  }

  if (!drafts.length) {
    const built = heuristicPlan(map, prompt, center);
    drafts = built.drafts;
    rationale = built.rationale;
  }

  const preview = editor.previewBatch(regionId, drafts, by);
  return {
    rationale: rationale || `Planned ${preview.steps.length} map edit${preview.steps.length === 1 ? '' : 's'} around (${center[0]}, ${center[1]}).`,
    steps: preview.steps,
    usd,
  };
}

function findOpenCenter(map: RegionMap): TilePoint {
  const cx = Math.floor(map.width / 2);
  const cy = Math.floor(map.height / 2);
  for (let r = 0; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 4 || y < 4 || x >= map.width - 4 || y >= map.height - 4) continue;
        const t = tileAt(map, x, y);
        if (t === Tile.Ground || t === Tile.Path) return [x, y];
      }
    }
  }
  return [cx, cy];
}

function findFreeHouseCorner(map: RegionMap, near: TilePoint, floor: [number, number]): TilePoint {
  const [fw, fh] = floor;
  for (let r = 0; r < 24; r += 2) {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]] as const) {
      const x = Math.max(2, Math.min(map.width - fw - 4, near[0] + dx));
      const y = Math.max(2, Math.min(map.height - fh - 4, near[1] + dy));
      const rect = { x: x - 1, y: y - 1, width: fw + 4, height: fh + 4 };
      const overlaps = map.buildings.some((b) => rect.x < b.x + b.width && b.x < rect.x + rect.width && rect.y < b.y + b.height && b.y < rect.y + rect.height);
      if (!overlaps) return [x, y];
    }
  }
  return [Math.max(2, Math.min(map.width - fw - 4, near[0])), Math.max(2, Math.min(map.height - fh - 4, near[1]))];
}

function findOpenGroundTile(map: RegionMap, near: TilePoint, offset = 0): TilePoint {
  let seen = 0;
  for (let r = 0; r < 18; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = near[0] + dx, y = near[1] + dy;
        if (x < 2 || y < 2 || x >= map.width - 2 || y >= map.height - 2) continue;
        const t = tileAt(map, x, y);
        const hasSpot = map.spots.some((s) => s.x === x && s.y === y);
        if ((t === Tile.Ground || t === Tile.Path) && !hasSpot) {
          if (seen >= offset) return [x, y];
          seen++;
        }
      }
    }
  }
  return near;
}

/** Deterministic rule-based planner so the AI Map Architect works even offline or in tests. */
/** What the architect is told of the land near the focus: its people and buildings by name, so edits can point at them. */
function landContext(map: RegionMap, [cx, cy]: TilePoint): string[] {
  const near = (x: number, y: number) => Math.hypot(x - cx, y - cy) <= 40;
  const people = map.npcs.filter((n) => near(n.x, n.y)).slice(0, 12).map((n) => `${n.name} (target "${n.id}", at [${Math.floor(n.x)}, ${Math.floor(n.y)}]${n.floor ? `, level ${n.floor}` : ''})`);
  const buildings = map.buildings.filter((b) => b.id && near(b.x, b.y)).slice(0, 12).map((b) => `${BUILDING_STYLES[b.style]?.name ?? b.style} (target "${b.id}", at [${b.x}, ${b.y}], ${b.width}x${b.height})`);
  return [
    `People near the focus: ${people.join('; ') || 'none'}.`,
    `Buildings near the focus: ${buildings.join('; ') || 'none'}.`,
    'A "level" field on any edit is the floor it works on (0 the ground); a monster\'s own level is "monsterLevel".',
  ];
}

function heuristicPlan(map: RegionMap, prompt: string, center: TilePoint): { rationale: string; drafts: WorldEditDraft[] } {
  const lower = prompt.toLowerCase();
  const drafts: WorldEditDraft[] = [];
  const notes: string[] = [];

  // Coordinate override if prompt contains (x, y)
  const coordMatch = /\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/.exec(prompt);
  const focus: TilePoint = coordMatch
    ? [Math.max(2, Math.min(map.width - 3, Number(coordMatch[1]))), Math.max(2, Math.min(map.height - 3, Number(coordMatch[2])))]
    : center;

  // 1. House / cottage / building request
  if (/\b(house|cottage|cabin|hut|building|inn|chapel|shrine)\b/.test(lower)) {
    const biomeStyle = Object.values(BUILDING_STYLES).find((s) => s.biome === map.def.biome)?.id ?? Object.keys(BUILDING_STYLES)[0]!;
    const namedStyle = Object.keys(BUILDING_STYLES).find((id) => lower.includes(id.replace(/-/g, ' ')) || lower.includes(id));
    const style = namedStyle ?? biomeStyle;
    const floor: [number, number] = lower.includes('large') ? [14, 10] : lower.includes('medium') ? [10, 8] : [6, 6];
    const corner = findFreeHouseCorner(map, focus, floor);
    drafts.push({ kind: 'house', at: corner, floor, style });
    notes.push(`build a ${BUILDING_STYLES[style]?.name ?? style} at (${corner[0]}, ${corner[1]})`);
    if (/\b(upstairs|upper floor|second floor|storey|basement|cellar)\b/.test(lower)) {
      const up = /\b(two|2)\s+floor/.test(lower) ? 2 : /\b(upstairs|upper|second|storey)\b/.test(lower) ? 1 : 0;
      const down = /\b(basement|cellar|down)\b/.test(lower) ? 1 : 0;
      drafts.push({ kind: 'floors', at: [corner[0] + 1, corner[1] + 1], up: up || 1, down });
      notes.push('add interior floors');
    }
  }

  // 2. Road / path / bridge request
  if (/\b(road|path|bridge|walkway|trail)\b/.test(lower)) {
    const from: TilePoint = [focus[0], focus[1]];
    const to: TilePoint = [Math.min(map.width - 3, focus[0] + 6), focus[1]];
    drafts.push({ kind: 'road', from, to });
    notes.push(`lay a road from (${from[0]}, ${from[1]}) to (${to[0]}, ${to[1]})`);
  }

  // 3. Gathering spot (sage, copper, flax, iron, mushrooms, pine, ice, silver, amethyst, truffle, etc.)
  const matchedSpot = Object.entries(SPOTS).find(([id, def]) => lower.includes(id) || lower.includes(def.name.toLowerCase()));
  if (matchedSpot || /\b(spot|herb|ore|vein|gather|forage)\b/.test(lower)) {
    const spotId = matchedSpot?.[0]
      ?? Object.entries(SPOTS).find(([, s]) => s.biome === map.def.biome)?.[0]
      ?? 'sanctum-sage';
    const at = findOpenGroundTile(map, focus, 1);
    drafts.push({ kind: 'spot', spot: spotId, at });
    notes.push(`place a ${SPOTS[spotId]?.name ?? spotId} gathering spot at (${at[0]}, ${at[1]})`);
  }

  // 4. Creature spawn
  const matchedCreature = Object.entries(CREATURES).find(([id, def]) => lower.includes(id) || lower.includes(def.name.toLowerCase()));
  if (matchedCreature || /\b(spawn|monster|creature|guard)\b/.test(lower)) {
    const creatureId = matchedCreature?.[0] ?? Object.keys(CREATURES)[0]!;
    const countMatch = /(\d+)\s*(x|×|\s)?\s*(monster|creature|crab|mushroom|scarab|wolf|goat|imp|crawler|wisp|roc|morel)/i.exec(prompt);
    const count = countMatch ? Math.max(1, Math.min(8, Number(countMatch[1]))) : 2;
    const at = findOpenGroundTile(map, focus, 2);
    drafts.push({ kind: 'spawn', creature: creatureId, at, count });
    notes.push(`spawn ${count}× ${CREATURES[creatureId]?.name ?? creatureId} at (${at[0]}, ${at[1]})`);
  }

  // 5. Clear monsters
  if (/\b(clear|banish|empty)\b/.test(lower) && /\b(monster|creature|spawn|area)\b/.test(lower)) {
    drafts.push({ kind: 'clear', at: focus, radius: 6 });
    notes.push(`clear monsters within 6 tiles of (${focus[0]}, ${focus[1]})`);
  }

  // 6. Paint trees, rocks, water, or ground clearing
  if (/\b(grove|forest|tree|trees|woods)\b/.test(lower)) {
    const tiles: TilePoint[] = [
      findOpenGroundTile(map, [focus[0] - 2, focus[1] - 1], 0),
      findOpenGroundTile(map, [focus[0] + 2, focus[1] - 1], 1),
      findOpenGroundTile(map, [focus[0], focus[1] + 2], 2),
    ];
    drafts.push({ kind: 'paint', tile: 'tree', tiles });
    notes.push(`plant ${tiles.length} trees around (${focus[0]}, ${focus[1]})`);
  } else if (/\b(pond|pool|lake|water|stream)\b/.test(lower)) {
    const tiles: TilePoint[] = [
      [focus[0], focus[1]],
      [Math.min(map.width - 2, focus[0] + 1), focus[1]],
      [focus[0], Math.min(map.height - 2, focus[1] + 1)],
    ];
    drafts.push({ kind: 'paint', tile: 'water', tiles });
    notes.push(`paint a water pool at (${focus[0]}, ${focus[1]})`);
  } else if (/\b(rock|boulder|stones)\b/.test(lower)) {
    const at = findOpenGroundTile(map, focus, 3);
    drafts.push({ kind: 'paint', tile: 'rock', tiles: [at] });
    notes.push(`place a boulder at (${at[0]}, ${at[1]})`);
  }

  // 7. A light, a person, a kit building, the land's weather
  if (/\b(light|lamp|lantern|glow)\b/.test(lower)) {
    const at = findOpenGroundTile(map, focus, 4);
    drafts.push({ kind: 'light', at, color: /\b(blue|moon)\b/.test(lower) ? '#b8d0ff' : /\b(violet|purple|arcane|magic)\b/.test(lower) ? '#c49bff' : '#ffd27a', radius: 3, ...(/\b(fire|flame|torch)\b/.test(lower) ? { flicker: true } : {}) });
    notes.push(`stand a light at (${at[0]}, ${at[1]})`);
  }
  if (/\b(person|npc|shopkeeper|merchant|villager|smith)\b/.test(lower)) {
    const at = findOpenGroundTile(map, focus, 5);
    const name = /\bnamed\s+([A-Z][a-z]+)/.exec(prompt)?.[1] ?? 'A newcomer';
    drafts.push({ kind: 'person', at, name, look: PERSON_LOOKS[0]!.id, greeting: 'Well met, traveller.' });
    notes.push(`stand ${name} at (${at[0]}, ${at[1]})`);
  }
  if (/\b(tower|castle|fort|keep|battlements?)\b/.test(lower)) {
    const style = Object.values(BUILDING_STYLES).find((s) => s.kit && s.biome === map.def.biome)?.id ?? Object.values(BUILDING_STYLES).find((s) => s.kit)?.id;
    if (style) {
      const at = findFreeHouseCorner(map, focus, [8, 8]);
      drafts.push({ kind: 'kit', at, style, spec: designSpec({ across: 4, deep: 4, storeys: 2, door: 1, windows: 'every-other', roof: 'flat', battlements: true, towers: 'front', dome: false, chimney: false }) });
      notes.push(`raise a towered kit building at (${at[0]}, ${at[1]})`);
    }
  }
  const weather = (['snow', 'rain', 'fog', 'storm', 'sandstorm'] as const).find((w) => lower.includes(w));
  if (weather && /\b(always|weather|land|keep)\b/.test(lower)) {
    drafts.push({ kind: 'land', at: focus, weather });
    notes.push(`keep the land in ${weather}`);
  }

  // Fallback if prompt was generic: lay a short scenic path with a biome gathering spot
  if (!drafts.length) {
    const spotId = Object.entries(SPOTS).find(([, s]) => s.biome === map.def.biome)?.[0] ?? 'sanctum-sage';
    const spotAt = findOpenGroundTile(map, focus, 0);
    drafts.push({
      kind: 'paint',
      tile: 'path',
      tiles: [
        [Math.max(1, spotAt[0] - 1), spotAt[1]],
        [Math.max(1, spotAt[0] - 2), spotAt[1]],
      ],
    });
    drafts.push({ kind: 'spot', spot: spotId, at: spotAt });
    notes.push(`lay a short path leading to a ${SPOTS[spotId]?.name ?? spotId} at (${spotAt[0]}, ${spotAt[1]})`);
  }

  return {
    rationale: `AI Map Architect plan for ${map.def.name}: ${notes.join(', ')}.`,
    drafts,
  };
}
