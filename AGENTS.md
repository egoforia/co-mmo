# Agent Guidelines & Rules for co-MMO

## 1. Asset Generation & API Cost Safety

- **Free-First Art Workflow**:
  - Never make external billable API calls using API keys in `.env` (such as `GEMINI_API_KEY`) without explicit confirmation from the user.
  - When asked to generate visual assets (building art, tiles, walls, furniture, landmarks):
    1. **Extract Prompts**: Inspect prompts or run dry-run without invoking providers:
       ```bash
       npm run building-art -- --dry-run
       ```
    2. **Generate with Free IDE Subagents**: Use the IDE's built-in `image-generator` subagent to generate the raw images, saving them into `assets/buildings/raw/<job-id>.png`.
    3. **Process Locally**: Run the post-processing pipeline locally with zero external API calls:
       ```bash
       npm run building-art -- --process-only
       ```
       This executes chroma-key extraction, isometric diamond transformation, WebP/PNG optimization, and updates `packages/client/public/art/manifest.json` completely locally.

## 2. Git Worktree & Pull Request Workflow

- **Never Work Directly on `main`**: All edits, typechecks, test runs, and commits must take place inside an isolated git worktree (e.g., `.claude/worktrees/<name>`). The main checkout on `main` must remain 100% clean (`git status --porcelain` empty) at all times.
- **Finish with a PR**: Conclude every task by pushing the worktree branch to `origin` and creating or updating an open Pull Request.

## 3. Architecture & Code Integrity

- Maintain documentation integrity and preserve existing docstrings/comments.
- Always verify changes with `npm run typecheck` and relevant Vitest test suites (`npm test`) before committing.
- Adhere to the Style Bible and building kit specifications (`docs/art-pipeline.md`, `docs/buildings-and-walls.md`).
- **Multi-Storey Terraces, Cliff Skirts & Cutaway Visibility**:
  - Open outdoor terraces (`storey.open === true`) use low `WALL_RISE` (`~20px`) stone parapets on exposed rims (`!hasUpperTile`) and downward vertical cliff skirts (`skirt`), never full-height `closedWalls` in `world-scene/below.ts`.
  - Standalone ground-floor buildings not overlapped by the player's current upper storey must remain closed (`v.outside`) when `mine > 0`, cutaway interiors (`v.inside`) only display when the player is on Floor 0 (`mine === 0`), and elevated southern/eastern cliff faces must leave at least a 2-tile ground buffer north/west of ground-floor buildings.
  - Keep above-ground wall and cliff textures (`frostpeak-eyrie-wall`, `frostpeak-whiteledge-house-wall`) distinct from subterranean cavern textures (`frostpeak-sunken-drafts-wall`).
