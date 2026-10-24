# co-MMO for coding agents

A browser MMORPG whose players change the game by making wishes to an
in-game God. TypeScript end to end: `packages/shared` (code both sides run),
`packages/server` (Node HTTP + WebSocket, authoritative simulation),
`packages/client` (Phaser 3).

## Skills & Reference Guides

Read the matching skill or guide before making changes:

| Topic | File |
| --- | --- |
| Adding/splitting modules & swappable contracts | `.claude/skills/co-mmo-module/SKILL.md`, `docs/architecture.md` |
| Art, sound, isometric camera, building kit & walks | `.claude/skills/co-mmo-art/SKILL.md`, `docs/art-pipeline.md`, `docs/buildings-and-walls.md` |
| Player-, Steward- & Owner-facing text and God dialogue | `.claude/skills/co-mmo-player-words/SKILL.md` |
| Running the game, Scale mode & robot playtests | `.claude/skills/co-mmo-run/SKILL.md`, `docs/playtest.md`, `docs/scale.md` |
| Pull requests, conflicts & merge rules | `.claude/skills/steward/SKILL.md` |
| Product decisions, Wish Workshop, mods & milestones | `docs/design.md`, `docs/building-wishes.md`, `docs/sign-in.md` |

## Checks

- `npm run typecheck` and `npm test` (Vitest) must pass. Tests live in
  `packages/*/test/*.test.ts`; server tests start a real app on a random
  port with `test/helpers.ts`.
- A wish branch (`wish/<issue>`) must also pass
  `node scripts/wish-guard.mjs --base origin/main`: a size limit, and files a
  wish may not change unless the Owner's approval allows core changes.

## Conventions

- Match the code around you: small modules, plain functions, a short doc
  comment on each export, comments that say why. Keep new or split files under
  ~400 lines; when a module grows past ~500 lines or mixes domains, split it
  into a thin facade (`<module>.ts`) and focused submodules (`<module>/*.ts`),
  and add new logic to the submodule rather than the facade.
- Players read what the game says. Write messages in plain, friendly words,
  never jargon or error codes.
- The server is authoritative: never trust the client for positions, damage,
  items or Favor. Shared rules go in `packages/shared` so both sides agree.
- Wished content is data checked by `validateDefinition`; scripted rules run
  in the QuickJS sandbox (`packages/server/src/rules.ts`). Prefer extending
  those over new special cases.
- No art is drawn in code (canvas shapes, Phaser graphics, tinted stand-ins).
  Every picture is painted in the `FLAT_ISOMETRIC` style (`packages/server/src/assets/style-profile.ts`)
  by the image model chosen in God's View from a description: building interior
  surfaces and furniture in `BUILDING_STYLES` (`packages/shared/src/buildings.ts`),
  scenery in the biome kit (`packages/server/src/assets/kit.ts`). Everyone plays
  in diamond isometric projection (`ISOMETRIC` in `packages/client/src/projection.ts`),
  where buildings never use flat 2D exterior pictures; they stand as 3D kit houses or
  open cutaways with tall vertical walls (`docs/buildings-and-walls.md`). The wish guard refuses drawing code.
- One exception, the building kit (`packages/shared/src/building-kit/`, the
  Owner's choice on 2026-10-18): code builds house shapes from plain data,
  the image model paints every surface they show as flat textures, and a
  building is shown only when its shape and picture checks pass. Buildings may be
  mirrored; characters and anything that walks never are. Wall and floor textures
  are 100% full-bleed and seamless (never on magenta/transparent backgrounds).
  Building and wall guidelines are in `docs/buildings-and-walls.md`.
- Character and creature art pipeline (`docs/art-pipeline.md`): the pipeline is
  AI model and API agnostic, enforcing coherent visual, geometric, and anatomical
  results regardless of which model generated the image or video. Players always
  normalize to `CHARACTER_HEIGHT = 168px`; creatures normalize to canonical height
  tiers (`tiny` = 64px, `small` = 112px, `medium` = 168px, `high` = 224px, `colossal` = 320px).
- Every wish is a mod a Steward can switch off (`docs/design.md`, Wishes as
  mods). A wish branch `wish/<issue>` puts what it adds behind
  `modOn(engineModId(<issue>))` from `@co-mmo/shared`; with it off, the game
  works exactly as before the wish, and the wish guard checks this. A wish
  that undoes another takes that wish's code out, its `modOn` checks too.
- No new dependencies unless the Owner's approval allows core changes.
- Never read or print secrets (`.env`, API keys), never change
  `.github/`, never push to main or merge.
