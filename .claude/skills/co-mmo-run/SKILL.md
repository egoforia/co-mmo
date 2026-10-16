---
name: co-mmo-run
description: Use to start co-MMO, test a change in the browser, or check it in file mode and Scale mode (Postgres, Redis, region servers).
---

# Running co-MMO

Never read or print `.env` or API keys. In cloud sessions keep keys unset so
nothing is paid for; the offline God answers instead.

**Checks first:** `npm run typecheck` and `npm test`. A wish branch also runs
`node scripts/wish-guard.mjs --base origin/main`.

**File mode** (nothing installed): `npm run dev`. The game is at
http://localhost:5173 and God's View at http://localhost:5173/gods-view.html.
The world is kept in `data/world.json`. On first start the server prints an
invite link that makes its user the Owner; open it to sign in.

**Scale mode:** `docker compose up -d`, then set in `.env` (or the shell):
`DATABASE_URL=postgres://co_mmo:co_mmo@localhost:5432/co_mmo`,
`REDIS_URL=redis://localhost:6379`, `REGION_SERVERS=2`, and `npm run dev`.
Check the Server health tab shows the region servers. Details in
`docs/scale.md`.

**In a browser:** Chromium and Playwright are installed in cloud sessions
(do not run `playwright install`). Open the invite link, take a screenshot of
the game and of God's View, and look at them before saying a change works.

The server needs ffmpeg for walks and sounds. Use a scratch `DATA_FILE` and
`ART_DIR` so a test run does not touch the real world.
