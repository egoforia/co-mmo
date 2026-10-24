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
- **The Problem:** In isometric view, rendering walls only as flat diamond tiles on the ground layer (or with a tiny multiplier like $0.4 \times 64 = 25.6\text{px}$) produces walls that look like floor curbs, doormats, or knee-high curbs that players can seemingly step over. Players are always **`168px` tall (`CHARACTER_HEIGHT`)** and creatures range from `64px` (`tiny`) to `320px` (`colossal`); walls lower than a storey destroy spatial immersion.
- **The Rule:** Walls in isometric view must have genuine vertical rise (`ground.height = 80px` per diamond tile):
  - **Cathedrals & Monumental Buildings (3 storeys):** `wallMultiplier = 3.0` $\rightarrow$ **$240\text{px}$ rise** (`ground.height * 3.0`).
  - **Standard Buildings (Taverns, Scriptoriums, 2-storey houses):** `wallMultiplier = 2.0` $\rightarrow$ **$160\text{px}$ rise** (`ground.height * 2.0`, matching the `168px` canonical player height).
  - **Cottages & Single-Storey Enclosures:** Minimum `wallMultiplier = 1.0\text{--}1.5` $\rightarrow$ **$80\text{--}120\text{px}$ rise**.
  - **NEVER** leave a building without vertical wall face extrusion (`rockWalls`).

### Mistake 2: The "Billboard Facade" Trap
- **The Problem:** Pasting a flat 2D painted exterior illustration over a building footprint severely clashes with diamond isometric projection. It creates an awkward cardboard cutout that cannot properly occlude isometric entities or blend with 45° ground paths.
- **The Rule:** co-MMO runs exclusively in diamond isometric projection (`ISOMETRIC`). Flat 2D exterior pictures are never displayed for buildings. Buildings stand exclusively as 3D kit houses (`KitHouse`) or tall cutaway isometric wall structures (`rockWalls`).

### Mistake 3: The "Chroma-Key Magenta" Asset Generation Trap
- **The Problem:** Beastfolk and character sprites use a solid pure magenta (`#FF00FF`) background for chroma-keying video and walk frames (`docs/art-pipeline.md`). Prompting the image generator with *"on neutral magenta background"* for **wall or floor textures** causes the AI model to generate a cutout sprite surrounded by magenta padding, resulting in bright pink outlines and transparent holes along building edges!
- **The Rule:** **Architectural textures (`*-wall.png`, `*-floor.png`) MUST BE 100% FULL-BLEED, RECTANGULAR, SEAMLESS TEXTURES.** They must fill the entire canvas corner-to-corner with zero alpha, zero transparency, and zero magenta background.

---

## 3. Rendering Pipeline in `world-scene/` & `textures.ts`

Vertical wall extrusion and cutaway rendering are handled by `rockWalls()` in [`packages/client/src/world-scene/walls.ts`](file:///home/egoforia/dev/co-mmo/packages/client/src/world-scene/walls.ts), region/floor assembly in [`packages/client/src/world-scene/regions.ts`](file:///home/egoforia/dev/co-mmo/packages/client/src/world-scene/regions.ts), depth helpers in [`packages/client/src/world-scene/types.ts`](file:///home/egoforia/dev/co-mmo/packages/client/src/world-scene/types.ts), and `registerWallFace()` / `registerDiamondTileset()` in [`packages/client/src/textures.ts`](file:///home/egoforia/dev/co-mmo/packages/client/src/textures.ts):

### 1. Single Wall Asset Rule (`<style>-wall.png`)
- Every building style uses **1 seamless $128\times 128$ texture (`<style>-wall.png`)** for both the top coping cap and vertical wall faces (no separate `*-wall-face.png` assets).
- `registerWallFace()` tiles the texture vertically per storey (`storeys = Math.max(1, Math.round(rise / (height * 2)))`) so multi-storey walls keep uniform stone/timber courses without stretching.
- East-facing wall segments receive a subtle cool-grey tint (`EAST_WALL_TINT = 0xd4d4dc`, stored in `baseTint`) so $90^\circ$ corners read clearly in 3D space.

### 2. Half-Tile ($0.5\times$) Wall Thickness (`80×40px` Sub-Diamonds)
- Full ground tiles are $160\times 80\text{px}$ diamonds (`PROJECTION.ground`).
- Wall top coping caps are rendered on a $2W \times 2H$ half-tile diamond grid (`halfGround = { width: 80, height: 40 }`) via `registerDiamondTileset(scene, tilesetKey, 80, 40)`.
- The inner half of each wall tile exposes the room's floor tile seamlessly (`floorRows` maps `Tile.Wall` to `Tile.Floor` on the base layer), giving walls a realistic $0.5\text{m}$ thickness and opening up interior floor space.

### 3. Asymmetric Cutaway & 4-Direction Corridor Rule
- **Closed Exterior Shell (`v.outside`, `cutaway = false`):**
  - When the player is outside and far from a building (`v.open === false`), all 4 perimeter walls stand at full storey height (`storeyRise`: $160\text{px}$ for standard buildings, $240\text{px}$ for cathedrals), stacked across closed storeys and capped by a roof layer.
- **Interior Cutaway (`v.inside`, `cutaway = true`):**
  - When the player approaches (`v.open === true`), `v.outside` fades out (`alpha = 0`) and `v.inside` fades in (`alpha = 1`).
  - **Far Back Walls (North / West perimeter & Far North/West corridor flanks):** Any wall tile with no indoor floor to its North/West and indoor floor to its South/East (`isFull(x, y) === true`) stands at **Full Storey Height (`storeyRise`)**.
  - **Near Camera-Facing Walls (South / East perimeter, interior dividers, & Near South/East corridor flanks):** Any wall tile with indoor floor to its North/West (`isFull(x, y) === false`) cuts low to **Knee-High Cutaway (`WALL_RISE = 0.25`, `~20px`)** so the player, furniture, and narrow corridors in all 4 isometric directions (`Top-Right`, `Bottom-Left`, `Top-Left`, `Bottom-Right`) are never occluded.
- **KitHouse Compatibility (`standHouse`):**
  - Fallback `floor` and `rockWalls` objects are tagged with `.setData('shell', true)`. When a `KitHouse` (`outside.png` + `storey-1.png`) finishes loading, `standHouse()` hides and removes all `shell` objects so fallback walls never cover the `KitHouse` cutaway.

### 4. Multi-Floor Vertical Stacking (`floorLift` & `floorDepthOffset`)
- Upper storeys (`floor > 0`) are vertically elevated on screen by `floorLift(floor) = floor * Math.round(ground.height * 2.0)` ($160\text{px}$ per storey) and sorted above lower storeys via `floorDepthOffset(floor) = floor * 50_000`.
- When standing on an upper floor (`mine > 0`), lower storeys (`0 .. mine - 1`, including the building's `v.inside` cutaway and surrounding ground) remain visible and dimmed underneath via `setDepthShade()`.

---

## 4. Asset Specifications & AI Prompting (`FLAT_ISOMETRIC`)

All architectural textures adhere strictly to **Style Bible v3** (`FLAT_ISOMETRIC` in [`packages/server/src/assets/style-profile.ts`](file:///home/egoforia/dev/co-mmo/packages/server/src/assets/style-profile.ts)):
- **Style:** Stylised low-poly / flat-faceted planar aesthetic built from clean geometric planes with crisp edges (`FLAT_ISOMETRIC.interior.pixelArt === false`; never pixel art).
- **Lighting:** **Unlit flat shading (`NO LIGHTING AT ALL`).** Every material facet uses a flat base color with thin seam boundaries—no baked cast shadows, no specular highlights, no gradients, and no ambient glow (the game's dynamic lighting pipeline lights all surfaces at runtime).
- **Palette:** Muted warm pastel palette aligned with the biome (e.g., Sanctum: cream marble, gold filigree, white limestone, polished dark oak).
- **Single Source of Style Words:** Never hardcode ad-hoc style or framing sentences outside [`style-profile.ts`](file:///home/egoforia/dev/co-mmo/packages/server/src/assets/style-profile.ts) (`FLAT_ISOMETRIC.interior.style`, `FLAT_ISOMETRIC.interior.tileFraming`, and `FLAT_ISOMETRIC.kitTextures`).

### Texture Specifications
| Asset | File Name Format | Canvas Dimensions | Type | Mode |
| :--- | :--- | :---: | :--- | :--- |
| **Wall Texture** | `<style>-wall.png` | 128×128 px | Seamless square-on flat-faceted masonry | 100% opaque RGB/RGBA (NO magenta) |
| **Floor Texture** | `<style>-floor.png` | 128×128 px | Seamless square-on flat-faceted flooring | 100% opaque RGB/RGBA (NO magenta) |
| **Door Texture** | `<style>-door.png` | 128×128 px | Seamless square-on threshold / archway | 100% opaque RGB/RGBA (NO magenta) |

### Prompt Construction (`building-art.ts` & `style-profile.ts`)
Prompt builders combine `FLAT_ISOMETRIC.interior.style` and `FLAT_ISOMETRIC.interior.tileFraming` with the building style's material description in `BUILDING_STYLES` ([`packages/shared/src/buildings.ts`](file:///home/egoforia/dev/co-mmo/packages/shared/src/buildings.ts)):

```text
<FLAT_ISOMETRIC.interior.style>
<FLAT_ISOMETRIC.interior.tileFraming>
Subject: inside <building style name>, <wall / floor / door material description>.
Colours: match the reference painting of the same building from outside.
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
- [ ] **Sufficient Height:** The wall height multiplier in `world-scene/regions.ts` (`rockWalls` in `world-scene/walls.ts`) is $\ge 2.0$ ($128\text{px}$) for multi-storey buildings and $\ge 1.0$ ($64\text{px}$) for cottages.
- [ ] **Full-Bleed Textures:** `*-wall.png` and `*-floor.png` have 0 magenta pixels and fill the entire 128×128 image rectangle.
- [ ] **Bay Grid Alignment:** Floor width in tiles is an even number resulting in an odd number of bays (e.g. 10, 14, 18).
- [ ] **Kit Look:** The style has a `kit` look from `building-kit/looks.ts` (add a new look there when none fits), unless it is one of `WALLED_STYLES` in `buildings.ts`. `kit-houses.test.ts` fails for any other style without one, or for a building whose floor or doorway is off the bays.
- [ ] **Tests Pass:** `npm test` and `npm run typecheck` pass with 0 errors.
- [ ] **Visual Playtest:** An in-game screenshot confirms that characters and furniture are visually enclosed by tall, opaque isometric walls.

## Wished buildings

An Engine wish for a building adds a style to `BUILDING_STYLES` and places
it, behind `modOn(engineModId(<issue>))` like any wish. It stands as a kit
house: give the style a `kit` look (an existing one, or a new `KitLook` in
`building-kit/looks.ts` with its own words) and, for a hall, a `kitShape`;
give it a floor from `KIT_HOUSE_FLOORS` or any width of an odd number of
bays. Only the caves and Old Bramble's hollow tree (`WALLED_STYLES`) stand as
tall walls; a wish never adds to that list. A house in an existing look
shares that look's painted sheet; a new look's sheet is painted by the
Owner in Art > Building looks.

## Checking buildings in the Art tab

Art > Buildings lists every building in every land: whether it stands as a
kit house or as tall walls (and why), the kit house's views as the game
shows them, and each piece of furniture with its footprint. On the ground
floor the Owner can change a footprint; it is saved as a world edit
(`footprint`), so the picture stays where it is and only the tiles it
blocks change. A footprint cannot grow into a wall or another piece.
