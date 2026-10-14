# Design summary

The full, approved design is the Claude Doc "co-MMO: Initial Design
Document" (approved by egoforia on 2026-10-14):
https://claude.ai/code/artifact/65b5a6f3-1463-4a85-b0ac-d0d25cda8224

## Decisions that shape the code

- Browser MMORPG, invite-only, no player cap. Scale by splitting the world
  into regions on separate processes, never by refusing players.
- Players make wishes to an AI God from anywhere. Wishes become content data
  (most), sandboxed scripts (some), or reviewed engine changes (rare). Every
  wish is versioned and can be rolled back.
- Mature content rating with no content-rating limits; players must be 18+.
- AI and asset providers sit behind adapters and are chosen in settings
  (God's View), never hard-coded.
- Art: Legend of Mana-inspired hand-painted 2D on 128×128 tiles, defined by
  the Style Bible (https://claude.ai/code/artifact/e9e5a8ec-ef6a-4d0b-85fa-c421147ed2d8).
  Assets are colour-graded toward each biome's key palette
  (`packages/shared/src/biomes.ts`). Launch biomes: the Sanctum, Whispering
  Woods, Sunlit Shore, Mirage Desert.
- The first item is the Bible: every player has it, and it shows the game's
  documents in-game.
- Budget ceiling: $50 to $70 a month for AI and assets.
- Roles: Player, Steward, Owner. egoforia is Owner and first Steward; the
  Owner appoints more Stewards by asking the God.

## Milestones

1. Design approved. Done.
2. Walk together: invites, login, regions, movement, chat, presence. **Done:** four launch regions linked by roads, with the approved art.
3. RPG core: stats, combat, creatures, items, quests, saving. **Done (first version):** stats and levels, combat with three creature behaviours, death and respawn, the Bible, Tonics and drops, talk and defeat quests, saved characters.
4. God v1: prayer panel, conversation, wish cards, Minor and Moderate wishes as content data, Tier 0 and Tier 1 assets, first God's View panels. **Done (first version):** prayers from anywhere (G) with a God on Gemini, Claude, any OpenAI-compatible model or an offline scripted God; wish cards with Favor costs; items, creatures and people granted as validated content data; tinted placeholder art (Tier 0) swapped for painted art (Tier 1, Gemini image, anchors as style references); major and engine wishes queued for review; the Chronicle; God's View with the world map, review queue, content log with rollback, players and Steward appointment, AI model switching and the monthly budget (offline God and no painting once over the ceiling).
5. Stewards and scripts: sandboxed scripted rules, review queue, rollback tools, reports. **Done (first version):** Major wishes are drafted by the God's rule compiler into an event script plus its items, run in a QuickJS sandbox (no network, files or timers of its own; memory, time and effects-per-event caps; per-player hourly caps on gold, XP and items; a rule that keeps failing pauses itself), tested automatically in a fresh copy of the launch world, and go live when a Steward approves them in God's View. Stewards can ask the God to revise a draft, pause, resume or roll back live rules, read and close player reports (Report in the Chronicle, /report in chat), and suspend players. The Owner names Stewards by praying ("make Ilya a Steward"). The offline God knows fishing by heart.
6. Scale and polish: multiple region servers, crowded-region splitting, asset tier upgrade tooling.
