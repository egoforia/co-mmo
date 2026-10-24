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
  that walks is painted on its own across the four isometric ways
  (`front-left`, `front-right`, `back-left`, `back-right`). Buildings may be
  mirrored.
- **Size consistency & height tiers.** Players and humanoids always stand at
  the same canonical height (`CHARACTER_HEIGHT = 168 px`). Creatures are
  normalized to one of five canonical height tiers relative to players:
  `tiny` (`64 px`), `small` (`112 px`), `medium` (`168 px`), `high` (`224 px`),
  or `colossal` (`320 px`).
- **Model- and API-agnostic pipeline.** Prompts, reference sheets,
  post-processing (chroma-keying, island segmentation, baseline and height
  normalization), and style checks must remain AI model and API agnostic so
  that visual, geometric, and anatomical coherence is preserved regardless of
  which model generated the image or video (`docs/art-pipeline.md`).
- **Reviewable before paying.** Anything that costs money shows the exact
  prompt and references in the Art tab and waits for approval; paid calls go
  through the paint queue and `budget.ts`.
- Character looks have empty hands; weapons and off-hand items are separate
  held items placed by the hand finder.

Where things are:

- The style is `FLAT_ISOMETRIC` (Style Bible v3) in
  `packages/server/src/assets/style-profile.ts`. `assets/style.ts` gives prompt
  builders its words. Never write style or framing sentences anywhere else;
  add a field to the profile instead.
- Buildings: `BUILDING_STYLES` in `packages/shared/src/buildings.ts`. In
  diamond isometric projection (`ISOMETRIC`), buildings never use flat 2D
  exterior billboard pictures (`docs/buildings-and-walls.md`); they stand as
  3D kit houses (`KitHouse`) or tall vertical cutaway walls (`rockWalls`).
  `building-art.ts` paints interior/surface textures (`floor`, `wall`, `door`
  — 100% full-bleed seamless tiles with zero magenta) and `furniture`.
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
  Every building style, a wished one too, has a `kit` look unless it is in
  `WALLED_STYLES` (caves, Old Bramble's tree); `kit-houses.test.ts` checks it
  (`docs/buildings-and-walls.md`, Wished buildings).
- Scenery: the biome kit (`assets/kit.ts`, `assets/wild-kit.ts`).
- Things that stand on tiles (set pieces, props with a footprint, furniture)
  are painted, in an isometric style, standing on exactly their footprint
  (`artFootprint` in shared, `footprintWords` in `assets/style.ts`) and sized
  to its diamond (`isoSpan`); their manifest entry says `view: 'isometric'`
  and the game stands them on those tiles (`client/src/tile-stand.ts`), in
  upright strips when wider than a tile. Trees and rocks stand on one tile.
- Walks and animations: `walk-video.ts`, `walk-frames.ts`, `walk-painter.ts`,
  and `docs/art-pipeline.md`. Walkers are painted in the isometric camera's
  four ways (`ISO_WAYS`: `front-left`, `front-right`, `back-left`,
  `back-right`), all four together on one turnaround sheet from the approved
  picture (`waysSheetPrompt`, cut apart by `waysFromSheet` in clockwise
  turntable order: Col 0 `front-left`, Col 1 `front-right`, Col 2 `back-right`,
  Col 3 `back-left`), so their details match; never a mirror. One way can be
  painted again on its own from the others. Start-up paints nothing; a walk
  clip is made only when the Owner asks in the Art tab. Name a way by the
  picture's corner: "turned to the left" is read as the figure's own left.
  Top-down walks (front, back, left, right) are never painted any more: the
  painter, prompts and Art tab take only `ISO_WAYS`. Old top-down walks and
  pictures are still served, put back and used for held-item hands, so a
  walker shows them until its isometric ways are painted (the Owner,
  2026-10-24).
- Sound: `shared/src/sounds.ts` (descriptions), `sound-maker.ts`.
- The camera: every tile-to-screen sum goes through `PROJECTION` (`ISOMETRIC`)
  in `packages/client/src/projection.ts`; do not write `x * TILE_PIXELS` in
  the scene. Everyone plays through `ISOMETRIC`: the painted ground tiles
  turned into diamonds, kit houses and tall cutaway walls in place of flat
  building pictures.

Changing a prompt changes what is paid for. Show that prompts you did not
mean to change stay byte for byte the same (snapshot them before and after),
and never make paid calls from tests: keep API keys unset.
