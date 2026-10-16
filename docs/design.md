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

## Wish Workshop

Approved on 2026-10-15: a "Shape a wish" tab in the Prayer window where
players pick a category, talk the details through with the God and preview
the card, the numbers and the exact image prompt before sending. Design:
https://claude.ai/code/artifact/ac5a156b-c297-464b-ac19-006f41e3d310. Done so
far: prompts in the open (painting goes through `artRequest` in
`packages/server/src/assets/wish-art.ts`, and God's View shows each
picture's prompt) and the Workshop itself without the God's help: the
category tree (`packages/shared/src/workshop.ts`), drafts kept on the server
(`packages/server/src/workshop.ts`), the form and the free preview in the
Prayer window (`packages/client/src/workshop-ui.ts`), and talking to the God
inside the Workshop: a draft-aware God turn (`workshopPrompt` in
`packages/server/src/god.ts`) that changes fields and offers quick answers,
locks on every field the player wrote, "Ask the God to fill the rest", and
"Shape this wish" under the God's latest reply in Talk. Workshop turns share
the prayer limits and budget; the offline God fills drafts from its word
rules. Step 4 adds "Your look" under Living things (Minor, 2 Favor; the newest
look wins, and rolling it back restores the one before), structured briefs
that Stewards, the rule drafter and the coding agent's issue read before the
conversation, an optional paid sample (off by default; switched on in God's
View Budget, one per draft, paid in Favor, paused past the warning line, and
used as the final art when the wish is sent unchanged), and rewording a
picture's prompt before repainting, for Stewards and the Owner.

## Milestones

1. Design approved. Done.
2. Walk together: invites, login, regions, movement, chat, presence. **Done:** four launch regions linked by roads, with the approved art.
3. RPG core: stats, combat, creatures, items, quests, saving. **Done (first version):** stats and levels, combat with three creature behaviours, death and respawn, the Bible, Tonics and drops, talk and defeat quests, saved characters.
4. God v1: prayer panel, conversation, wish cards, Minor and Moderate wishes as content data, Tier 0 and Tier 1 assets, first God's View panels. **Done (first version):** prayers from anywhere (G) with a God on Gemini, Claude, any OpenAI-compatible model or an offline scripted God; wish cards with Favor costs; items, creatures and people granted as validated content data; tinted placeholder art (Tier 0) swapped for painted art (Tier 1, Gemini image, anchors as style references); major and engine wishes queued for review; the Chronicle; God's View with the world map, review queue, content log with rollback, players and Steward appointment, AI model switching and the monthly budget (offline God and no painting once over the ceiling).
5. Stewards and scripts: sandboxed scripted rules, review queue, rollback tools, reports. **Done (first version):** Major wishes are drafted by the God's rule compiler into an event script plus its items, run in a QuickJS sandbox (no network, files or timers of its own; memory, time and effects-per-event caps; per-player hourly caps on gold, XP and items; a rule that keeps failing pauses itself), tested automatically in a fresh copy of the launch world, and go live when a Steward approves them in God's View. Stewards can ask the God to revise a draft, pause, resume or roll back live rules, read and close player reports (Report in the Chronicle, /report in chat), and suspend players. The Owner names Stewards by praying ("make Ilya a Steward"). The offline God knows fishing by heart.
6. Wishes that change the game: approved Engine wishes become pull requests written by a coding agent, checked by tests, merged by the Owner and released through the Updates tab, with build status on every wish. **Done (first version):** approval opens a GitHub issue (server token limited to issues); the "Build a wish" workflow runs Claude Code in GitHub Actions, which writes the change with tests on `wish/<issue>` and opens a pull request; the wish guard enforces a size limit and keeps core files and the workflows off limits unless the Owner allows core changes; workflows report each step to the issue as hidden comments; badges show Queued to be built, Being built, Waiting for the Owner's review, Updating, Live and Build failed; one build at a time with a daily cap and a per-build estimate in the budget; too-big wishes come back split into steps; a closed pull request returns the wish to the Owner; merged wishes go live after the Updates tab pulls them, and the wisher is told. Setup: [building-wishes.md](building-wishes.md).
7. Play together: sign-in by magic link or Google/GitHub, describing your look at character creation, Region, Party and Whisper chat, parties, the "While you were away" feed. **Done (first version):** email sign-in links (Resend, or printed in the console until it is set up) and linked Google/GitHub accounts, each device with its own session; invite links still create accounts; your look described at joining (or later from Account) is a free, instantly granted wish painted like any other; Say, Region, Party, Whisper and World chat with slash commands; parties that share XP and defeat-quest progress with members nearby; a "While you were away" feed of others' wishes, new players and level-ups. Setup: [sign-in.md](sign-in.md).
8. Adventurer's kit: equipment, abilities, crafting, shops and trading, Creator XP. **Done (first version):** weapon, head, body and charm slots with rarity, stat, damage and armour bonuses; Energy and abilities on keys 1 to 4 (Power Strike from a quest, Mend from a trainer, Firebolt from a scroll); creature materials and five recipes in a crafting book (C); Marina and the Cactus Elder sell and buy, Sister Amala teaches; player trading where both sides must agree; Creator XP when others enjoy your wishes, with Favor at each Creator level; wishes for gear (up to Rare), recipes and abilities (as scrolls).
9. A growing world: new regions wished into being at the world's edge. **Done (first version):** the world is a grid of regions with the Sanctum at its centre; standing in a region with an open edge, a player can wish for a whole new region (12 Favor) beyond the edge nearest them; the God shapes it as data (biome, danger 1 to 6, how thick its trees, rocks and water are, one or two kinds of creature, existing or new and as strong as its danger, and an optional person); it is laid out from that data the same on server and client and joined by roads to every region beside it, and players already nearby see the new road appear; everyone who enters hears who wished it, and the wisher earns Creator XP for each visit; the first region of a biome no launch region uses gets that biome's kit painted once (seamless ground and water tiles, two trees and a rock, about five pictures) by the image model chosen in God's View, reused by every later region of that biome; God's View draws the world map from the grid with each wished region's wisher and danger; a Steward rolling the wish back removes the region and carries anyone inside back to the shrine.
10. Art and sound: art reuse, the style check, paper-doll sprites, sound and music, Tier 2 assets, a daily spending cap.
11. Scale: Postgres and Redis, multiple region servers, crowded-region splitting, the Server health panel. **In progress:** the saved world is kept in Postgres when `DATABASE_URL` is set, brought in from the old JSON file on the first run ([scale.md](scale.md)).
