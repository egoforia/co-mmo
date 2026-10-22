# Isometric Buildings & Walls Architecture Guide

This document defines the architectural standards, visual rules, rendering mechanics, and asset generation formulas for buildings and walls in **co-MMO**.

All future world building, building kit extensions, and AI asset generations **must follow these rules** to prevent recurring bugs such as flat floor-curb walls, clashing 2D billboard facades, and magenta cutout fringes.

---

## 1. Visual Philosophy: The Isometric Cutaway

co-MMO uses a 2.5D diamond isometric camera projection (`ISOMETRIC`, 45° angle, diamond ground tile grid). 

1. **Seamless Integration:** All architecture must blend naturally with the surrounding diamond ground and road tiles.
2. **True Vertical Depth:** Buildings must look like solid 3D structures with imposing vertical height, not flat rugs or low curbs.
3. **Cutaway Interiors (The Sanctum Arcanum Standard):**
   - When viewed from afar, kit buildings display their roof and full exterior shell.
   - When a player approaches or enters, the roof disappears (or cuts away), leaving **tall vertical walls** standing around the furnished interior floor.
   - In diamond isometric view, **flat 2D painted exterior pictures ("billboard facades") are strictly forbidden.**

---

## 2. The Three Common Mistakes & How to Avoid Them

### Mistake 1: The "Flat Curb / Knee-High Wall" Trap
- **The Problem:** In isometric view, rendering walls only as flat diamond tiles on the ground layer (or with a tiny multiplier like $0.4 \times 64 = 25.6\text{px}$) produces walls that look like floor curbs, doormats, or knee-high curbs that players can seemingly step over. Characters are $80\text{--}90\text{px}$ tall; walls lower than characters destroy spatial immersion.
- **The Rule:** Walls in isometric view must have genuine vertical rise:
  - **Cathedrals & Monumental Buildings (3 storeys):** `wallMultiplier = 3.0` $\rightarrow$ **$192\text{px}$ rise** (`ground.height * 3.0`).
  - **Standard Buildings (Taverns, Scriptoriums, 2-storey houses):** `wallMultiplier = 2.0` $\rightarrow$ **$128\text{px}$ rise** (`ground.height * 2.0`).
  - **Cottages & Single-Storey Enclosures:** Minimum `wallMultiplier = 1.0\text{--}1.5` $\rightarrow$ **$64\text{--}96\text{px}$ rise**.
  - **NEVER** leave a building without vertical wall face extrusion (`rockWalls`).

### Mistake 2: The "Billboard Facade" Trap
- **The Problem:** Pasting a 2D painted exterior illustration over the building footprint works in 2D top-down mode, but severely clashes with diamond isometric projection. It creates an awkward cardboard cutout that cannot properly occlude isometric entities or blend with 45° ground paths.
- **The Rule:** In [`packages/client/src/world-scene.ts`](file:///home/egoforia/dev/co-mmo/packages/client/src/world-scene.ts), 2D exterior pictures are disabled when `PROJECTION.ground.kind === 'diamond'`. Buildings stand exclusively as 3D kit houses (`KitHouse`) or tall cutaway isometric wall structures.

### Mistake 3: The "Chroma-Key Magenta" Asset Generation Trap
- **The Problem:** Beastfolk and character sprites use a solid pure magenta (`#FF00FF`) background for chroma-keying video and walk frames (`docs/art-pipeline.md`). Prompting the image generator with *"on neutral magenta background"* for **wall or floor textures** causes the AI model to generate a cutout sprite surrounded by magenta padding, resulting in bright pink outlines and transparent holes along building edges!
- **The Rule:** **Architectural textures (`*-wall.png`, `*-floor.png`) MUST BE 100% FULL-BLEED, RECTANGULAR, SEAMLESS TEXTURES.** They must fill the entire canvas corner-to-corner with zero alpha, zero transparency, and zero magenta background.

---

## 3. Rendering Pipeline in `world-scene.ts`

Vertical wall extrusion is handled by `rockWalls()` in `packages/client/src/world-scene.ts`:

```ts
private rockWalls(
  rows: number[][],
  left: number,
  top: number,
  style: string,
  art: TileArt | undefined,
  tilemaps: Phaser.Tilemaps.Tilemap[],
  outward: boolean,
): (Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer)[]
```

### How It Works:
1. **Wall Face Selection:**
   - Reads `art?.face` or falls back to `buildingArt(style, 'wall')`.
2. **Rise Calculation:**
   - Multiplies `ground.height` ($64\text{px}$) by the storey height multiplier ($3.0$ for cathedrals $\rightarrow 192\text{px}$, $2.0$ for standard buildings $\rightarrow 128\text{px}$).
3. **Elevated Top Surface (`lifted`):**
   - An isometric tilemap layer of wall tops is created and raised vertically:
     ```ts
     lifted.y -= rise;
     ```
   - This caps the top of the wall with diamond masonry tiles at the true wall height.
4. **Vertical Faces (`registerWallFace`):**
   - For every wall edge open to the camera:
     - **South edge (open to $y + 1$):** `registerWallFace(scene, face, 'south', width, height, rise)`
     - **East edge (open to $x + 1$):** `registerWallFace(scene, face, 'east', width, height, rise)`
   - The face image is placed at screen depth `PROJECTION.depth(tx, ty + 1)` and anchored at `(at.x, at.y - rise)`.

---

## 4. Asset Specifications & AI Prompting Formulas

All architectural textures adhere to **Style Bible v3** (`FLAT_ISOMETRIC`):
- Soft, unlit low-contrast pixel art / vector-like planar aesthetic.
- Subtle bevels and facet seams; no harsh cast shadows or dramatic lighting.
- Muted warm pastel palette aligned with the biome (Sanctum: cream marble, gold filigree, white limestone, polished dark oak).

### Texture Specifications
| Asset | File Name Format | Canvas Dimensions | Type | Mode |
| :--- | :--- | :---: | :--- | :--- |
| **Wall Texture** | `<style>-wall.png` | 128×128 px | Seamless tileable masonry | 100% opaque RGB/RGBA (NO magenta) |
| **Floor Texture** | `<style>-floor.png` | 128×128 px | Seamless tileable flagstones | 100% opaque RGB/RGBA (NO magenta) |
| **Door Texture** | `<style>-door.png` | 128×128 px | Seamless threshold / archway | 100% opaque RGB/RGBA (NO magenta) |

### AI Generation Prompt Templates

#### For Wall Textures:
```text
"<style>-wall: top-down / isometric wall texture for a <building description>. Thick wall block of <materials, e.g. gleaming pale cream marble with ornate carved gold-leaf filigree border along top>, pristine masonry, seamless edge-to-edge tileable pixel art 128x128 style, clean RPG game asset, full-bleed texture filling entire frame, no background, no borders."
```

#### For Floor Textures:
```text
"<style>-floor: top-down floor tile for a <building description>. Polished <materials, e.g. cream marble flagstones in intricate geometric pattern with thin gold grout lines>, elegant flooring, seamless edge-to-edge tileable pixel art 128x128 style, clean RPG game asset, full-bleed texture filling entire frame, no background."
```

---

## 5. Building Kit Grid & Doorway Alignment

Building Kit structures (`packages/shared/src/building-kit/`) operate on a **$2\times 2$ tile bay grid** ($W$ and $D$ are measured in 2-tile bays).

### Bay Alignment Rules
1. **Odd Bay Widths:**
   - To center the doorway on a whole bay, the building width in tiles must be $2 \times (\text{odd number of bays})$.
   - Examples:
     - $18\text{ tiles} = 9\text{ bays}$ (Door bay index $4$, centered at tile $left + 9$).
     - $14\text{ tiles} = 7\text{ bays}$ (Door bay index $3$, centered at tile $left + 7$).
     - $10\text{ tiles} = 5\text{ bays}$ (Door bay index $2$, centered at tile $left + 5$).
2. **Door Position Formula:**
   ```ts
   const door = { x: left + Math.floor(width / 2), y: bottom };
   ```
   This ensures the doorway aligns with both the game's tile path grid and the Building Kit's bay opening.

### Multi-Storey Spec Validation
When extending `KitShape` with `numStoreys`:
- In `packages/shared/src/building-kit/houses.ts`, when clearing openings for towers (`TOWER_ENDS`), openings **must be cleared across all storeys** ($0$ to $N-1$).
- If an opening remains under a tower on any upper floor, `shapeChecks()` will fail with:
  `fits: tower: no window buried in it`.

---

## 6. Developer Checklist for New Buildings & Biomes

Before merging or committing new buildings or biomes, verify:
- [ ] **No Flat Billboards:** In diamond isometric mode, the building does not display a flat 2D exterior picture.
- [ ] **Sufficient Height:** The wall height multiplier in `world-scene.ts` is $\ge 2.0$ ($128\text{px}$) for multi-storey buildings and $\ge 1.0$ ($64\text{px}$) for cottages.
- [ ] **Full-Bleed Textures:** `*-wall.png` and `*-floor.png` have 0 magenta pixels and fill the entire 128×128 image rectangle.
- [ ] **Bay Grid Alignment:** Floor width in tiles is an even number resulting in an odd number of bays (e.g. 10, 14, 18).
- [ ] **Tests Pass:** `npm test` and `npm run typecheck` pass with 0 errors.
- [ ] **Visual Playtest:** An in-game screenshot confirms that characters and furniture are visually enclosed by tall, opaque isometric walls.
