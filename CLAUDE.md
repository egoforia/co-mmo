# co-MMO for coding agents

A browser MMORPG whose players change the game by making wishes to an
in-game God. TypeScript end to end: `packages/shared` (code both sides run),
`packages/server` (Node HTTP + WebSocket, authoritative simulation),
`packages/client` (Phaser 3). The design is summarised in `docs/design.md`.

## Checks

- `npm run typecheck` and `npm test` (Vitest) must pass. Tests live in
  `packages/*/test/*.test.ts`; server tests start a real app on a random
  port with `test/helpers.ts`.
- A wish branch (`wish/<issue>`) must also pass
  `node scripts/wish-guard.mjs --base origin/main`: a size limit, and files a
  wish may not change unless the Owner's approval allows core changes.

## Conventions

- Match the code around you: small modules, plain functions, a short doc
  comment on each export, comments that say why.
- Players read what the game says. Write messages in plain, friendly words,
  never jargon or error codes.
- The server is authoritative: never trust the client for positions, damage,
  items or Favor. Shared rules go in `packages/shared` so both sides agree.
- Wished content is data checked by `validateDefinition`; scripted rules run
  in the QuickJS sandbox (`packages/server/src/rules.ts`). Prefer extending
  those over new special cases.
- No art is drawn in code (canvas shapes, Phaser graphics, tinted stand-ins).
  Every picture is painted by the image model chosen in God's View from a
  description: buildings and their furniture in `BUILDING_STYLES`
  (`packages/shared/src/buildings.ts`), which the server paints at start-up
  when the art is missing; scenery in the biome kit
  (`packages/server/src/assets/kit.ts`). A building's outside art is centred
  on its doorway in the south wall and covers its walls; its inside matches
  the outside. The wish guard refuses drawing code.
- One exception, the building kit (`packages/shared/src/building-kit/`, the
  Owner's choice on 2026-10-18): code builds house shapes from plain data,
  the image model paints every surface they show as flat textures, and a
  building is shown only when its shape and picture checks pass. Buildings may be
  mirrored; characters and anything that walks never are. The character and beastfolk
  art pipeline (turnarounds, walk/run/attack cycles, Wan 3.0 generation) is in `docs/art-pipeline.md`.
- Every wish is a mod a Steward can switch off (`docs/design.md`, Wishes as
  mods). A wish branch `wish/<issue>` puts what it adds behind
  `modOn(engineModId(<issue>))` from `@co-mmo/shared`; with it off, the game
  works exactly as before the wish, and the wish guard checks this. A wish
  that undoes another takes that wish's code out, its `modOn` checks too.
- No new dependencies unless the Owner's approval allows core changes.
- Never read or print secrets (`.env`, API keys), never change
  `.github/`, never push to main or merge.
