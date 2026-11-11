---
description: Take co-MMO's fixed screenshots, compare them with main, and review them
argument-hint: "[shot names to include, comma-separated] [--base <ref> | --golden]"
---

Follow the `co-mmo-shots` skill (`.claude/skills/co-mmo-shots/SKILL.md`) to
take and review screenshots of this branch. Arguments: $ARGUMENTS

1. Pick the shots. Words in the arguments that aren't flags are names (or
   parts of names) from `packages/server/shots/list.ts`; pass them as
   `--only a,b`. With none, take every shot.
2. Pick what to compare with: `--base <ref>` means `--compare <ref>`;
   `--golden` means `--base-dir /mnt/project-files/shots/golden`; with
   neither, compare with `origin/main` (`--compare`). On `main` itself,
   take shots without comparing.
3. Run `npm run shots -- <options>`. Paid keys are stripped by the script;
   never add them.
4. Review as the skill's "How to look" says: machine findings first, then
   every changed shot's comparison picture, then the close-ups and each
   shot's must-see list. Measure where you can.
5. Report: for each changed shot, what changed and whether the branch's
   change explains it; list every machine finding; name anything you could
   not check. In a project thread, copy `shot-results/now/` and
   `shot-results/compare/` to `/mnt/project-files/shots/<branch>/` and
   attach the contact sheet and the changed shots' comparison pictures.
