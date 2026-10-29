# Architecture: the module map

Where each part of co-MMO lives, what it promises, what it may use, and how
to replace it. Read this before adding a feature or swapping a module; the
design itself is in `design.md`.

## The three packages

| Package | Runs on | May import |
| --- | --- | --- |
| `packages/shared` | server and browser | nothing of ours |
| `packages/server` | Node | `@co-mmo/shared` |
| `packages/client` | browser (Phaser 3) | `@co-mmo/shared` |

The server simulates in **tiles** (x east, y south) and never knows how the
world is drawn. The client turns tiles into pixels in one place
(`projection.ts`). Rules both sides must agree on live in `shared`.

## Swappable parts and their contracts

Each row is an interface with one or more implementations. Replacing a part
means writing one class that implements the interface (or a third-party
adapter) and picking it in the place named under "Chosen in".

| Part | Contract | Implementations | Chosen in |
| --- | --- | --- | --- |
| Saved world | `StoreBackend` (`server/src/store.ts`) | JSON file, Postgres (`store-postgres.ts`) | `main.ts` (`DATABASE_URL`) |
| Messages between servers | `Bus` (`bus.ts`) | `MemoryBus`, `RedisBus` | `main.ts` (`REDIS_URL`) |
| Paint queue | `PaintQueue` (`paint-queue.ts`) | `MemoryPaintQueue`, `SharedPaintQueue` (Redis) | `main.ts` |
| Where regions run | `Hosting` (`world.ts`), `RegionHandle` (`region-link.ts`) | in process, `RegionServers` + `RemoteRegion` | `main.ts` (`REDIS_URL`); `scripts/dev.mjs` starts `REGION_SERVERS` of them |
| Language models | `ChatModel` (`ai/chat.ts`) | Gemini, Claude, OpenAI-compatible, offline God | `ai/services.ts` |
| Pictures | `ImageProvider` (`assets/provider.ts`) | Gemini image models | `ai/services.ts` |
| Video (walks) | `VideoProvider` (`assets/video.ts`) | Veo | `ai/services.ts` |
| Music and effects | `SoundProvider` (`assets/sound.ts`) | Lyria, ElevenLabs | `ai/services.ts` |
| Art style | `StyleProfile` (`assets/style-profile.ts`) | `FLAT_ISOMETRIC` | `chooseStyle` (`ART_STYLE`) |
| Camera | `Projection` (`client/src/projection.ts`) | `ISOMETRIC` | `chooseCamera` (`client/src/camera.ts`) |
| Building shapes | `BuildingSpec` in, `KitBuilding` parts out, judged by `shapeChecks` (`shared/src/building-kit/`) and `pictureChecks` (`server/src/assets/building-kit/`) | timber-frame kit (`K`), crowns (`crown.ts`) | `kitHouse` (a building style's `kit` look), drawn by `KitHouses` for the isometric camera |
| Building textures | a `KitLook`'s words in, a sheet painted to `regions()` out, judged by `checkSheet` (`server/src/assets/building-kit/`) | `TIMBER_COTTAGE` and the great halls' looks | `KitSheets` in `app.ts` |
| God's View tab | `Tab` (`client/src/gods-view/core.ts`) | one file per tab in `gods-view/` | `TABS` in `gods-view.ts` |

Every contract has a test a new implementation must pass:
`server/test/services.test.ts` (services swap one at a time),
`server/test/style-profile.test.ts`, `client/test/projection.test.ts`,
`shared/test/building-kit.test.ts`, `server/test/building-kit-render.test.ts`
and `server/test/building-kit-sheets.test.ts` (good buildings and sheets pass,
every planted fault is caught), `shared/test/kit-houses.test.ts` and
`server/test/kit-houses.test.ts`, and the store, bus and paint-queue tests.

## Server modules

**Start-up.** `main.ts` reads the environment and picks backends;
`app.ts` builds every service once and passes each its parts (no part is set
on another object after it is built). `region-main.ts` starts a region server.

**Services every feature uses.**
- `settings.ts`: the Owner's saved settings, their defaults and readers.
- `budget.ts`: the monthly budget, the daily cap, recording spend. Anything
  that pays calls `budget.spend`, and checks `budget.paused()` first.
- `ai/services.ts`: picks every chat, image, video, music and effects service
  from settings, keys and the budget; tests override one at a time.
- `api-log.ts`: records every request to an outside service, secrets masked.

**How hard it works.** `load-meter.ts` times each tick, ticks a second,
the event loop's delay and memory, in the gateway and every region server;
God's View's Server health tab shows every host, and `perf.ts` gives the
performance overlay the host running a player's region.
`region/profiler.ts` times each simulation phase (`inputs`, `sky`, `combat`,
`minds_think`, `bodies`, `minds_live`, `fallen`, `snapshots`, and sandbox
wishes in `app.ts`), keeping rolling averages and worst times.
`debug/slow-tick-buffer.ts` captures any tick exceeding the 50 ms budget
with entity counts, active statuses, and per-phase timings.
`debug/profiler-session.ts` takes on-demand 10-second V8 CPU profiles and
heap snapshots via Node's built-in `node:inspector` with automatic file pruning.

**Debugging and inspection.**
- `region/inspect.ts`: live entity inspection (HP, Energy, threat list,
  statuses, signature gauge pips, brain cooldowns) streamed on demand.
- `region/combat-logger.ts`: 500-event ring buffer recording hit traces
  (attacker, target, damage type, scaling, rolls, Armor/Ward mitigations,
  threat deltas) viewable in God's View and downloadable as JSON.
- `debug/prng.ts`: Mulberry32 deterministic pseudo-random number generator.
- `debug/region-recorder.ts`: captures initial region state and per-tick
  player inputs into a `ReplayTrace` (chat messages scrubbed for privacy).
- `tools/replay.ts`: headless CLI tool to replay traces bit-for-bit with
  optional step debugging and snapshot hash verification.

**HTTP and the socket.** `http.ts` (JSON, files, bearer tokens),
`account-routes.ts`, `auth.ts`, `admin.ts` (God's View API; `art-buildings.ts` lists
every building for the Art tab's Buildings page), `art-files.ts`
(table of painted-art URLs), `game-socket.ts` (the player WebSocket).

**The world.** `world.ts` (regions, travel, hosting), `region.ts` (one
region's tick: movement, snapshots, joining and leaving) with its systems in
`region/`: `state.ts` (who and what is here, shared by all), `combat.ts`
(attacks, rewards, and `useAbility`, which looks each ability's effect up in
`effects/`: one small file per family of the effect kit, all given the same
`EffectKit` moves, and `skills/`: one file per Calling for what a core skill
does beyond its effect's data, as a `SkillRule`), `statuses.ts` (putting statuses on players and creatures,
Vigor shortening them, damage ticks), `gauges.ts` (each player's signature
gauge: what fills, empties and spends it, sent as a `gauge` message),
`fallen.ts`,
`minds.ts` (runs the creatures and NPCs below each tick), `kit.ts` (gear, items, crafting, shops),
`quests.ts` (talking and quests), `bodies.ts` (loot) and `chat.ts`,
`region-views.ts` (what players see of each thing: the one shape both
snapshots and split-region borders send), `split-region.ts`, the
`region-*`/`remote-region.ts` files for region servers, `parties.ts`,
`trades.ts`, `character-ops.ts`. What lives in a region keeps its own module:
`creature-brain.ts` (each creature's behaviour: wander, guard, chase,
patrol, timid, pack; sleep out of its hours, fleeing) with `threat.ts`
(who it fights: the threat list, the 10% rule, taunts), `townsfolk.ts`
(people keeping their day) and `walkers.ts` (moving and path finding both
use). The hour and weather come from shared `sky.ts`, worked out from the
clock and the region alone, so every server, cell and browser agrees
without being told; people's days are in shared `routines.ts`.
Character rules are shared `rpg.ts`, a face over `rpg/`: `attributes.ts`
holds the five attributes' numbers (health, Energy, regeneration, attack
power, speed and reach, crits, stagger, dodge, block, cooldowns, Armor and
Ward; `docs/attributes.md`), `callings.ts` how a people and Calling
build them (creation, level-ups, free points, changing Calling),
`abilities.ts` the effect kit an ability is made of (`AbilityEffect`,
`AbilityDef`) and `statuses.ts` the status rules both sides use (lengths,
stun immunity, pace, shields; `docs/attributes.md#statuses`), and
`gauges.ts` the signature gauges' numbers (`docs/classes.md#signature-gauges`),
and `skills.ts` learning core skills and the six-key hotbar the server
checks. Each Calling's skill data is one file in shared `skills/`. Shared
`wished-abilities.ts` holds the world-set numbers for each effect a wish may
choose. Statuses travel in snapshots; until their icons are painted (build
plan step 10) the browser shows them as words on name tags and the HUD. The
peoples and Callings themselves are plain data in shared `races.ts` and
`classes.ts` (`docs/races.md`, `docs/classes.md`).
A character saved before Callings is held at `game-socket.ts` with a
`callingNeeded` message until it answers `chooseCalling`; changing people or
Calling later is a `calling` wish made only in the Workshop, like a new look.
Shared `weapons.ts` holds the weapon and off-hand families, damage types,
creature Armor and Ward, and `trainedIn`, which says whether a Calling is
trained in a family (`docs/classes.md#weapons`).

**Wishes.** `wishes.ts` is one face over the parts in `wishes/`:
`prayers.ts` (talking to the God, its limits and cost), `cards.ts` (wish
cards and what saying yes does), `granting.ts` (putting wishes into the
world, review, switching off and on, undo), `drafting.ts` (scripted rule
drafts), `painter.ts` (wish art) and `news.ts` (telling players and
Stewards). Every granted wish is a mod: `shared/src/mods.ts` holds the
switch (`modOn`) that Engine wish code checks. `god.ts` (the God's
prompts), `workshop.ts` (Wish Workshop), `compiler.ts` + `rules.ts` +
`rule-test.ts` + `live-rules.ts` (scripted rules in the QuickJS sandbox),
`builds.ts` (Engine wishes built on GitHub).

**Art and sound.** `assets/` holds the providers, the style profile and every
prompt builder; `art-jobs.ts` (the painting log), `art-recipes.ts` (what was
sent for each picture), `art-history.ts` (versions), `art-studio.ts` (Art
tab API facade) + `art-studio/`: `types.ts` (studio interfaces), `catalog.ts`
(asset scanning, prompt builders, hand/ways sheet assembly and overview) and
`review.ts` (dry-run review preview registry `REVIEW_HANDLERS`, single-item
review and missing-art batch estimator), `building-painter.ts`, `walk-painter.ts`, `hand-finder.ts` +
`hand-sources.ts`, `sound-maker.ts`, `normal-painter.ts` (painted normal
maps), `paint-requests.ts` (resume after restart). `assets/style.ts` names the active profile's words for the
prompt builders; never write style sentences anywhere else.

**The lands.** Shared `world.ts` lays out each region from its definition
(256 tiles a side), `places.ts` adds the launch lands' great places (temple,
caves, castle, palaces, tomb and wonders, joined by roads and bridges) and
`lands.ts` their creatures, treasures, people and quests. Every picture
they need is a description: buildings in `land-buildings.ts`, the rest in
`server/src/assets/land-anchors.ts`.

**Floors.** Shared `floors.ts`: the ground is floor 0, a building's upper
floors 1, 2... and the floors under it -1, -2... Each floor off the ground is
a `Storey` on the map, its own tiles over a rectangle (`tileAt` and
`collides` take a floor; off every storey a floor is solid). A `Stairway`
(stairs, or a ladder only players and people climb) takes up the same tiles
on the two floors it joins; stepping onto it puts you on the landing beside
it on the other floor (`walkOn`, used by the server and by each browser's
prediction alike). Players, creatures, NPCs and bodies carry their floor, and
snapshots, fights, talk, loot, trades and chat only reach the same floor.
Walkers take stairs only on purpose (`goTo`, `stairsToward`): a creature
follows its prey up stairs within its leash, never up a ladder; people who
live upstairs come down to the square. `buildFloors` gives a building floors
and finds room for each flight; the world editor's Floors tool uses it. The
browser draws only the floor you are on: upstairs over its building, with
the land below around it; underground, the land above hidden. Your floor is
saved with your place. Stairs show their painted pictures (`Stairway.art`)
once there are any, and always a label saying where they go.

**The Smugglers' Sea Cave.** Shared `sea-cave.ts`: the shore's sea cave built
from its Art Kit (wish #75) while that wish is on. Each of its six floors (the
Lookout, Gallery and Smugglers' Loft above, the Cave Mouth, the Tide Grotto
and Drowned Hoard below) is a plan of letters the size of its walls: rock,
floor, plank walkway, kit props, stairs and ladders. The building carries
`Building.art` (like `Storey.art`), so it shows no outside picture and is
drawn in the kit's rock, floor and plank tiles (`registerKitTileset`); stairs
name the floors they join. In the isometric camera its walls stand up, cut
low like the building kit's near walls: their tops lifted and the painted
`sea-cave-rock-face` (`TileArt.face`) fitted to each edge facing the camera
(`registerWallFace`; the east side mirrored). Lamps burn only on their own floor. With the wish
off the painted one-floor cave stands as before.

**The world editor.** The Owner and Stewards change the lands in the game
(the "Edit world" button). An edit is data on its land's definition
(`RegionDef.edits`, shared `world-edits.ts`): paint ground, paths, water,
trees or rocks; move or take away a tree, rock, water or set piece; a road;
a house of any building style (kit-friendly floor sizes, so it stands as a
kit house in the isometric camera); floors above and below a building, by
stairs or ladders; a set piece's or furniture's footprint (the tiles it
blocks, from the Art tab's Buildings page); a monster spawn; clearing monsters
away. `generateRegion` lays the edits over the land in order, so the server,
every region server and every browser lay out the same map, and a browser
draws a land again when its definition changes. `world-editor.ts` keeps
each land's edits in the store (`world_edits` table) with undo and redo,
refuses edits that do not fit or would block where players arrive, and has
`World.reshape` set the land up again wherever it runs, players put back
where they stood or the nearest open spot. Routes in `world-edit-routes.ts`;
the window is `client/src/editor-ui.ts`, whose tile outlines are the
editor's own marks, seen only while it is open, never game art.

**The building kit.** `shared/src/building-kit/` (exported as `buildingKit`)
turns a building as data (`BuildingSpec`: footprint in bays, doors and
windows per wall, stairs, and a crown: a pitched or flat roof,
battlements, corner towers, a dome; `crown.ts`) into exact parts on one set
of sizes, with each storey's blocking lines and a cutaway per storey. `shapeChecks` measures
every recorded joint on the placed solids (rests on, set into, held by,
clear of, level with) and that walls are complete, nothing floats and the
stairs fit. On the server, `assets/building-kit/` draws every view (outside
and each storey's cutaway, on one frame) into unlit colour, normal and glow
maps (`buildingViews`) and checks the picture: hidden faces stay hidden, no
gaps, no stretched paint, no layout colour, no two surfaces in one place,
rooms take only inside light, the way down shows. Code makes the shapes; the
image model paints only their flat textures, all of a look at once on one
sheet: a magenta guide with a green shape per texture (`sheet.ts`), painted
through the Art tab's review (Art > Building looks), the budget and the
paint queue (`ArtStudio.paintSheet`, route `art/sheet`). `KitSheets` keeps each painting
with its layout and words (shipped ones in `assets/kit-sheets/`, later ones
in the art folder) and checks them in a worker thread (`sheet-checks.ts`,
`tiling.ts`): in place, filled, no spill, no baked light, even, no frame, and
a tile that repeats without slicing shapes. Each texture comes from the
newest painting where it passed. In play so far: a building style with a
`kit` look (`BUILDING_STYLES`) whose floor falls on whole bays, two tiles to
a bay, becomes a kit house on that floor (`kitHouse`), shaped by the
style's `kitShape`; each land's great hall (temple, castle, coral palace,
desert palace) is one, in a look of its own; `KitHouses` draws it
in a worker the first time `GET /api/kit-houses` asks (any signed-in
player, for the isometric camera), keeps it in the art folder and draws it again when
its look is painted again. The game's collision is still its wall tiles.

## Client modules

`main.ts` (sign-in and boot), `net.ts` + `api.ts` (server talk),
`world-scene.ts` (the Phaser scene facade; positions go through `PROJECTION`, and
walkers face its `ways`: the four isometric ways show standing pictures
until walks are made for them, and a walker with no isometric pictures yet
shows its old top-down ones; the
ground, trees and rocks are drawn in chunks near the player) + `world-scene/`:
`types.ts` (view interfaces, floor depth and shade helpers), `walls.ts`
(`rockWalls` half-tile coping and vertical wall extrusion), `regions.ts`
(terrain chunks, building shells, `KitHouse` upgrade and `applyFloorView`),
`avatars.ts` (player, NPC, creature and loot views, `FigureMetricsCache` for
opaque bounds and hand grips, walk animations and speech bubbles) and `combat.ts`
(hit sparks, floating numbers, screen shake, sound cues and mini-map view), `sky.ts` (the
light of the hour and the weather),
`textures.ts` (tilesets from painted art, and the same tiles turned into
diamonds for the isometric camera), `camera.ts` (isometric projection for everyone), `kit-house-view.ts` (kit
houses stood on their floors in upright strips, so walkers pass behind and in
front of them), `tile-stand.ts` (how a picture stands on its tiles: set pieces
and furniture wider than a tile in the same upright strips, and a picture
painted for the isometric camera, `view: 'isometric'` in the manifest, as
wide as its footprint's diamond), `wished.ts` (wished content),
`lights.ts` + `lit-pipeline.ts` (pictures are lit by the sky's colour, the
sun or moon of the hour from shared `lighting.ts`, and lamps at fires,
lanterns, shrines and windows; characters get a rim light; `light-preview.ts`
shows the same light in the Art tab), `normal-maps.ts` + `relief.ts` + `relief-worker.ts` (a normal map
worked out for every picture in a worker; a painted `<key>-normal` wins),
`sound.ts`, `perf-overlay.ts` + `perf-stats.ts` (the performance overlay for
Stewards and the Owner, F3 or Account: frame rate and stutters, draw calls,
objects, lights, pictures held for the GPU, memory, ping and snapshots, what
is drawn near you, and the server running your part of the world from
`GET /api/admin/perf`; it measures nothing while hidden), `mini-map.ts` +
`mini-map-plan.ts` + `mini-map-art.ts` (the mini map, M or the HUD's Map
button: your floor centred on you, turned as the camera turns, put together
from the land's painted tiles, trees, set pieces and people's pictures
shrunk, with zoom and a look at the other floors where you stand;
minimized or closed it draws nothing; the
scene hands it `miniMapView()`), and one `*-ui.ts`
per panel. God's View is
`gods-view.ts` (shell) plus `gods-view/*.ts`, `art-ui.ts` (Art tab shell and
`BUTTON_ACTIONS` dispatch table) + `art-ui/` (`state.ts` shared `artState`,
`pages.ts` sub-tab renderers, `walkers.ts` character/ways/hand-point editors,
`dialogs.ts` review and history modals, `buildings.ts` the Buildings page:
each building's kit views and furniture hit boxes), `loot-tab.ts` and
`api-log-ui.ts`.

## Changing something big

| Change | What to write |
| --- | --- |
| New art style | A `StyleProfile` in `style-profile.ts`, `ART_STYLE=<id>` in `.env`, then repaint from the Art tab (old versions stay for rollback). `server/test/style-prompts.test.ts` snapshots every prompt, so the change shows word for word. |
| Isometric camera & kit buildings | Everyone plays through `ISOMETRIC`, painted in the `FLAT_ISOMETRIC` style. Walkers are painted in their four isometric ways together on one turnaround sheet (Art tab, `waysSheetPrompt`), and start-up paints no walks. Set pieces and furniture stand in upright strips on their footprints (`artFootprint`, `footprintWords`) and are sized to them (`isoSpan`). Buildings stand as 3D `KitHouse` structures or tall vertical cutaway walls (`docs/buildings-and-walls.md`). |
| New AI service | An adapter implementing the provider interface, and one branch in `ai/services.ts`. |
| New database | A `StoreBackend` class and its choice in `main.ts`. |
| New God's View tab | A file in `gods-view/` exporting a `Tab`, and one line in `TABS`. |
| New Art studio review action | An entry in `REVIEW_HANDLERS` (`server/src/art-studio/review.ts`) and `BUTTON_ACTIONS` (`client/src/art-ui.ts`). |

## The robot playtester

`packages/server/playtest/`: robot players (`bot.ts`) and a browser play the
real server with fake AI; `npm run playtest`. One `*.play.ts` per area of
play; a new feature adds one. See `playtest.md`.

## Rules every module keeps

- A short doc comment on each export; comments say why.
- Keep new or freshly split modules under ~400 lines. When an existing module
  grows past ~500 lines or mixes distinct domains, split it into a thin facade
  (`<module>.ts`) and focused submodules (`<module>/*.ts`, like `wishes/`,
  `region/`, `art-studio/`, `world-scene/`, `art-ui/`, `gods-view/`). Add new
  domain logic to the matching submodule, never by growing the facade.
- Paid calls go through the paint queue and the budget, and are reviewable
  before they are sent (the Art tab shows the exact prompt).
- No art drawn in code (the building kit's shapes are the one exception:
  code builds them, the image model paints them), and no left/right
  mirroring of characters.
- Limits and settings come from `.env` or God's View, not constants in code.
- Words players read are plain and friendly, never error codes.
- The wish guard (`scripts/wish-guard.mjs`) protects core files by path:
  moving or adding a core file means adding it to `CORE` there.

## Next splits (not done yet)

A renderer interface around Phaser.
