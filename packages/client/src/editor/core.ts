import {
  BUILDING_STYLES,
  CREATURES,
  EDIT_KINDS,
  MAX_STROKE,
  SPOTS,
  Tile,
  buildingAt,
  editWords,
  landmarkAt,
  setPiece,
  tileAt,
  type EditContext,
  type EditField,
  type EditKind,
  type EditKindId,
  type FieldValue,
  type Outline,
  type RegionMap,
  type TilePoint,
  type ToolUse,
  type WorldEdit,
  type WorldEditDraft,
} from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';

// The world editor's core, shared by its two views: the window beside the
// game (in-game.ts) and the Studio's map (studio-map.ts). It knows the tools
// (one per kind of edit in the registry, plus Look), their settings, what a
// press, drag or release on a tile makes, what to outline under the pointer,
// and how the edit list reads. The views only turn the pointer into tiles,
// draw the outlines their own way and send what the core makes.

/** A tool: Look, or one kind of edit. */
export type ToolId = EditKindId | 'look';

/** What a press or release asks the view to do: say something, send an edit, or nothing yet. */
export interface ToolStep {
  say?: string;
  draft?: WorldEditDraft;
  /** The land the draft is for. */
  region?: string;
}

/** A land's edits as the editor shows them. */
export interface EditList {
  edits: WorldEdit[];
  undone: number;
  /** Edits that no longer fit the land, by id. */
  unlaid?: string[];
}

const LOOK = { id: 'look' as const, name: 'Look', hint: 'Point at the world to see what is there.' };
const CONTEXT: EditContext = { creatures: CREATURES };

/** Number settings with at most this many choices are drawn as a list to pick from. */
const SHORT_RANGE = 8;

const TILE_NAMES: Partial<Record<Tile, string>> = {
  [Tile.Ground]: 'open ground', [Tile.Path]: 'a path', [Tile.Water]: 'water', [Tile.Tree]: 'a tree', [Tile.Rock]: 'a rock',
  [Tile.Wall]: 'a wall', [Tile.Floor]: 'a floor', [Tile.Door]: 'a doorway', [Tile.Bridge]: 'a bridge', [Tile.Blocked]: 'under a set piece',
};

/** The editor's tools, settings and half-made edits, for one view. */
export class EditorCore {
  tool: ToolId = 'look';
  private readonly values: Partial<Record<EditKindId, Record<string, FieldValue>>> = {};
  /** Mid-tool: the brush stroke, or what was picked up (or where a road starts). */
  private stroke: { region: string; level: number; tiles: Map<string, TilePoint> } | undefined;
  private held: { region: string; at: TilePoint; what: string; target?: string } | undefined;

  /** The tools on offer now: set pieces only while their kit's wish is on. */
  tools(): { id: ToolId; name: string; hint: string }[] {
    const kinds = Object.values(EDIT_KINDS) as EditKind<EditKindId>[];
    return [LOOK, ...kinds.filter((k) => k.available?.() ?? true).map((k) => ({ id: k.kind, name: k.name, hint: k.hint }))];
  }

  /** The chosen tool, falling back to Look when it is no longer on offer. */
  current(): { id: ToolId; name: string; hint: string } {
    const tools = this.tools();
    const found = tools.find((t) => t.id === this.tool);
    if (!found) this.tool = 'look';
    return found ?? LOOK;
  }

  /** Picks a tool, dropping whatever the last one was in the middle of. */
  choose(tool: string): void {
    if (tool === 'look' || Object.hasOwn(EDIT_KINDS, tool)) this.tool = tool as ToolId;
    this.cancel();
  }

  /** Drops whatever the tool was in the middle of. */
  cancel(): void {
    this.stroke = undefined;
    this.held = undefined;
  }

  /** True while a thing is picked up (the move tool's Take it away). */
  holding(): boolean {
    return !!this.held && this.tool === 'move';
  }

  private kind(): EditKind<EditKindId> | undefined {
    return this.tool === 'look' ? undefined : (EDIT_KINDS[this.tool] as unknown as EditKind<EditKindId>);
  }

  /** The current tool's settings, chosen or as they start. */
  settings(kind = this.kind()): Record<string, FieldValue> {
    if (!kind) return {};
    const chosen = (this.values[kind.kind] ??= {});
    const out: Record<string, FieldValue> = {};
    for (const f of kind.fields) out[f.key] = f.key in chosen ? chosen[f.key]! : start(f);
    // A choice whose list changed (a wish switched off) starts again.
    for (const f of kind.fields) if (f.type === 'choice' && !f.choices(CONTEXT).some((c) => c.id === out[f.key])) out[f.key] = start(f);
    return out;
  }

  /** Sets one of the current tool's settings from its input; false when it is not one. */
  set(key: string, raw: string, checked?: boolean): boolean {
    const kind = this.kind();
    const field = kind?.fields.find((f) => f.key === key);
    if (!kind || !field) return false;
    const chosen = (this.values[kind.kind] ??= {});
    if (field.type === 'flag') chosen[key] = !!checked;
    else if (field.type === 'number') chosen[key] = Math.max(field.min, Math.min(field.max, Math.round(Number(raw)) || field.min));
    else chosen[key] = raw;
    return true;
  }

  /** The current tool's settings as HTML: each input named by its setting's key. */
  settingsHtml(): string {
    const kind = this.kind();
    if (!kind) return '';
    const values = this.settings(kind);
    const option = (value: string, label: string, chosen: boolean) => `<option value="${escapeHtml(value)}"${chosen ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const fields = kind.fields.map((f) => {
      const v = values[f.key];
      if (f.type === 'flag') return `<label class="check"><input type="checkbox" name="${f.key}"${v ? ' checked' : ''} /> ${escapeHtml(f.label)}</label>`;
      if (f.type === 'choice') return `<label>${escapeHtml(f.label)} <select name="${f.key}">${f.choices(CONTEXT).map((c) => option(c.id, c.name, c.id === v)).join('')}</select></label>`;
      if (f.max - f.min <= SHORT_RANGE) {
        const counts = Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i);
        return `<label>${escapeHtml(f.label)} <select name="${f.key}">${counts.map((n) => option(String(n), String(n), n === v)).join('')}</select></label>`;
      }
      return `<label>${escapeHtml(f.label)} <input name="${f.key}" type="number" min="${f.min}" max="${f.max}" value="${v}" /></label>`;
    });
    if (this.holding()) fields.push('<button type="button" class="quiet" data-away>Take it away</button>');
    return fields.join('\n');
  }

  /** A press on a tile of a land, on a floor of it. */
  press(region: string, map: RegionMap, at: TilePoint, level: number): ToolStep {
    const kind = this.kind();
    if (!kind) return { say: `${describe(map, at, level)} at ${at[0]}, ${at[1]} in ${map.def.name}.` };
    switch (kind.pointer) {
      case 'drag':
        this.stroke = { region, level, tiles: new Map() };
        this.drag(region, map, at);
        return {};
      case 'two-clicks':
        if (!this.held) {
          this.held = { region, at, what: 'the start' };
          return { say: `Now click where the ${kind.name.toLowerCase()} ends.` };
        }
        if (this.held.region !== region) return { say: 'Keep both ends in one land.' };
        return this.make(kind, { at, from: this.take().at }, region, level);
      case 'pick-then-click': {
        if (!this.held) {
          const piece = landmarkAt(map, at, level);
          const tile = tileAt(map, at[0], at[1], level);
          if (!piece && (level || ![Tile.Tree, Tile.Rock, Tile.Water].includes(tile))) return { say: 'There is nothing there to move: pick a tree, a rock, water or a set piece.' };
          this.held = { region, at, what: piece ? (setPiece(piece.asset)?.name ?? 'the set piece') : TILE_NAMES[tile]!, ...(piece?.id ? { target: piece.id } : {}) };
          return { say: `Picked up ${this.held.what}. Click where it goes, or take it away.` };
        }
        if (this.held.region !== region) return { say: 'Put it down in the same land it came from.' };
        const { at: from, target } = this.take();
        return this.make(kind, { at: from, to: at, ...(target ? { target } : {}) }, region, level);
      }
      default: {
        const target = kind.targets === 'building' ? buildingAt(map, at)?.id : kind.targets === 'piece' ? landmarkAt(map, at, level)?.id : undefined;
        return this.make(kind, { at, ...(target ? { target } : {}) }, region, level);
      }
    }
  }

  /** The pointer dragged over a tile while pressed: a brush stroke grows. */
  drag(region: string, map: RegionMap, [x, y]: TilePoint): void {
    if (!this.stroke || this.stroke.region !== region) return;
    const n = Number(this.settings().brush) || 1;
    const half = Math.floor(n / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (this.stroke.tiles.size >= MAX_STROKE) return;
        if (x + dx >= 0 && y + dy >= 0 && x + dx < map.width && y + dy < map.height) this.stroke.tiles.set(`${x + dx},${y + dy}`, [x + dx, y + dy]);
      }
    }
  }

  /** The pointer let go: a brush stroke is laid. */
  release(): ToolStep {
    const stroke = this.stroke;
    this.stroke = undefined;
    const kind = this.kind();
    if (!stroke?.tiles.size || !kind) return {};
    const tiles = [...stroke.tiles.values()];
    return this.make(kind, { at: tiles[0]!, tiles }, stroke.region, stroke.level);
  }

  /** The move tool's Take it away: what was picked up goes. */
  takeAway(level: number): ToolStep {
    const kind = this.kind();
    if (!this.holding() || !kind) return {};
    const { at, target, region } = this.take();
    return this.make(kind, { at, to: null, ...(target ? { target } : {}) }, region, level);
  }

  private take(): NonNullable<EditorCore['held']> {
    const held = this.held!;
    this.held = undefined;
    return held;
  }

  private make(kind: EditKind<EditKindId>, use: ToolUse, region: string, level: number): ToolStep {
    const draft = kind.make(use, this.settings(kind)) as WorldEditDraft;
    // Tools that work on every floor work on the one shown; the rest work on the ground, as before.
    return { draft: kind.onFloors ? { ...draft, level } : draft, region };
  }

  /** What to outline under the pointer on a land: the stroke so far, then what the tool would touch. */
  outlines(region: string, map: RegionMap, at: TilePoint, level: number): Outline[] {
    const kind = this.kind();
    if (!kind) return [{ x: at[0], y: at[1], w: 1, h: 1 }];
    const stroke = this.stroke?.region === region ? [...this.stroke.tiles.values()].map(([x, y]) => ({ x, y, w: 1, h: 1 })) : [];
    const from = this.held?.region === region ? this.held.at : undefined;
    const aim = kind.outline?.(map, { at, level, ...(from ? { from } : {}) }, this.settings(kind)) ?? [{ x: at[0], y: at[1], w: 1, h: 1 }];
    return [...stroke, ...aim];
  }
}

/** A setting's starting value. */
function start(f: EditField): FieldValue {
  if (f.type !== 'choice') return f.default;
  return f.default?.(CONTEXT) ?? f.choices(CONTEXT)[0]?.id ?? '';
}

/** What stands on a tile of a floor, in a few words. */
export function describe(map: RegionMap, at: TilePoint, level = 0): string {
  const [x, y] = at;
  const spot = !level && map.spots?.find((s) => s.x === x && s.y === y);
  if (spot) return SPOTS[spot.kind]?.name ?? 'A gathering spot';
  const piece = landmarkAt(map, at, level);
  if (piece) return setPiece(piece.asset)?.name ?? `A set piece (${piece.asset})`;
  const npc = !level && map.npcs.find((n) => Math.round(n.x) === x && Math.round(n.y) === y);
  if (npc) return npc.name;
  const building = buildingAt(map, at);
  const words = TILE_NAMES[tileAt(map, x, y, level)] ?? 'Something';
  const name = building && BUILDING_STYLES[building.style]?.name;
  return `${words[0]!.toUpperCase()}${words.slice(1)}${name ? ` of ${name}` : ''}`;
}

/** A land's edits, newest first, each with a button to take it out (`data-remove`). */
export function editListHtml(list: EditList): string {
  const unlaid = new Set(list.unlaid ?? []);
  const items = [...list.edits].reverse().map((e) => `<li><span>${escapeHtml(editWords(e))}${unlaid.has(e.id) ? ' <em class="note">(no longer fits)</em>' : ''}</span><span class="by">${escapeHtml(e.by)}</span>
      <button type="button" class="quiet" data-remove="${escapeHtml(e.id)}" aria-label="Take this edit out" title="Take this edit out">×</button></li>`);
  return `<ol class="edits">${items.join('') || '<li class="note">No edits here yet.</li>'}</ol>`;
}

/** Undo and Redo (`data-undo`, `data-redo`). */
export function historyHtml(list: EditList, busy = false): string {
  return `<span><button type="button" class="quiet" data-undo ${list.edits.length && !busy ? '' : 'disabled'}>Undo</button>
      <button type="button" class="quiet" data-redo ${list.undone && !busy ? '' : 'disabled'}>Redo</button></span>`;
}

/** The tool buttons (`data-tool`), the chosen one standing out. */
export function toolsHtml(core: EditorCore): string {
  const chosen = core.current().id;
  return core.tools().map((t) => `<button type="button" data-tool="${t.id}" class="${t.id === chosen ? '' : 'quiet'}">${escapeHtml(t.name)}</button>`).join('');
}
