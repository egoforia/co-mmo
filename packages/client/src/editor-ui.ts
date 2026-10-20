import Phaser from 'phaser';
import {
  BUILDING_STYLES,
  CREATURES,
  KIT_HOUSE_FLOORS,
  MAX_CLEAR_RADIUS,
  MAX_SPAWN,
  MAX_STROKE,
  PAINT_TILES,
  Tile,
  houseCorner,
  landmarkAt,
  setPiece,
  setPieces,
  type PaintTile,
  type RegionMap,
  type TilePoint,
  type WorldEdit,
} from '@co-mmo/shared';
import { worldEdits, type EditLog } from './api.ts';
import { escapeHtml } from './ui.ts';
import type { WorldScene } from './world-scene.ts';

// The world editor, for the Owner and Stewards: a window of tools beside
// the game, used by pointing at the world. Each change goes to the server,
// which saves it, lays the land out again everywhere and shows it to
// everyone there; undo takes it back. The outlines it draws over the world
// are the editor's own marks, seen only while it is open, never game art.

type Tool = 'look' | 'paint' | 'move' | 'road' | 'house' | 'piece' | 'spawn' | 'clear';

const TOOLS: { id: Tool; name: string; hint: string }[] = [
  { id: 'look', name: 'Look', hint: 'Point at the world to see what is there.' },
  { id: 'paint', name: 'Paint', hint: 'Click or drag to lay ground, paths, water, trees or rocks. A path over water becomes a bridge.' },
  { id: 'move', name: 'Move', hint: 'Click a tree, rock, water or set piece to pick it up, then click where it goes.' },
  { id: 'road', name: 'Road', hint: 'Click where the road starts, then where it ends. It runs across, then down.' },
  { id: 'house', name: 'House', hint: 'Click the doorstep: the house stands just north of it, its doorway on that spot.' },
  // Only while the Smugglers' Sea Cave Art Kit wish is on (see setPieces).
  { id: 'piece', name: 'Set piece', hint: 'Click open ground or a floor to stand a sea cave piece there. It shows once its picture is painted in the Art tab.' },
  { id: 'spawn', name: 'Monsters', hint: 'Click open ground where the monsters should live. They come back there after they fall.' },
  { id: 'clear', name: 'Clear', hint: 'Click to send away every monster living near that spot.' },
];

const PAINT_NAMES: Record<PaintTile, string> = { ground: 'Ground', path: 'Path', water: 'Water', tree: 'Tree', rock: 'Rock' };
const TILE_NAMES: Partial<Record<Tile, string>> = {
  [Tile.Ground]: 'open ground', [Tile.Path]: 'a path', [Tile.Water]: 'water', [Tile.Tree]: 'a tree', [Tile.Rock]: 'a rock',
  [Tile.Wall]: 'a wall', [Tile.Floor]: 'a floor', [Tile.Door]: 'a doorway', [Tile.Bridge]: 'a bridge', [Tile.Blocked]: 'under a set piece',
};

/** Above everything in the world, labels included. */
const OUTLINE_DEPTH = 1_000_010;

export interface EditorOptions {
  token: string;
  /** The game's scene, once it is running. */
  scene: () => WorldScene | undefined;
  /** The land we are in. */
  region: () => { id: string; name: string };
}

/** The world editor's window and its pointer tools. */
export class EditorUi {
  private readonly box = document.getElementById('editor')!;
  private open = false;
  private tool: Tool = 'look';
  private paint: PaintTile = 'tree';
  private brush = 1;
  private houseStyle = Object.values(BUILDING_STYLES).find((s) => s.kit)?.id ?? Object.keys(BUILDING_STYLES)[0]!;
  private houseSize = 1;
  private piece = '';
  private creature = '';
  private count = 4;
  private radius = 6;
  /** The land whose edits the list shows: the one last edited, or the one we are in. */
  private listRegion = '';
  private listName = '';
  private log: EditLog = { edits: [], undone: 0 };
  /** Mid-tool: the brush stroke, the thing picked up, or the road's start. */
  private stroke: { region: string; tiles: Map<string, TilePoint> } | undefined;
  private picked: { region: string; at: TilePoint; what: string } | undefined;
  private roadFrom: { region: string; at: TilePoint } | undefined;
  private busy = false;
  private status = '';
  private outline?: Phaser.GameObjects.Graphics;
  private attached?: WorldScene;

  constructor(private readonly options: EditorOptions) {
    this.box.addEventListener('click', (event) => void this.clicked(event));
    this.box.addEventListener('change', (event) => this.changed(event));
    document.addEventListener('keydown', (event) => {
      if (!this.open || (event.target as HTMLElement).closest?.('input, textarea')) return;
      const key = event.key.toLowerCase();
      if (key === 'escape') {
        this.cancel();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (key === 'z' && !event.shiftKey) void this.act({ undo: true });
      else if (key === 'y' || (key === 'z' && event.shiftKey)) void this.act({ redo: true });
      else return;
      event.preventDefault();
    });
  }

  /** Opens or closes the editor. */
  toggle(open = !this.open): void {
    this.open = open;
    this.box.hidden = !open;
    this.cancel();
    if (!open) {
      this.outline?.clear();
      return;
    }
    this.attach();
    this.follow();
    this.render();
    void this.reload();
  }

  /** Shows the edits of the land we are in. */
  private follow(): void {
    ({ id: this.listRegion, name: this.listName } = this.options.region());
  }

  /** We walked into another land: the list follows us, unless we were editing elsewhere just now. */
  regionChanged(): void {
    if (!this.open || this.listRegion === this.options.region().id) return;
    this.follow();
    void this.reload();
  }

  private async reload(): Promise<void> {
    try {
      this.log = await worldEdits(this.options.token, this.listRegion);
    } catch (err) {
      this.status = (err as Error).message;
    }
    this.render();
  }

  /** Listens to the pointer over the world, once the scene is running. */
  private attach(): void {
    const scene = this.options.scene();
    if (!scene || this.attached === scene || !scene.sys.isActive()) return;
    this.attached = scene;
    this.outline = scene.add.graphics().setDepth(OUTLINE_DEPTH);
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointer(p, p.isDown ? 'drag' : 'hover'));
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointer(p, 'down'));
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointer(p, 'up'));
  }

  private pointer(p: Phaser.Input.Pointer, kind: 'hover' | 'down' | 'drag' | 'up'): void {
    const scene = this.attached;
    if (!this.open || !scene) return;
    const at = scene.tileAt(p.x, p.y);
    if (kind === 'up') {
      if (this.stroke) void this.finishStroke();
      return;
    }
    if (!at) {
      this.outline?.clear();
      return;
    }
    const spot: TilePoint = [at.x, at.y];
    if (kind === 'down') this.press(at.region, at.map, spot);
    else if (kind === 'drag' && this.stroke && this.tool === 'paint') this.addToStroke(at.region, spot);
    this.mark(at.region, at.map, spot);
  }

  /** A click on the world with the chosen tool. */
  private press(region: string, map: RegionMap, at: TilePoint): void {
    if (this.busy) return;
    switch (this.tool) {
      case 'look':
        return this.say(`${describe(map, at)} at ${at[0]}, ${at[1]} in ${map.def.name}.`);
      case 'paint':
        this.stroke = { region, tiles: new Map() };
        return this.addToStroke(region, at);
      case 'move': {
        if (!this.picked) {
          const piece = landmarkAt(map, at);
          const tile = map.tiles[at[1] * map.width + at[0]] as Tile;
          if (!piece && ![Tile.Tree, Tile.Rock, Tile.Water].includes(tile)) return this.say('There is nothing there to move: pick a tree, a rock, water or a set piece.');
          this.picked = { region, at, what: piece ? 'the set piece' : TILE_NAMES[tile]! };
          return this.render(`Picked up ${this.picked.what}. Click where it goes, or take it away.`);
        }
        if (this.picked.region !== region) return this.say('Put it down in the same land it came from.');
        const from = this.picked.at;
        this.picked = undefined;
        return void this.act({ edit: { kind: 'move', from, to: at } }, region);
      }
      case 'road': {
        if (!this.roadFrom) {
          this.roadFrom = { region, at };
          return this.say('Now click where the road ends.');
        }
        if (this.roadFrom.region !== region) return this.say('Keep both ends of the road in one land.');
        const from = this.roadFrom.at;
        this.roadFrom = undefined;
        return void this.act({ edit: { kind: 'road', from, to: at } }, region);
      }
      case 'house': {
        const floor = KIT_HOUSE_FLOORS[this.houseSize]!.floor;
        return void this.act({ edit: { kind: 'house', at: houseCorner(at, floor), floor, style: this.houseStyle } }, region);
      }
      case 'piece':
        if (!setPiece(this.piece)) return this.say('Choose a set piece first.');
        return void this.act({ edit: { kind: 'piece', piece: this.piece, at } }, region);
      case 'spawn':
        if (!this.creature) return this.say('Choose a kind of monster first.');
        return void this.act({ edit: { kind: 'spawn', creature: this.creature, at, count: this.count } }, region);
      case 'clear':
        return void this.act({ edit: { kind: 'clear', at, radius: this.radius } }, region);
    }
  }

  private addToStroke(region: string, [x, y]: TilePoint): void {
    if (!this.stroke || this.stroke.region !== region) return;
    const half = Math.floor(this.brush / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (this.stroke.tiles.size >= MAX_STROKE) return;
        this.stroke.tiles.set(`${x + dx},${y + dy}`, [x + dx, y + dy]);
      }
    }
  }

  private async finishStroke(): Promise<void> {
    const stroke = this.stroke;
    this.stroke = undefined;
    if (!stroke?.tiles.size) return;
    const tiles = [...stroke.tiles.values()].filter(([x, y]) => x >= 0 && y >= 0);
    await this.act({ edit: { kind: 'paint', tile: this.paint, tiles } }, stroke.region);
  }

  /** Sends a change (or undo, redo, remove) and shows the land's edits as they now are. */
  private async act(action: Parameters<typeof worldEdits>[2] & object, region = this.listRegion, name = region === this.listRegion ? this.listName : this.nameOf(region)): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render('Saving…');
    try {
      this.log = await worldEdits(this.options.token, region, action);
      this.listRegion = region;
      this.listName = name;
      this.status = 'undo' in action ? 'Taken back.' : 'redo' in action ? 'Made again.' : 'remove' in action ? 'Taken out.' : 'Done. Everyone here sees it now.';
    } catch (err) {
      this.status = (err as Error).message;
    }
    this.busy = false;
    this.render();
  }

  /** A land's name, from the ones drawn around us. */
  private nameOf(region: string): string {
    return this.attached?.landName(region) ?? 'that land';
  }

  /** Outlines what the tool would touch at the pointer. */
  private mark(region: string, map: RegionMap, at: TilePoint): void {
    const scene = this.attached;
    const g = this.outline;
    if (!scene || !g) return;
    g.clear();
    const box = (m: RegionMap, x: number, y: number, w = 1, h = 1, colour = 0xf2dc6b) => {
      g.lineStyle(2, colour, 0.95);
      g.strokePoints(scene.tileCorners(m, x, y, w, h), true);
    };
    const half = Math.floor(this.brush / 2);
    switch (this.tool) {
      case 'paint':
        for (const [x, y] of this.stroke?.tiles.values() ?? []) box(map, x, y);
        return box(map, at[0] - half, at[1] - half, this.brush, this.brush);
      case 'move': {
        if (this.picked && this.picked.region === region) box(map, this.picked.at[0], this.picked.at[1], 1, 1, 0x6fd08c);
        const piece = !this.picked && landmarkAt(map, at);
        if (piece) {
          const left = Math.floor(piece.x - piece.footprint.width / 2);
          const bottom = Math.floor(piece.y - 0.01);
          return box(map, left, bottom - piece.footprint.height + 1, piece.footprint.width, piece.footprint.height);
        }
        return box(map, at[0], at[1]);
      }
      case 'road': {
        if (!this.roadFrom || this.roadFrom.region !== region) return box(map, at[0], at[1], 2, 2);
        // As road() lays it: across on the start's row, then down the end's column, two tiles wide.
        const [x0, y0] = this.roadFrom.at;
        box(map, Math.min(x0, at[0]), y0, Math.abs(at[0] - x0) + 1, 2, 0x6fd08c);
        return box(map, at[0], Math.min(y0, at[1]), 2, Math.abs(at[1] - y0) + 2, 0x6fd08c);
      }
      case 'house': {
        const floor = KIT_HOUSE_FLOORS[this.houseSize]!.floor;
        const [x, y] = houseCorner(at, floor);
        box(map, x, y, floor[0] + 2, floor[1] + 2);
        return box(map, at[0], at[1] - 1, 2, 1, 0x6fd08c);
      }
      case 'piece': {
        const footprint = setPiece(this.piece)?.footprint ?? { width: 1, height: 1 };
        return box(map, at[0], at[1] - footprint.height + 1, footprint.width, footprint.height);
      }
      case 'spawn':
        box(map, at[0] - 3, at[1] - 3, 7, 7, 0xf6757a);
        return box(map, at[0], at[1]);
      case 'clear':
        return box(map, at[0] - this.radius, at[1] - this.radius, this.radius * 2 + 1, this.radius * 2 + 1, 0xf6757a);
      default:
        return box(map, at[0], at[1]);
    }
  }

  /** Drops whatever the tool was in the middle of. */
  private cancel(): void {
    this.stroke = undefined;
    this.picked = undefined;
    this.roadFrom = undefined;
  }

  private say(text: string): void {
    this.render(text);
  }

  private async clicked(event: Event): Promise<void> {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    if (button.classList.contains('close')) return this.toggle(false);
    const d = button.dataset;
    if (d.tool) {
      this.tool = d.tool as Tool;
      this.cancel();
      return this.render('');
    }
    if (d.undo !== undefined) return this.act({ undo: true });
    if (d.redo !== undefined) return this.act({ redo: true });
    if (d.remove) return this.act({ remove: d.remove });
    if (d.away !== undefined && this.picked) {
      const { region, at } = this.picked;
      this.picked = undefined;
      return this.act({ edit: { kind: 'move', from: at, to: null } }, region);
    }
  }

  private changed(event: Event): void {
    const input = event.target as HTMLSelectElement | HTMLInputElement;
    const value = input.value;
    if (input.name === 'paint') this.paint = value as PaintTile;
    else if (input.name === 'brush') this.brush = Number(value);
    else if (input.name === 'style') this.houseStyle = value;
    else if (input.name === 'size') this.houseSize = Number(value);
    else if (input.name === 'piece') this.piece = value;
    else if (input.name === 'creature') this.creature = value;
    else if (input.name === 'count') this.count = Math.max(1, Math.min(MAX_SPAWN, Number(value) || 1));
    else if (input.name === 'radius') this.radius = Math.max(1, Math.min(MAX_CLEAR_RADIUS, Number(value) || 1));
    // Hand the keys back to walking.
    input.blur();
  }

  private render(status?: string): void {
    if (status !== undefined) this.status = status;
    if (!this.open) return;
    const pieces = setPieces();
    if (!pieces.some((p) => p.id === this.piece)) this.piece = pieces[0]?.id ?? '';
    if (this.tool === 'piece' && !pieces.length) this.tool = 'look';
    const tools = TOOLS.filter((t) => t.id !== 'piece' || pieces.length);
    const tool = TOOLS.find((t) => t.id === this.tool)!;
    const option = (value: string, label: string, chosen: boolean) => `<option value="${escapeHtml(value)}"${chosen ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const creatures = Object.entries(CREATURES).sort(([, a], [, b]) => a.name.localeCompare(b.name));
    if (!this.creature && creatures[0]) this.creature = creatures[0][0];
    const settings: Record<Tool, string> = {
      look: '',
      paint: `<label>Lay <select name="paint">${PAINT_TILES.map((t) => option(t, PAINT_NAMES[t], t === this.paint)).join('')}</select></label>
        <label>Brush <select name="brush">${[1, 3, 5].map((n) => option(String(n), `${n} × ${n}`, n === this.brush)).join('')}</select></label>`,
      move: this.picked ? '<button type="button" class="quiet" data-away>Take it away</button>' : '',
      road: '',
      house: `<label>Look <select name="style">${Object.values(BUILDING_STYLES).map((s) => option(s.id, `${s.name}${s.kit ? ' (kit house)' : ''}`, s.id === this.houseStyle)).join('')}</select></label>
        <label>Size <select name="size">${KIT_HOUSE_FLOORS.map((f, i) => option(String(i), `${f.name}, ${f.floor[0]} × ${f.floor[1]} floor`, i === this.houseSize)).join('')}</select></label>`,
      piece: `<label>Piece <select name="piece">${pieces.map((p) => option(p.id, p.name, p.id === this.piece)).join('')}</select></label>`,
      spawn: `<label>Monster <select name="creature">${creatures.map(([id, c]) => option(id, `${c.name} (level ${c.level})`, id === this.creature)).join('')}</select></label>
        <label>How many <input name="count" type="number" min="1" max="${MAX_SPAWN}" value="${this.count}" /></label>`,
      clear: `<label>Tiles around <input name="radius" type="number" min="1" max="${MAX_CLEAR_RADIUS}" value="${this.radius}" /></label>`,
    };
    const edits = [...this.log.edits].reverse().map((e) => `<li><span>${escapeHtml(editWords(e))}</span><span class="by">${escapeHtml(e.by)}</span>
      <button type="button" class="quiet" data-remove="${escapeHtml(e.id)}" aria-label="Take this edit out" title="Take this edit out">×</button></li>`).join('');
    this.box.innerHTML = `
      <h2>World editor <button type="button" class="close" aria-label="Close">×</button></h2>
      <div class="tools">${tools.map((t) => `<button type="button" data-tool="${t.id}" class="${t.id === this.tool ? '' : 'quiet'}">${t.name}</button>`).join('')}</div>
      <p class="note">${escapeHtml(tool.hint)}</p>
      <div class="settings">${settings[this.tool]}</div>
      <p class="status" aria-live="polite">${escapeHtml(this.status)}</p>
      <h3>Edits in ${escapeHtml(this.listName)}
        <span><button type="button" class="quiet" data-undo ${this.log.edits.length && !this.busy ? '' : 'disabled'}>Undo</button>
        <button type="button" class="quiet" data-redo ${this.log.undone && !this.busy ? '' : 'disabled'}>Redo</button></span></h3>
      <ol class="edits">${edits || '<li class="note">No edits here yet.</li>'}</ol>`;
  }
}

/** What stands on a tile, in a few words. */
function describe(map: RegionMap, at: TilePoint): string {
  const piece = landmarkAt(map, at);
  if (piece) return setPiece(piece.asset)?.name ?? `A set piece (${piece.asset})`;
  const building = map.buildings.find((b) => at[0] >= b.x && at[0] < b.x + b.width && at[1] >= b.y && at[1] < b.y + b.height);
  const words = TILE_NAMES[map.tiles[at[1] * map.width + at[0]] as Tile] ?? 'Something';
  const name = building && BUILDING_STYLES[building.style]?.name;
  return `${words[0]!.toUpperCase()}${words.slice(1)}${name ? ` of ${name}` : ''}`;
}

/** One line for an edit in the list. */
export function editWords(e: WorldEdit): string {
  switch (e.kind) {
    case 'paint': return `${PAINT_NAMES[e.tile]} on ${e.tiles.length} tile${e.tiles.length === 1 ? '' : 's'}`;
    case 'move': return e.to ? `Moved from ${e.from.join(', ')} to ${e.to.join(', ')}` : `Took away what stood at ${e.from.join(', ')}`;
    case 'road': return `Road from ${e.from.join(', ')} to ${e.to.join(', ')}`;
    case 'house': return `${BUILDING_STYLES[e.style]?.name ?? 'A house'}, ${e.floor[0]} × ${e.floor[1]}`;
    case 'spawn': return `${e.count} ${e.name ?? e.creature} at ${e.at.join(', ')}`;
    case 'clear': return `Cleared monsters within ${e.radius} of ${e.at.join(', ')}`;
    case 'piece': return `${setPiece(e.piece)?.name ?? 'A set piece'} at ${e.at.join(', ')}`;
  }
}
