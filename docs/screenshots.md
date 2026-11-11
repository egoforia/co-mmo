# Screenshots

co-MMO is a visual game built mostly by AI agents, and an agent sees a
screenshot differently from a person: it misjudges sizes, misses seams and
missing things, and tends to see what it expects. So pictures are part of
making every visual change, with fixed shots, a comparison with main, and
rules for looking. Agents follow `.claude/skills/co-mmo-shots/SKILL.md`, or
run `/shots` in Claude Code.

## Commands

| Command | What it does |
| --- | --- |
| `npm run shots` | Takes every shot of the working tree into `shot-results/now/`. |
| `npm run shots -- --only sanctum,floor` | Only the shots whose names contain these words. |
| `npm run shots -- --compare [ref]` | Also takes them on `ref` (default `origin/main`) and compares. |
| `npm run shots -- --base-dir <dir>` | Compares with shots taken earlier, such as the golden set. |
| `npm run shots -- --no-build` | Uses the client already built in `packages/client/dist`. |

A full run is about 7 minutes in a cloud session (software drawing); each
shot takes 15 to 30 seconds.

## What a run does

1. Builds the client (`npm run build`), unless `--no-build`.
2. Starts one game server with the offline God and no painter, and draws every
   kit house the shots need, so no shot catches a house half drawn.
3. For each shot in `packages/server/shots/list.ts`: starts a fresh server
   whose sky shows the shot's hour and weather (`shots/sky.ts` picks a day
   and weather length that land the real clock on them, so the game's clock
   is untouched), signs in an Owner at the shot's spot and floor, opens the
   page, waits until a second passes with under 1% of the screen changing
   (at most 20 s), runs the shot's `open` step, and takes the picture.
4. Runs machine checks on each picture (`shots/pictures.ts`): errors the page
   threw or logged, requests that failed, magenta left from a painting's
   background, a screen that is one flat colour, and a screen that never held
   still.
5. Writes the close-up (middle of the screen, 2x, no smoothing), the contact
   sheet and `shots.json`.
6. With `--compare`: checks the other commit out beside the repo
   (`$TMPDIR/co-mmo-shots-<commit>`), borrows this checkout's packages when the
   lock files match, copies this branch's shot runner in, and takes the same
   shots there into `shot-results/base-<commit>/` (kept for next time). Then
   `shots/compare.ts` writes `shot-results/compare/`: before | after |
   changed-pixels pictures and `report.md`, shots ranked by how much changed.

Paid AI keys, database and Redis settings are removed from the environment
before anything starts, so a shot run never pays for anything and never
touches a real world.

## Reading the report

| Verdict | Meaning |
| --- | --- |
| same | Under 0.3% of pixels changed: moving creatures and townsfolk make some. |
| small change | 0.3% to 2%: look, it may be movement or a real small change. |
| changed | 2% or more: must be explained in the PR. |
| changed size | The page's size changed (full-page God's View pictures). |

## Adding a shot

Add an entry to `SHOTS` in `packages/server/shots/list.ts`: a stable `name`,
`about`, the `region` and spot (`at`, with helpers for inside a building or
upstairs), `hour` and `weather`, `screen`, an `open` step for a window or tab,
and a `mustSee` list a reviewer answers yes or no. Use `page` for another page
than the game (`/gods-view.html`, `/art-studio.html`).

## Where the pictures live

`shot-results/` is not committed. In project threads the run is copied to
the Library at `/mnt/project-files/shots/<branch>/`, and changed shots are
attached to the thread reply and described in the PR's Screenshots section.
The Owner's approved look is kept as the golden set in
`/mnt/project-files/shots/golden/` and is replaced only on the Owner's word.
