---
name: co-mmo-module
description: Use when adding a feature to co-MMO, splitting a file, or replacing a module (a provider, the store, the camera, a God's View tab) with a new version or a third-party tool.
---

# Adding or replacing a co-MMO module

1. Read `docs/architecture.md`. Find the part your change belongs to and its
   contract (the interface named there). If the change fits an existing
   contract, implement it; do not add a special case beside it.
2. Put the code where the map says:
   - rules both sides need: `packages/shared/src`
   - anything that pays an outside service: an adapter in
     `packages/server/src/assets/` or `ai/`, chosen in `ai/services.ts`,
     spending through `budget.ts`, queued through the paint queue
   - settings and limits: `settings.ts` (saved) or `.env` (read in `main.ts`),
     never a constant in code
   - wished content: data checked by `validateDefinition`, or a scripted rule
     in the sandbox (`rules.ts`), before any engine code
   - a God's View tab: one file in `packages/client/src/gods-view/` exporting
     a `Tab`, plus one line in `TABS`
3. Pass dependencies in through the constructor or options; never set a
   field on another service after it is built. `app.ts` is the one place
   that wires services together.
4. Each export gets a short doc comment; comments say why. Keep files small
   (~400 lines target ceiling for new or split modules): when a module grows
   past ~500 lines or mixes distinct domains, split it into a thin facade
   (`<module>.ts`) and focused submodules (`<module>/*.ts`, like `wishes/`,
   `region/`, `art-studio/`, `world-scene/`, `art-ui/`, `gods-view/`). Add new
   domain logic to the matching submodule, never by growing the facade.
5. Add or extend a test in `packages/<pkg>/test/`. A new implementation of a
   contract must pass that contract's test (see the map).
6. If you moved or added a core file (sign-in, roles, settings, budget, keys,
   the sandbox, AI providers), add its path to `CORE` in
   `scripts/wish-guard.mjs`, since the guard protects files by path.
7. Update `docs/architecture.md` when a module, contract or choice point
   changes. Keep it short.
8. Run `npm run typecheck` and `npm test`.
