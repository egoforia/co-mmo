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
2. Walk together: invites, login, one region, movement, chat, presence. **In progress (first version done).**
3. RPG core: stats, combat, creatures, items, quests, saving.
4. God v1: prayer panel, conversation, wish cards, Minor and Moderate wishes as content data, Tier 0 and Tier 1 assets, first God's View panels.
5. Stewards and scripts: sandboxed scripted rules, review queue, rollback tools, reports.
6. Scale and polish: multiple region servers, crowded-region splitting, asset tier upgrade tooling.
