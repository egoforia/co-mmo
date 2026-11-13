import { Tile, isBlocking, tileAt, wallBox, type Outline, type RegionMap, type WorldEditDraft } from '@co-mmo/shared';

// The Plan camera's picture of a land: its tiles from above, one colour each
// by biome, on any floor, with buildings outlined, walls on tiles' sides as
// thin bars, spots, people and monsters as dots, the AI Map Architect's checked
// steps in cyan and the tool's outlines on top. The editor's own plan, never game art.

const BIOME_COLORS: Record<string, { ground: string; path: string; water: string; tree: string; rock: string; wall: string; floor: string }> = {
  sanctum: { ground: '#6b6650', path: '#b8aa86', water: '#3b7a9e', tree: '#3c6e3f', rock: '#8a877c', wall: '#d6ccb2', floor: '#9c8665' },
  'whispering-woods': { ground: '#2f4d2e', path: '#7a6345', water: '#2c5e6e', tree: '#1e3820', rock: '#5b665f', wall: '#5c4632', floor: '#7d6040' },
  'sunlit-shore': { ground: '#c2a86f', path: '#dfd0a8', water: '#2e6f7a', tree: '#4e8248', rock: '#7d7a72', wall: '#c7b89b', floor: '#a68b60' },
  'mirage-desert': { ground: '#b88748', path: '#d9b577', water: '#2d7a78', tree: '#5e783c', rock: '#8f6439', wall: '#d4a36a', floor: '#a87b48' },
  frostpeak: { ground: '#7c99b0', path: '#a8bfd1', water: '#3d6685', tree: '#3b5c63', rock: '#5c6d7e', wall: '#b8cce0', floor: '#786858' },
  'mushroom-hollow': { ground: '#4a3a66', path: '#735d96', water: '#354d73', tree: '#7a4988', rock: '#5c5270', wall: '#6e578c', floor: '#614c78' },
};
const TONES: Record<NonNullable<Outline['tone']>, string> = { aim: '#feae34', held: '#6fd08c', warn: '#f6757a' };

/** What the plan shows besides the tiles. */
export interface PlanLayers {
  grid: boolean;
  hitboxes: boolean;
  spots: boolean;
  people: boolean;
}

/** What to draw: the land, the floor, pixels per tile, the layers, the Architect's checked steps and the tool's outlines. */
export interface PlanPicture {
  map: RegionMap;
  floor: number;
  cell: number;
  layers: PlanLayers;
  steps?: WorldEditDraft[];
  outlines?: Outline[];
  /** Places a check named, marked red. */
  problems?: [number, number][];
}

/** Draws a land's plan on a canvas the size of the land at `cell` pixels a tile. */
export function drawPlan(canvas: HTMLCanvasElement, p: PlanPicture): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const { map, cell: c, floor, layers } = p;
  const palette = BIOME_COLORS[map.def.biome] ?? BIOME_COLORS.sanctum!;
  const box = (x: number, y: number, w = 1, h = 1) => g.fillRect(x * c, y * c, w * c, h * c);
  g.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = tileAt(map, x, y, floor);
      g.fillStyle = t === Tile.Path || t === Tile.Bridge ? palette.path : t === Tile.Water ? palette.water : t === Tile.Tree ? palette.tree
        : t === Tile.Rock ? palette.rock : t === Tile.Wall ? palette.wall : t === Tile.Floor || t === Tile.Door ? palette.floor
          : t === Tile.Blocked ? '#3d2847' : floor ? '#130f1e' : palette.ground;
      g.fillRect(x * c, y * c, Math.ceil(c), Math.ceil(c));
      if (layers.hitboxes && isBlocking(t)) {
        g.fillStyle = t === Tile.Wall || t === Tile.Blocked ? 'rgba(246, 117, 122, 0.42)' : 'rgba(242, 160, 107, 0.36)';
        box(x, y);
      }
    }
  }
  // With Tiles on, a thin line around every tile; always a faint line every five.
  if (layers.grid) {
    g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    g.lineWidth = 1;
    for (let x = 0; x <= map.width; x++) g.strokeRect(x * c, 0, 0, canvas.height);
    for (let y = 0; y <= map.height; y++) g.strokeRect(0, y * c, canvas.width, 0);
  }
  g.strokeStyle = layers.grid ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.06)';
  g.lineWidth = layers.grid ? 1 : 0.5;
  for (let x = 0; x <= map.width; x += 5) g.strokeRect(x * c, 0, 0, canvas.height);
  for (let y = 0; y <= map.height; y += 5) g.strokeRect(0, y * c, canvas.width, 0);
  g.strokeStyle = '#f2dc6b';
  g.lineWidth = 1.5;
  for (const b of map.buildings) g.strokeRect(b.x * c, b.y * c, b.width * c, b.height * c);
  // Walls on a tile's side, as thin boxes along their edges.
  g.fillStyle = palette.wall;
  const thick = Math.max(2, c * 0.25) / c;
  for (const w of map.edgeWalls ?? []) {
    if (w.floor === floor) box(w.x - (w.along === 'v' ? thick / 2 : 0), w.y - (w.along === 'h' ? thick / 2 : 0), w.along === 'h' ? 1 : thick, w.along === 'v' ? 1 : thick);
  }
  // With Hitboxes on, the band each wall stops bodies in, in the blocked tiles' red.
  if (layers.hitboxes) {
    g.fillStyle = 'rgba(246, 117, 122, 0.85)';
    for (const w of map.edgeWalls ?? []) {
      if (w.floor !== floor) continue;
      const b = wallBox(w);
      box(b.x, b.y, b.w, b.h);
    }
  }
  const dot = (x: number, y: number, colour: string) => {
    g.fillStyle = colour;
    g.beginPath();
    g.arc((x + 0.5) * c, (y + 0.5) * c, Math.max(3, c * 0.45), 0, Math.PI * 2);
    g.fill();
  };
  if (layers.spots && !floor) for (const s of map.spots ?? []) dot(s.x, s.y, '#a7f070');
  if (layers.people) {
    for (const n of map.npcs) if ((n.floor ?? 0) === floor) dot(Math.floor(n.x), Math.floor(n.y), '#6fc3df');
    for (const s of map.creatures) if ((s.floor ?? 0) === floor) dot(Math.floor(s.x), Math.floor(s.y), '#f6757a');
  }
  // The AI Architect's checked steps.
  g.fillStyle = 'rgba(44, 232, 245, 0.32)';
  for (const dr of p.steps ?? []) {
    if (dr.kind === 'paint' || dr.kind === 'wall') for (const [x, y] of dr.tiles) box(x, y);
    else if (dr.kind === 'road') {
      const [[x0, y0], [x1, y1]] = [dr.from, dr.to];
      box(Math.min(x0, x1), y0, Math.abs(x1 - x0) + 1, 2);
      box(x1, Math.min(y0, y1), 2, Math.abs(y1 - y0) + 2);
    } else if (dr.kind === 'house') box(dr.at[0], dr.at[1], dr.floor[0] + 2, dr.floor[1] + 2);
    else if ('at' in dr && Array.isArray(dr.at)) box(dr.at[0], dr.at[1]);
  }
  g.lineWidth = 2;
  for (const [x, y] of p.problems ?? []) {
    g.strokeStyle = TONES.warn;
    g.strokeRect(x * c, y * c, c, c);
  }
  for (const o of p.outlines ?? []) {
    g.strokeStyle = TONES[o.tone ?? 'aim'];
    g.strokeRect(o.x * c, o.y * c, o.w * c, o.h * c);
  }
}
