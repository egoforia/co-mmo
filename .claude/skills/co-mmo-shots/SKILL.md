---
name: co-mmo-shots
description: Use for any co-MMO change that changes what a player, Steward or the Owner sees (art, camera, lighting, buildings, floors, HUD, God's View, Art Studio): take fixed screenshots, compare them with main, and look at them the right way before saying it works.
---

# Screenshots for co-MMO changes

A picture is how a visual change is checked. You see a screenshot differently
from a person, so the rules below cover the ways you tend to misread one. The
full process is in `docs/screenshots.md`.

## When

- **Always** for a change to what is drawn or shown: art, painting, the camera,
  light and sky, buildings and walls, floors and cutaways, creatures and
  walkers, the HUD, God's View and the Art Studio.
- Before every push of such a change (the steward skill asks for it), and once
  more on the final state before saying it is done.
- Not needed for a change only to server rules, tests or docs.

## How

```bash
npm run shots -- --compare               # this branch and origin/main, side by side
npm run shots -- --only arcanum,floor    # just the shots whose names contain these
npm run shots                            # this branch only (no comparison)
npm run shots -- --base-dir <dir>        # compare with a set taken earlier (the golden set)
```

It builds the client, starts a fresh test server for each shot with the
offline God and **no paid keys** (they are stripped from the environment), pins
the hour and weather, puts the player at a fixed spot, waits until the screen
holds still, and takes the picture. The commit compared with runs from a
checkout beside the repo; its shots are kept, so later comparisons are quick.
A full run takes about 7 minutes in the cloud; use `--only` while working.

What you get, in `shot-results/`:

- `now/<name>.png`, `now/<name>.close.png` (the middle of the screen at 2x),
  `now/contact-sheet.png`, `now/shots.json` (each shot's purpose, its
  must-see list, and what a machine found).
- `compare/<name>.png` (before | after | changed pixels in red) and
  `compare/report.md` (shots ranked by how much changed).

**Steady pictures.** The runner waits for the page to show the player at
the spot and floor (the HUD's place line), then for the screen to hold
still; it moves a spot that is inside a wall or furniture to the nearest
free tile middle, since the server would nudge the player out. Never replace
these waits with fixed sleeps. Shots of buildings and floors set `hideUi` so
the HUD doesn't cover them; the others keep it, because the HUD is part of
what players see. A place that is too dark to judge (an unlit cellar) is a
finding about the game's lights, not a reason to change the shot's hour.

**New feature, new shot.** When your change draws something no shot shows,
add one to `packages/server/shots/list.ts` with a `mustSee` list. Keep
existing names stable; comparisons pair shots by name.

## How to look

A run that exits 0 only means every picture was taken. It says nothing about
whether the pictures are right: dark voids, holes and clutter all pass. The
review below is the check.

1. **Read the machine findings first** (`shots.json` problems,
   `report.md` last column): page errors, failed requests, magenta left
   from a painting, see-through holes, a blank or almost black screen, a
   player the page never showed at the spot, a screen that never held still. Fix those
   before judging anything by eye.
2. **Compare, don't judge alone.** Open the `compare/` picture for every
   shot marked `changed`, `changed size` or `look`. Red that is only
   townsfolk and creatures in new places is movement, not a change. Say what
   changed and why your change explains it. A change you can't explain is a bug until shown
   otherwise. `same` shots need no look unless your change should have
   touched them; then "same" is the bug.
3. **Look at the close-up**, not only the whole screen. Small things (a seam,
   a floating tree, a hand in the wrong place, a cut wall) vanish when a
   1280x800 picture is shrunk for you to see. Crop further if you need to:
   `sharp(file).extract({...}).resize({ width: w * 3, kernel: 'nearest' })`.
4. **Describe, then decide.** Write down what is in the picture (where the
   player is, what is around them, what the light is like) before deciding
   whether it is right. Then go through the shot's `mustSee` list one item
   at a time and answer each yes or no.
5. **Measure what you can.** Sizes, positions and colours are better
   measured than eyeballed: count the pixels of a character's height and
   compare it with the same character before, or with things that should be
   the same size (the camera shows art smaller than its normalised
   `CHARACTER_HEIGHT`), check a colour with a pixel probe, compare a box's
   position between before and after. You misjudge size and straightness by
   eye.
6. **Know your blind spots.** You tend to: see what you expect (the thing
   you just built), miss what is missing (a wall, a shadow, a label), miss
   seams and one-pixel gaps, misread which way something faces in isometric
   view, and accept a picture that is still half drawn. Check each of these
   on purpose.
7. **Never write "looks good"** without naming the shots you looked at and
   what you checked in each.

## Where the pictures go

- Pictures are not committed (`shot-results/` is ignored).
- In a project thread, copy the run to the Library:
  `/mnt/project-files/shots/<branch>/` (the `now/` pictures and the
  `compare/` folder), and attach the compare pictures of every changed shot
  and the contact sheet to your reply. Say which shots changed and why.
- In the PR description, add a **Screenshots** section: the shots that
  changed, what changed in each and why, and anything you could not check.
- The Owner's approved look is the **golden set** in
  `/mnt/project-files/shots/golden/`. Compare with it
  (`--base-dir /mnt/project-files/shots/golden`) when main itself may be
  wrong. Only replace it when the Owner says so.

## Known limits

- Weather only grades the light today (no falling rain or snow).
- Creatures and townsfolk move, so busy shots change a little between runs;
  the report counts under 0.5% as the same and marks up to 4% "look".
- God's View and Art Studio pictures are full-page and change height with
  their content.
