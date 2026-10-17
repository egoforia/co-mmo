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
| Camera | `Projection` (`client/src/projection.ts`) | `TOP_DOWN` | `PROJECTION` |
| God's View tab | `Tab` (`client/src/gods-view/core.ts`) | one file per tab in `gods-view/` | `TABS` in `gods-view.ts` |

Every contract has a test a new implementation must pass:
`server/test/services.test.ts` (services swap one at a time),
`server/test/style-profile.test.ts`, `client/test/projection.test.ts`, and the
store, bus and paint-queue tests.

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

**HTTP and the socket.** `http.ts` (JSON, files, bearer tokens),
`account-routes.ts`, `auth.ts`, `admin.ts` (God's View API), `art-files.ts`
(table of painted-art URLs), `game-socket.ts` (the player WebSocket).

**The world.** `world.ts` (regions, travel, hosting), `region.ts` (one
region's tick: movement, snapshots, joining and leaving) with its systems in
`region/`: `state.ts` (who and what is here, shared by all), `combat.ts`,
`minds.ts` (creatures and NPCs), `kit.ts` (gear, items, crafting, shops),
`quests.ts` (talking and quests), `bodies.ts` (loot) and `chat.ts`,
`region-views.ts` (what players see of each thing: the one shape both
snapshots and split-region borders send), `split-region.ts`, the
`region-*`/`remote-region.ts` files for region servers, `parties.ts`,
`trades.ts`, `character-ops.ts`.

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
`hand-sources.ts`, `sound-maker.ts`, `paint-requests.ts` (resume after
restart). `assets/style.ts` names the active profile's words for the
prompt builders; never write style sentences anywhere else.

## Client modules

`main.ts` (sign-in and boot), `net.ts` + `api.ts` (server talk),
`world-scene.ts` (the Phaser scene; positions go through `PROJECTION`),
`textures.ts` (tilesets from painted art), `wished.ts` (wished content),
`lights.ts`, `sound.ts`, and one `*-ui.ts` per panel. God's View is
`gods-view.ts` (shell) plus `gods-view/*.ts`, `art-ui.ts`, `loot-tab.ts` and
`api-log-ui.ts`.

## Changing something big

| Change | What to write |
| --- | --- |
| New art style | A `StyleProfile` in `style-profile.ts`, `ART_STYLE=<id>` in `.env`, then repaint from the Art tab (old versions stay for rollback). |
| Isometric camera | A `Projection` passing the contract test, the view words in the style profile, diamond ground tiles drawn as isometric tilemaps in `WorldScene.drawRegion`, and diagonal walks. |
| New AI service | An adapter implementing the provider interface, and one branch in `ai/services.ts`. |
| New database | A `StoreBackend` class and its choice in `main.ts`. |
| New God's View tab | A file in `gods-view/` exporting a `Tab`, and one line in `TABS`. |

## Rules every module keeps

- A short doc comment on each export; comments say why.
- Paid calls go through the paint queue and the budget, and are reviewable
  before they are sent (the Art tab shows the exact prompt).
- No art drawn in code, and no left/right mirroring of painted art.
- Limits and settings come from `.env` or God's View, not constants in code.
- Words players read are plain and friendly, never error codes.
- The wish guard (`scripts/wish-guard.mjs`) protects core files by path:
  moving or adding a core file means adding it to `CORE` there.

## Next splits (not done yet)

A renderer interface around Phaser.
