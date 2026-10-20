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
| Art style | `StyleProfile` (`assets/style-profile.ts`) | `STORYBOOK` | `chooseStyle` (`ART_STYLE`) |
| Camera | `Projection` (`client/src/projection.ts`) | `TOP_DOWN`, `ISOMETRIC` (the Owner's preview) | `chooseCamera` (`client/src/camera-preview.ts`) |
| Building shapes | `BuildingSpec` in, `KitBuilding` parts out, judged by `shapeChecks` (`shared/src/building-kit/`) and `pictureChecks` (`server/src/assets/building-kit/`) | timber-frame kit (`K`) | `kitHouse` (a building style's `kit` look), drawn by `KitHouses` for the isometric camera |
| Building textures | a `KitLook`'s words in, a sheet painted to `regions()` out, judged by `checkSheet` (`server/src/assets/building-kit/`) | `TIMBER_COTTAGE` | `KitSheets` in `app.ts` |
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

**HTTP and the socket.** `http.ts` (JSON, files, bearer tokens),
`account-routes.ts`, `auth.ts`, `admin.ts` (God's View API), `art-files.ts`
(table of painted-art URLs), `game-socket.ts` (the player WebSocket).

**The world.** `world.ts` (regions, travel, hosting), `region.ts` (one
region's tick: movement, snapshots, joining and leaving) with its systems in
`region/`: `state.ts` (who and what is here, shared by all), `combat.ts`,
`minds.ts` (runs the creatures and NPCs below each tick), `kit.ts` (gear, items, crafting, shops),
`quests.ts` (talking and quests), `bodies.ts` (loot) and `chat.ts`,
`region-views.ts` (what players see of each thing: the one shape both
snapshots and split-region borders send), `split-region.ts`, the
`region-*`/`remote-region.ts` files for region servers, `parties.ts`,
`trades.ts`, `character-ops.ts`. What lives in a region keeps its own module:
`creature-brain.ts` (each creature's behaviour: wander, guard, chase,
patrol, timid, pack; sleep out of its hours, fleeing), `townsfolk.ts`
(people keeping their day) and `walkers.ts` (moving and path finding both
use). The hour and weather come from shared `sky.ts`, worked out from the
clock and the region alone, so every server, cell and browser agrees
without being told; people's days are in shared `routines.ts`.

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
tab API), `building-painter.ts`, `walk-painter.ts`, `hand-finder.ts` +
`hand-sources.ts`, `sound-maker.ts`, `normal-painter.ts` (painted normal
maps), `paint-requests.ts` (resume after restart). `assets/style.ts` names the active profile's words for the
prompt builders; never write style sentences anywhere else.

**The lands.** Shared `world.ts` lays out each region from its definition
(256 tiles a side), `places.ts` adds the launch lands' great places (temple,
caves, castle, palaces, tomb and wonders, joined by roads and bridges) and
`lands.ts` their creatures, treasures, people and quests. Every picture
they need is a description: buildings in `land-buildings.ts`, the rest in
`server/src/assets/land-anchors.ts`.

**The world editor.** The Owner and Stewards change the lands in the game
(the "Edit world" button). An edit is data on its land's definition
(`RegionDef.edits`, shared `world-edits.ts`): paint ground, paths, water,
trees or rocks; move or take away a tree, rock, water or set piece; a road;
a house of any building style (kit-friendly floor sizes, so it stands as a
kit house in the isometric preview); a monster spawn; clearing monsters
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
windows per wall, stairs) into exact parts on one set of sizes, with each
storey's blocking lines and a cutaway per storey. `shapeChecks` measures
every recorded joint on the placed solids (rests on, set into, held by,
clear of, level with) and that walls are complete, nothing floats and the
stairs fit. On the server, `assets/building-kit/` draws every view (outside
and each storey's cutaway, on one frame) into unlit colour, normal and glow
maps (`buildingViews`) and checks the picture: hidden faces stay hidden, no
gaps, no stretched paint, no layout colour, no two surfaces in one place,
rooms take only inside light, the way down shows. Code makes the shapes; the
image model paints only their flat textures, all of a look at once on one
sheet: a magenta guide with a green shape per texture (`sheet.ts`), painted
through the Art tab's review, the budget and the paint queue
(`ArtStudio.paintSheet`, route `art/sheet`). `KitSheets` keeps each painting
with its layout and words (shipped ones in `assets/kit-sheets/`, later ones
in the art folder) and checks them in a worker thread (`sheet-checks.ts`,
`tiling.ts`): in place, filled, no spill, no baked light, even, no frame, and
a tile that repeats without slicing shapes. Each texture comes from the
newest painting where it passed. In play so far: a building style with a
`kit` look (`BUILDING_STYLES`) whose floor falls on whole bays, two tiles to
a bay, becomes a kit house on that floor (`kitHouse`); `KitHouses` draws it
in a worker the first time `GET /api/kit-houses` asks (the Owner only, for
the isometric preview), keeps it in the art folder and draws it again when
its look is painted again. The game's collision is still its wall tiles.
The plan for bringing the rest into play is
https://claude.ai/code/artifact/af5911b7-a8b9-4041-885f-06f237ad7d99.

## Client modules

`main.ts` (sign-in and boot), `net.ts` + `api.ts` (server talk),
`world-scene.ts` (the Phaser scene; positions go through `PROJECTION`, and
walkers face its `ways`: the four isometric ways show standing pictures
until walks are made for them; the
ground, trees and rocks are drawn in chunks near the player), `sky.ts` (the
light of the hour and the weather),
`textures.ts` (tilesets from painted art, and the same tiles turned into
diamonds for the isometric camera), `camera-preview.ts` (the Owner's switch
for the isometric preview, kept in the browser), `kit-house-view.ts` (kit
houses stood on their floors in upright strips, so walkers pass behind and in
front of them), `wished.ts` (wished content),
`lights.ts` + `lit-pipeline.ts` (pictures are lit by the sky's colour, the
sun or moon of the hour from shared `lighting.ts`, and lamps at fires,
lanterns, shrines and windows; characters get a rim light; `light-preview.ts`
shows the same light in the Art tab), `normal-maps.ts` + `relief.ts` + `relief-worker.ts` (a normal map
worked out for every picture in a worker; a painted `<key>-normal` wins),
`sound.ts`, `perf-overlay.ts` + `perf-stats.ts` (the performance overlay for
Stewards and the Owner, F3 or Account: frame rate and stutters, draw calls,
objects, lights, pictures held for the GPU, memory, ping and snapshots, what
is drawn near you, and the server running your part of the world from
`GET /api/admin/perf`; it measures nothing while hidden), and one `*-ui.ts`
per panel. God's View is
`gods-view.ts` (shell) plus `gods-view/*.ts`, `art-ui.ts`, `loot-tab.ts` and
`api-log-ui.ts`.

## Changing something big

| Change | What to write |
| --- | --- |
| New art style | A `StyleProfile` in `style-profile.ts`, `ART_STYLE=<id>` in `.env`, then repaint from the Art tab (old versions stay for rollback). |
| Isometric camera for everyone | `ISOMETRIC` exists as the Owner's preview (camera plan step 1, ground and scenery from step 2, kit houses). Still to come: lands repainted in its view words, the four facing ways painted for every walker (the Art tab's "Paint every walker's missing ways", then each way's walk clip), upright strips for big trees and set pieces, then `chooseCamera` picks it for players: https://claude.ai/code/artifact/3850d394-7032-47cb-bed1-a0a9fc135159 |
| New AI service | An adapter implementing the provider interface, and one branch in `ai/services.ts`. |
| New database | A `StoreBackend` class and its choice in `main.ts`. |
| New God's View tab | A file in `gods-view/` exporting a `Tab`, and one line in `TABS`. |

## The robot playtester

`packages/server/playtest/`: robot players (`bot.ts`) and a browser play the
real server with fake AI; `npm run playtest`. One `*.play.ts` per area of
play; a new feature adds one. See `playtest.md`.

## Rules every module keeps

- A short doc comment on each export; comments say why.
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
