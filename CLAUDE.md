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
- No new dependencies unless the Owner's approval allows core changes.
- Never read or print secrets (`.env`, API keys), never change
  `.github/`, never push to main or merge.
