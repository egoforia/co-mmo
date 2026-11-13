import {
  BUILDING_STYLES,
  CREATURES,
  EDIT_KINDS,
  MAX_STROKE,
  SPOTS,
  Tile,
  buildingAt,
  copyDraft,
  editWords,
  floorName,
  landmarkAt,
  moveDrafts,
  brushTiles,
  personValues,
  pickAt,
  removeDraft,
  setPiece,
  tileAt,
  type BrushShape,
  type EditContext,
  type EditField,
  type EditKind,
  type EditKindId,
  type FieldValue,
  type Outline,
  type Picked,
  type RegionMap,
  type TilePoint,
  type ToolUse,
  type WorldEdit,
  type WorldEditDraft,
} from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { AreaTool } from './area.ts';

// The world editor's core, shared by its two views: the window beside the
// game (in-game.ts) and the Studio's map (studio-map.ts). It knows the tools
// (one per kind of edit in the registry, plus Select and Copy and paste), their settings, what a
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

const SELECT = { id: 'select' as const, name: 'Select', hint: 'Click a building, storey, stairs, piece, spot, person, monster, light or bookmark to see it, then take it away, copy it or move it.' };
const AREA = { id: 'area' as const, name: 'Copy and paste', hint: 'Click two corners to copy an area: its ground and everything standing in it. Then each click pastes it, all or none. Keep a copy as a prefab to paste in any land.' };
const CONTEXT: EditContext = { creatures: CREATURES };

/** Number settings with at most this many choices are drawn as a list to pick from. */
const SHORT_RANGE = 8;

const TILE_NAMES: Partial<Record<Tile, string>> = {
  [Tile.Ground]: 'open ground', [Tile.Path]: 'a path', [Tile.Water]: 'water', [Tile.Tree]: 'a tree', [Tile.Rock]: 'a rock',
  [Tile.Wall]: 'a wall', [Tile.Floor]: 'a floor', [Tile.Door]: 'a doorway', [Tile.Bridge]: 'a bridge', [Tile.Blocked]: 'under a set piece',
};

/** The editor's tools, settings and half-made edits, for one view. */
export class EditorCore {
  tool: ToolId = 'select';
  private readonly values: Partial<Record<EditKindId, Record<string, FieldValue>>> = {};
  /** Mid-tool: the brush stroke, or what was picked up (or where a road starts). */
  private stroke: { region: string; level: number; tiles: Map<string, TilePoint>; from: TilePoint } | undefined;
  private held: { region: string; at: TilePoint; what: string; target?: string } | undefined;
  /** The Select tool's pick, and whether a copy or move of it waits for where it goes. */
  private readonly area = new AreaTool();
  private picked: { region: string; thing: Picked; placing?: 'copy' | 'move'; values?: Record<string, FieldValue> } | undefined;

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
    this.picked = undefined;
    this.area.reset();
  }

  /** True while a tool is part way through something Esc would drop: a stroke, a first click, a pick or an area corner. */
  midway(): boolean {
    return !!(this.stroke || this.held || this.picked || this.area.midway());
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
    const chosen = (this.values[kind.kind] ??= {});
    const out: Record<string, FieldValue> = {};
    for (const f of kind.fields) out[f.key] = f.key in chosen ? chosen[f.key]! : start(f);
    // A choice whose list changed (a wish switched off) starts again.
    for (const f of kind.fields) if (f.type === 'choice' && !f.choices(CONTEXT).some((c) => c.id === out[f.key])) out[f.key] = start(f);
    return out;
  }

  /** Sets one of the current tool's settings from its input; false when it is not one. */
  set(key: string, raw: string, checked?: boolean): boolean {
    if (this.tool === 'area') return this.area.set(key, raw);
    const kind = this.kind();
    const field = kind?.fields.find((f) => f.key === key);
    if (!kind || !field) return false;
    const chosen = (this.values[kind.kind] ??= {});
    if (field.type === 'flag') chosen[key] = !!checked;
    else if (field.type === 'number') chosen[key] = Math.max(field.min, Math.min(field.max, Math.round(Number(raw)) || field.min));
    else if (field.type === 'text') chosen[key] = raw.slice(0, field.max);
    else chosen[key] = raw;
    return true;
  }

  /** True when the tool says something under its settings that changes with them (so the view draws them again on a change). */
  hasNotes(): boolean {
    return !!this.kind()?.notes;
  }

  /** The Copy and paste tool's buttons (`data-area`, with `data-value` naming a prefab). */
  areaAction(action: string, value?: string): ToolStep {
    return this.tool === 'area' ? this.area.action(action, value) : {};
  }

  /** The current tool's settings as HTML: each input named by its setting's key. */
  settingsHtml(): string {
    if (this.tool === 'select') return this.pickedHtml();
    if (this.tool === 'area') return this.area.html();
    const kind = this.kind();
    if (!kind) return '';
    const values = this.settings(kind);
    const option = (value: string, label: string, chosen: boolean) => `<option value="${escapeHtml(value)}"${chosen ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const fields = kind.fields.map((f) => {
      const v = values[f.key];
      if (f.type === 'flag') return `<label class="check"><input type="checkbox" name="${f.key}"${v ? ' checked' : ''} /> ${escapeHtml(f.label)}</label>`;
      if (f.type === 'text') return `<label>${escapeHtml(f.label)} <input name="${f.key}" type="text" maxlength="${f.max}" value="${escapeHtml(String(v))}" /></label>`;
      if (f.type === 'choice') return `<label>${escapeHtml(f.label)} <select name="${f.key}">${f.choices(CONTEXT).map((c) => option(c.id, c.name, c.id === v)).join('')}</select></label>`;
      if (f.max - f.min <= SHORT_RANGE) {
        const counts = Array.from({ length: f.max - f.min + 1 }, (_, i) => f.min + i);
        return `<label>${escapeHtml(f.label)} <select name="${f.key}">${counts.map((n) => option(String(n), String(n), n === v)).join('')}</select></label>`;
      }
      return `<label>${escapeHtml(f.label)} <input name="${f.key}" type="number" min="${f.min}" max="${f.max}" value="${v}" /></label>`;
    });
    if (this.holding()) fields.push('<button type="button" class="quiet" data-away>Take it away</button>');
    const notes = kind.notes?.(values) ?? [];
    if (notes.length) fields.push(`<ul class="tool-notes">${notes.map((n) => `<li class="${n.ok ? 'ok' : 'bad'}">${escapeHtml(n.text)}</li>`).join('')}</ul>`);
    return fields.join('\n');
  }

  /** The Select tool's card: what is picked, and what to do with it (`data-pick`). */
  private pickedHtml(): string {
    const p = this.picked;
    if (!p) return '<p class="note">Nothing picked yet.</p>';
    const { thing } = p;
    const change = p.values ? '<button type="button" class="quiet" data-pick="change">Change</button>' : '';
    const buttons = p.placing
      ? `<p class="note">Click where its top-left corner goes${thing.kind === 'person' ? ', on any floor' : ''}. Esc to stop.</p>`
      : `<button type="button" class="quiet" data-pick="remove">Take it away</button><button type="button" class="quiet" data-pick="copy">Copy</button><button type="button" class="quiet" data-pick="move">Move</button>${change}`;
    return `<div class="picked"><strong>${escapeHtml(thing.name)}</strong>
      ${[...thing.details, `At ${thing.box.x}, ${thing.box.y}${thing.level ? `, floor ${thing.level}` : ''}`].map((d) => `<span class="note">${escapeHtml(d)}</span>`).join('')}
      ${thing.id ? `<span class="note">Name: <code>${escapeHtml(thing.id)}</code></span>` : ''}
      <span class="pick-actions">${buttons}</span></div>`;
  }

  /** The Select tool's buttons: take the pick away now, or copy or move it with the next click. */
  pickAction(action: string): ToolStep {
    const p = this.picked;
    if (!p || this.tool !== 'select') return {};
    if (action === 'remove') {
      this.picked = undefined;
      return { draft: removeDraft(p.thing), region: p.region };
    }
    // A person's settings go to the Person tool, to change and then click them.
    if (action === 'change' && p.values) {
      this.values.person = { ...p.values };
      this.tool = 'person';
      this.picked = undefined;
      return { say: `Change their settings, then click ${p.thing.name} to make it so.` };
    }
    if (action === 'copy' || action === 'move') {
      p.placing = action;
      return { say: action === 'copy' ? 'Click where the copy goes.' : 'Click where it goes.' };
    }
    return {};
  }

  /** The Select tool on a tile: a copy or move lands there, or the thing there is picked. */
  private select(region: string, map: RegionMap, at: TilePoint, level: number): ToolStep {
    const p = this.picked;
    if (p?.placing) {
      if (p.region !== region) return { say: 'Keep it in the land it came from.' };
      // People go to the floor shown; everything else stays on its own.
      const onto = p.thing.kind === 'person' ? (level ? { level } : { level: undefined }) : {};
      const drafts = p.placing === 'copy' ? [copyDraft(map, p.thing, at)].filter((d) => !!d).map((d) => ({ ...d, ...onto })) : moveDrafts(map, p.thing, at, p.thing.kind === 'person' ? level : p.thing.level);
      if (!drafts?.length) return { say: 'That cannot be copied yet.' };
      this.picked = p.placing === 'copy' ? { region, thing: p.thing, placing: 'copy' } : undefined;
      return drafts.length === 1 ? { draft: drafts[0]!, region } : { drafts, region };
    }
    const thing = pickAt(map, at, level);
    const person = thing?.kind === 'person' ? map.npcs.find((n) => n.id === thing.id) : undefined;
    this.picked = thing && { region, thing, ...(person ? { values: personValues(person) } : {}) };
    return { say: thing ? `Picked ${thing.name}.` : `Nothing to pick at ${at[0]}, ${at[1]}.` };
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
    if (this.tool === 'select') {
      const p = this.picked?.region === region ? this.picked : undefined;
      if (!p) return [pickAt(map, at, level)?.box ?? { x: at[0], y: at[1], w: 1, h: 1 }];
      const held: Outline = { ...p.thing.box, tone: 'held' };
      return p.placing ? [held, { x: at[0], y: at[1], w: p.thing.box.w, h: p.thing.box.h }] : [held, { x: at[0], y: at[1], w: 1, h: 1 }];
    }
    if (this.tool === 'area') return this.area.outlines(region, at);
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

/** The status strip's words for the tile under the pointer: what stands there, where, and on which floor. */
export function hereWords(map: RegionMap, at: TilePoint, level = 0): string {
  return `${describe(map, at, level)} · ${at[0]}, ${at[1]}${level ? ` · ${floorName(level)}` : ''}`;
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

/** The tool buttons (`data-tool`), the chosen one standing out. */
export function toolsHtml(core: EditorCore): string {
  const chosen = core.current().id;
  return core.tools().map((t) => `<button type="button" data-tool="${t.id}" class="${t.id === chosen ? '' : 'quiet'}">${escapeHtml(t.name)}</button>`).join('');
}
