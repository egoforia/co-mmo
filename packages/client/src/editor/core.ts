import {
  BUILDING_STYLES,
  CREATURES,
  checkEdit,
  EDIT_KINDS,
  MAX_STROKE,
  SPOTS,
  Tile,
  buildingAt,
  editWords,
  floorName,
  landmarkAt,
  brushTiles,
  pickAt,
  setPiece,
  tileAt,
  type BrushShape,
  type EditKind,
  type EditKindId,
  type FieldChoice,
  type FieldValue,
  type Outline,
  type RegionMap,
  type TilePoint,
  type ToolUse,
  type WorldEdit,
  type WorldEditDraft,
} from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { AreaTool } from './area.ts';
import { CONTEXT, fieldsHtml, filled, hasRules, readField } from './fields.ts';
import { Inspector } from './inspector.ts';

// The world editor's core, shared by edit mode's two cameras (in-game.ts):
// the World (the game's own view) and the Plan (a land from above). It knows the tools
// (one per kind of edit in the registry, plus Select and Copy and paste), their settings, the
// Select tool's inspector (inspector.ts), what a
// press, drag or release on a tile makes, what to outline under the pointer,
// and how the edit list reads. The views only turn the pointer into tiles,
// draw the outlines their own way and send what the core makes.

/** A tool: Select, Copy and paste, or one kind of edit. What is under the pointer is read out by the views, so there is no Look tool. */
export type ToolId = EditKindId | 'select' | 'area';

/** What a press or release asks the view to do: say something, send an edit (or edits made together), or nothing yet. */
export interface ToolStep {
  say?: string;
  draft?: WorldEditDraft;
  /** Edits that go together, all or none, undone as one step. */
  drafts?: WorldEditDraft[];
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

const SELECT = { id: 'select' as const, name: 'Select', hint: 'Click a building, storey, stairs, piece, spot, person, monster, light or bookmark to see and change it. Drag over bare ground to copy an area.' };
const AREA = { id: 'area' as const, name: 'Copy and paste', hint: 'Click two corners to copy an area: its ground and everything standing in it. Then each click pastes it, all or none. Keep a copy as a prefab to paste in any land.' };

const TILE_NAMES: Partial<Record<Tile, string>> = {
  [Tile.Ground]: 'open ground', [Tile.Path]: 'a path', [Tile.Water]: 'water', [Tile.Tree]: 'a tree', [Tile.Rock]: 'a rock',
  [Tile.Wall]: 'a wall', [Tile.Floor]: 'a floor', [Tile.Door]: 'a doorway', [Tile.Bridge]: 'a bridge', [Tile.Blocked]: 'under a set piece',
};

/** The editor's tools, settings and half-made edits, for one view. */
export class EditorCore {
  tool: ToolId = 'select';
  private readonly values: Partial<Record<EditKindId, Record<string, FieldValue>>> = {};
  /** Mid-tool: the brush stroke, or what was picked up (or where a road starts). */
  private stroke: { region: string; level: number; tiles: Map<string, TilePoint>; from: TilePoint; kind?: EditKind<EditKindId> } | undefined;
  private held: { region: string; at: TilePoint; what: string; target?: string } | undefined;
  private readonly area = new AreaTool();
  /** The last aimAt, by land and a key of the tool, tile and settings. */
  private aimed: { map: RegionMap; key: string; found: ReturnType<EditorCore['aim']> } | undefined;
  /** The Select tool: what is picked and how to change it. */
  readonly inspector = new Inspector();

  /** The tools on offer now: set pieces only while their kit's wish is on. */
  tools(): { id: ToolId; name: string; hint: string }[] {
    const kinds = Object.values(EDIT_KINDS) as EditKind<EditKindId>[];
    return [SELECT, AREA, ...kinds.filter((k) => k.available?.() ?? true).map((k) => ({ id: k.kind, name: k.name, hint: k.hint }))];
  }

  /** The chosen tool, falling back to Select when it is no longer on offer. */
  current(): { id: ToolId; name: string; hint: string } {
    const tools = this.tools();
    const found = tools.find((t) => t.id === this.tool);
    if (!found) this.tool = 'select';
    return found ?? SELECT;
  }

  /** Picks a tool, dropping whatever the last one was in the middle of. */
  choose(tool: string): void {
    if (tool === 'select' || tool === 'area' || Object.hasOwn(EDIT_KINDS, tool)) this.tool = tool as ToolId;
    this.cancel();
  }

  /** Drops whatever the tool was in the middle of. */
  cancel(): void {
    this.stroke = undefined;
    this.held = undefined;
    this.inspector.reset();
    this.area.reset();
  }

  /** True while a tool is part way through something Esc would drop: a stroke, a first click, a pick or an area corner. */
  midway(): boolean {
    return !!(this.stroke || this.held || this.inspector.midway() || this.area.midway());
  }

  /** True while a thing is picked up (the move tool's Take it away). */
  holding(): boolean {
    return !!this.held && this.tool === 'move';
  }

  private kind(): EditKind<EditKindId> | undefined {
    return this.tool === 'select' || this.tool === 'area' ? undefined : (EDIT_KINDS[this.tool] as unknown as EditKind<EditKindId>);
  }

  /** The current tool's settings, chosen or as they start. */
  settings(kind = this.kind()): Record<string, FieldValue> {
    if (!kind) return {};
    return filled(kind.fields, (this.values[kind.kind] ??= {}));
  }

  /** Sets one of the current tool's settings from its input; false when it is not one. */
  set(key: string, raw: string, checked?: boolean): boolean {
    const form = this.formField(key);
    if (form) {
      (this.values[form.kind.kind] ??= {})[form.key] = readField(form.kind.fields.find((f) => f.key === form.key)!, raw, checked);
      return true;
    }
    if (this.tool === 'select') return this.inspector.set(key, raw, checked);
    if (this.tool === 'area') return this.area.set(key, raw);
    const kind = this.kind();
    const field = kind?.fields.find((f) => f.key === key);
    if (!kind || !field) return false;
    (this.values[kind.kind] ??= {})[key] = readField(field, raw, checked);
    return true;
  }

  /** A picture choice's setting by its input's name (the tool's, the inspector's or a form's): its label, choices and value now. */
  assetChoices(name: string): { label: string; choices: FieldChoice[]; value: string } | undefined {
    const [head, kindId, key] = name.split('.');
    const prefixed = (head === 'form' || head === 'insp') && kindId && Object.hasOwn(EDIT_KINDS, kindId);
    const kind = prefixed ? (EDIT_KINDS[kindId as EditKindId] as unknown as EditKind<EditKindId>) : this.kind();
    const fieldKey = prefixed ? key : name;
    const field = kind?.fields.find((f) => f.key === fieldKey);
    if (!kind || !field || field.type !== 'choice') return undefined;
    const value = head === 'insp' ? this.inspector.value(kind.kind, field.key) : this.settings(kind)[field.key];
    return { label: field.label, choices: field.choices(CONTEXT), value: String(value ?? '') };
  }

  /**
   * What a one-click making tool would make on a tile, before it is sent:
   * why it would not fit (the server's own check, in words), and the picture
   * it would stand there, for the ghost. Undefined for the other tools.
   */
  aimAt(map: RegionMap, at: TilePoint, level: number): { problem?: string; art?: string; character: boolean } | undefined {
    const kind = this.kind();
    if (!kind || kind.pointer !== 'click' || this.holding()) return undefined;
    const values = this.settings(kind);
    // The pointer moves many times over one tile: the check runs once per tile, land and settings.
    const key = `${kind.kind}|${at[0]},${at[1]},${level}|${JSON.stringify(values)}`;
    if (this.aimed?.map === map && this.aimed.key === key) return this.aimed.found;
    const found = this.aim(kind, map, at, level, values);
    this.aimed = { map, key, found };
    return found;
  }

  private aim(kind: EditKind<EditKindId>, map: RegionMap, at: TilePoint, level: number, values: Record<string, FieldValue>): { problem?: string; art?: string; character: boolean } {
    const draft = kind.make({ at }, values) as WorldEditDraft;
    let problem: string | undefined;
    try {
      problem = checkEdit(map, kind.onFloors ? { ...draft, level } : draft, CREATURES);
    } catch {
      // A check that cannot read the draft yet says nothing; the server checks again when it is sent.
    }
    const pictured = kind.fields.find((f) => f.type === 'choice' && f.choices(CONTEXT).some((c) => c.art));
    const art = pictured?.type === 'choice' ? pictured.choices(CONTEXT).find((c) => c.id === values[pictured.key])?.art : undefined;
    return { ...(problem ? { problem } : {}), ...(art ? { art } : {}), character: kind.kind === 'person' || kind.kind === 'spawn' };
  }

  /** A kind's own settings drawn outside its tool (the land panel's Land tab), inputs named `form.<kind>.<key>`. */
  formHtml(kindId: EditKindId): string {
    const kind = EDIT_KINDS[kindId] as unknown as EditKind<EditKindId>;
    return fieldsHtml(kind.fields, this.settings(kind), `form.${kindId}.`);
  }

  /** The edit a kind's own settings make at a tile, as its tool would there. */
  makeAt(kindId: EditKindId, region: string, at: TilePoint, level: number): ToolStep {
    return this.make(EDIT_KINDS[kindId] as unknown as EditKind<EditKindId>, { at }, region, level);
  }

  private formField(name: string): { kind: EditKind<EditKindId>; key: string } | undefined {
    const [head, kindId, key] = name.split('.');
    if (head !== 'form' || !kindId || !Object.hasOwn(EDIT_KINDS, kindId)) return undefined;
    const kind = EDIT_KINDS[kindId as EditKindId] as unknown as EditKind<EditKindId>;
    return kind.fields.some((f) => f.key === key) ? { kind, key: key! } : undefined;
  }

  /** True when a change to this input changes what the panel shows (notes under the settings, or settings that apply only sometimes), so the view draws it again. */
  redraws(key: string): boolean {
    const form = this.formField(key);
    if (form) return hasRules(form.kind.fields);
    if (this.tool === 'select') return this.inspector.redraws(key);
    const kind = this.kind();
    return !!kind && (!!kind.notes || hasRules(kind.fields));
  }

  /** The Copy and paste tool's buttons (`data-area`, with `data-value` naming a prefab). */
  areaAction(action: string, value?: string): ToolStep {
    return this.tool === 'area' ? this.area.action(action, value) : {};
  }

  /** The current tool's settings as HTML: each input named by its setting's key; Select's is the inspector. */
  settingsHtml(): string {
    if (this.tool === 'select') return this.inspector.html();
    if (this.tool === 'area') return this.area.html();
    const kind = this.kind();
    if (!kind) return '';
    const values = this.settings(kind);
    const fields = [fieldsHtml(kind.fields, values)];
    if (this.holding()) fields.push('<button type="button" class="quiet" data-away>Take it away</button>');
    const notes = kind.notes?.(values) ?? [];
    if (notes.length) fields.push(`<ul class="tool-notes">${notes.map((n) => `<li class="${n.ok ? 'ok' : 'bad'}">${escapeHtml(n.text)}</li>`).join('')}</ul>`);
    return fields.join('\n');
  }

  /** The inspector's buttons (`data-pick`): take the pick away, copy or move it with the next click, or change it. */
  pickAction(action: string): ToolStep {
    return this.tool === 'select' ? this.inspector.action(action) : {};
  }

  /** True while something is picked (and not waiting for where it goes), for the keys that act on it. */
  hasPick(): boolean {
    return this.tool === 'select' && !!this.inspector.picked && !this.inspector.picked.placing;
  }

  /** The Select tool on a tile: the patrol path being drawn starts, or the inspector picks. */
  private select(region: string, map: RegionMap, at: TilePoint, level: number): ToolStep {
    const p = this.inspector.picked;
    if (this.inspector.path && p) {
      if (p.region !== region) return { say: 'Draw the path in the land its monsters live in.' };
      const home: TilePoint = [p.thing.box.x, p.thing.box.y];
      this.stroke = { region, level: p.thing.level, tiles: new Map([[`${home[0]},${home[1]}`, home]]), from: home, kind: EDIT_KINDS.patrol as unknown as EditKind<EditKindId> };
      this.drag(region, map, at);
      return {};
    }
    return this.inspector.press(region, map, at, level);
  }

  /** A press on a tile of a land, on a floor of it. */
  press(region: string, map: RegionMap, at: TilePoint, level: number): ToolStep {
    if (this.tool === 'select') return this.select(region, map, at, level);
    if (this.tool === 'area') return this.area.press(region, map, at);
    const kind = this.kind();
    if (!kind) return { say: `${describe(map, at, level)} at ${at[0]}, ${at[1]} in ${map.def.name}.` };
    switch (kind.pointer) {
      case 'drag':
        this.stroke = { region, level, tiles: new Map(), from: at };
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
        const picked = kind.targets === 'thing' || kind.targets === 'person' ? pickAt(map, at, level) : undefined;
        const target = kind.targets === 'building' ? buildingAt(map, at)?.id : kind.targets === 'piece' ? landmarkAt(map, at, level)?.id : kind.targets === 'person' ? (picked?.kind === 'person' ? picked.id : undefined) : picked?.id;
        return this.make(kind, { at, ...(target ? { target } : {}) }, region, level);
      }
    }
  }

  /** The pointer dragged over a tile while pressed: a brush stroke grows. */
  drag(region: string, map: RegionMap, [x, y]: TilePoint): void {
    if (this.tool === 'select' && !this.stroke) return this.inspector.drag(region, [x, y]);
    if (!this.stroke || this.stroke.region !== region) return;
    const n = Number(this.settings().brush) || 1;
    // A rectangle, line or fill is drawn again from where it was pressed, each time the pointer moves.
    const shape = String(this.settings().shape ?? 'free') as BrushShape;
    if (shape !== 'free') {
      this.stroke.tiles = new Map(brushTiles(map, shape, this.stroke.from, [x, y], n).map((t) => [`${t[0]},${t[1]}`, t]));
      return;
    }
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
    if (this.tool === 'select' && !this.stroke) return this.dropBox();
    const stroke = this.stroke;
    this.stroke = undefined;
    const kind = stroke?.kind ?? this.kind();
    if (stroke?.kind) this.inspector.path = false;
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

  /** An area dragged out with Select is copied, and Copy and paste takes over to paste it; one tile is just bare ground. */
  private dropBox(): ToolStep {
    const box = this.inspector.release();
    if (!box) return {};
    const [a, b] = [box.from, box.to];
    if (a[0] === b[0] && a[1] === b[1]) return { say: `Nothing to pick at ${a[0]}, ${a[1]}.` };
    const step = this.area.copy(box.map, a, b);
    if (this.area.copied) this.tool = 'area';
    return step;
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
    if (this.tool === 'select' && this.stroke?.region === region) return [...this.stroke.tiles.values()].map(([x, y]) => ({ x, y, w: 1, h: 1, tone: 'held' as const }));
    if (this.tool === 'select') return this.inspector.outlines(region, map, at, level);
    if (this.tool === 'area') return this.area.outlines(region, at);
    const kind = this.kind();
    if (!kind) return [{ x: at[0], y: at[1], w: 1, h: 1 }];
    const stroke = this.stroke?.region === region ? [...this.stroke.tiles.values()].map(([x, y]) => ({ x, y, w: 1, h: 1 })) : [];
    const from = this.held?.region === region ? this.held.at : undefined;
    const aim = kind.outline?.(map, { at, level, ...(from ? { from } : {}) }, this.settings(kind)) ?? [{ x: at[0], y: at[1], w: 1, h: 1 }];
    return [...stroke, ...aim];
  }
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

/** The status strip's words for the tile under the pointer: what stands there, where, and on which floor. */
export function hereWords(map: RegionMap, at: TilePoint, level = 0): string {
  return `${describe(map, at, level)} · ${at[0]}, ${at[1]}${level ? ` · ${floorName(level)}` : ''}`;
}

/** The status strip's words for the pointer: whether a making tool's thing fits there (aimAt), then what is there. */
export function aimWords(aim: { problem?: string } | undefined, map: RegionMap, at: TilePoint, level = 0): string {
  return `${aim ? (aim.problem ? `✗ ${aim.problem} · ` : '✓ It fits here · ') : ''}${hereWords(map, at, level)}`;
}

/** A land's edits, newest first, drafts marked, each with a button to take it out (`data-remove`). */
export function editListHtml(list: EditList): string {
  const unlaid = new Set(list.unlaid ?? []);
  const items = [...list.edits].reverse().map((e) => `<li${e.draft ? ' class="draft"' : ''}><span>${escapeHtml(editWords(e))}${e.draft ? ' <em class="note">(draft)</em>' : ''}${unlaid.has(e.id) ? ' <em class="note">(no longer fits)</em>' : ''}</span><span class="by">${escapeHtml(e.by)}</span>
      <button type="button" class="quiet" data-remove="${escapeHtml(e.id)}" aria-label="Take this edit out" title="Take this edit out">×</button></li>`);
  return `<ol class="edits">${items.join('') || '<li class="note">No edits here yet.</li>'}</ol>`;
}

/** Undo and Redo (`data-undo`, `data-redo`). */
export function historyHtml(list: EditList, busy = false): string {
  return `<span><button type="button" class="quiet" data-undo ${list.edits.length && !busy ? '' : 'disabled'}>Undo</button>
      <button type="button" class="quiet" data-redo ${list.undone && !busy ? '' : 'disabled'}>Redo</button></span>`;
}

/**
 * Drafts and publishing: whether new edits go live at once (`name="live"`),
 * and, while there are drafts, Publish (`data-publish`) and Throw away (`data-discard`).
 */
export function draftsHtml(list: EditList, live: boolean, busy = false): string {
  const drafts = list.edits.filter((e) => e.draft).length;
  const off = busy ? ' disabled' : '';
  const buttons = drafts
    ? `<span class="note">${drafts} draft${drafts === 1 ? '' : 's'}: only editors see ${drafts === 1 ? 'it' : 'them'}.</span>
      <button type="button" data-publish${off}>Publish for everyone</button>
      <button type="button" class="quiet" data-discard${off}>Throw drafts away</button>`
    : '';
  return `<div class="drafts"><label class="check"><input type="checkbox" name="live"${live ? ' checked' : ''} /> Make changes live at once</label>${buttons}</div>`;
}
