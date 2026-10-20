---
name: co-mmo-art
description: Use for any co-MMO change that paints, prompts for, cuts, places or shows art or sound: buildings, walks, held items, scenery, the Art tab, the style or the camera.
---

# Art in co-MMO

Rules from the Owner, all binding:

- **No art drawn in code.** No canvas shapes, Phaser graphics or tinted
  stand-ins. Every picture comes from the image model chosen in God's View,
  from a description. The only exceptions are the invisible pose guides
  (`assets/pose-guide.ts`) and the building doorway sketch, which steer the
  model and are never shown to players, and the building kit, whose shapes
  code builds and the image model paints (the Owner, 2026-10-18). The wish
  guard refuses drawing code.
- **No left/right mirroring of characters.** Each direction of anything
  that walks is painted on its own. Buildings may be mirrored.
- **Size consistency.** Things of a kind are the same size in game (all
  people 168 px tall).
- **Reviewable before paying.** Anything that costs money shows the exact
  prompt and references in the Art tab and waits for approval; paid calls go
  through the paint queue and `budget.ts`.
- Character looks have empty hands; weapons and off-hand items are separate
  held items placed by the hand finder.

Where things are:

- The style is one `StyleProfile` in
  `packages/server/src/assets/style-profile.ts`, picked by `ART_STYLE`.
  `assets/style.ts` gives prompt builders its words. Never write style or
  framing sentences anywhere else; add a field to the profile instead.
- Buildings: `BUILDING_STYLES` in `packages/shared/src/buildings.ts`, painted
  whole by `building-art.ts`. Outside art is centred on the south-wall
  doorway and covers the walls; the inside matches it.
- Kit buildings: `packages/shared/src/building-kit/` builds a house from a
  `BuildingSpec` (bays, storeys, doors, windows, stairs) into exact parts,
  and `shapeChecks` measures every joint. `server/src/assets/building-kit/`
  draws each view (outside and each storey's cutaway) into unlit colour,
  normal and glow maps and runs the picture checks on it. Never accept a
  building the checks refuse; fix the kit or the layout instead. The image
  model paints only the flat textures the parts are covered with, on one
  sheet per look (`sheet.ts`; a look's words in `KIT_LOOKS`, the style's in
  the profile's `kitTextures`), and only textures that pass the sheet checks
  are used. Keep the sheet layout: today's paintings are read against it.
- Scenery: the biome kit (`assets/kit.ts`, `assets/wild-kit.ts`).
- Walks: `walk-video.ts`, `walk-frames.ts`, `walk-painter.ts`. Start-up
  makes walks for the four top-down ways (`WALK_DIRECTIONS`). The isometric
  camera's four ways (`ISO_WAYS`: front-left, front-right, back-left,
  back-right) each get a standing picture, painted on its own from the
  pictures of the ways either side (`ISO_WAY_BESIDE`), never a mirror, and a
  walk clip only when the Owner asks in the Art tab. Name a way by the
  picture's corner: "turned to the left" is read as the figure's own left.
- Sound: `shared/src/sounds.ts` (descriptions), `sound-maker.ts`.
- The camera: every tile-to-screen sum goes through `PROJECTION` in
  `packages/client/src/projection.ts`; do not write `x * TILE_PIXELS` in
  the scene. Everyone plays through `ISOMETRIC`: the painted ground tiles
  turned into diamonds, kit houses in place of painted buildings. The
  top-down view is retired (2026-10-20); `TOP_DOWN` stays only as the
  Owner's old view (Account window) until the lands are repainted, so keep
  it working but paint nothing new for it.

Changing a prompt changes what is paid for. Show that prompts you did not
mean to change stay byte for byte the same (snapshot them before and after),
and never make paid calls from tests: keep API keys unset.
