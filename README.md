# co-MMO

A browser MMORPG built by its own players. Invited friends walk a shared
world and ask an in-world God, in plain language, for new places, creatures,
items and rules, and the God makes those wishes real.

The approved design lives in the project's design doc ("co-MMO: Initial
Design Document"); [docs/design.md](docs/design.md) summarises it and tracks
which milestone the code is at.

## Status: milestones 2 to 7 done (first versions)

- Invite-only accounts. The first run prints a one-time link that creates the
  Owner; any player can then make invite links. Players confirm they are 18+.
  Players sign back in with an email link or a linked Google or GitHub account
  (milestone 7, below).
- Four regions, each a procedurally generated 64×64 tile map: the Sanctum
  (the God's shrine, Sister Amala) in the middle, with Whispering Woods to the
  west, Sunlit Shore to the east and Mirage Desert to the south. Walk off the
  end of a road to travel; your region and position are saved.
- Each region has its landmark, an NPC and wandering creatures (walking
  mushrooms, crab knights, sun scarabs). Creatures only wander for now.
- Server-authoritative movement at 20 ticks per second, with client-side
  prediction for your own character and interpolation for everyone else.
- Area of interest: each player only receives others within 24 tiles.
- Chat: Say (nearby, 16 tiles), Region, Party, Whisper and World, with flood
  limits.
- Positions saved every 30 seconds and on disconnect.
- 128×128 tiles (Style Bible), using the approved reference art: ground
  tiles, characters, NPCs, creatures and landmarks, plus the biome kit
  (water, trees, palms, cacti, rocks and the Sanctum meadow). Code-painted
  versions stand in for any asset that is missing.
- Biome definitions for all ten Style Bible biomes; the Sanctum, Whispering
  Woods, Sunlit Shore and Mirage Desert are the launch set.

RPG core (milestone 3, first version):

- Characters with level, XP, health, gold and four stats (Might, Agility,
  Wit, Spirit). Each level raises every stat. Saved with the account.
- Real-time combat, server-authoritative: Space strikes the nearest creature.
  Walking Mushrooms fight back, Crab Knights guard their sand, Sun Scarabs
  chase. Creatures drop gold, Tonics and Goat Horns, and come back later.
- Falling in battle wakes you at the Sanctum shrine with nothing lost,
  Weakened (half damage) for 30 seconds.
- Items: everyone starts with the Bible (B), an in-game book with First
  Steps, the Style Bible, the Book of Making, the Chronicle and a Bestiary and
  Armoury that fills in as you play. Tonics heal (I opens your bag).
- Quests from the four NPCs (E to talk): Sister Amala sends you to Old
  Bramble, then each region's NPC asks you to deal with its creatures.

The God (milestone 4, first version):

- Press G anywhere to pray. The God chats, helps shape an idea, and offers a
  wish card: what will be made, where, and its Favor cost (2 for an item, 6
  for a creature or a person). Favor: 10 to start, 3 per quest, 2 per level,
  and 3 per Creator level (milestone 8).
- Granted wishes are content data checked against balance limits: items go
  into your bag, creatures appear around you, people stand beside you and
  talk. Everyone sees a line in chat, and the Bible's Chronicle lists them.
- Bigger wishes (new systems or places) are recorded for a Steward, or the
  Owner for engine changes, to approve or reject. The wisher is told.
- Wished things first wear a built-in sprite tinted with the wish's colour,
  then their own painted art once Gemini has made it (when a key is set).
- God's View (`/gods-view.html`, linked in the top bar for Stewards and the
  Owner): world map, review queue, content log with rollback and repaint,
  players (the Owner appoints Stewards), the God's model and fallback, the
  image model, and the monthly budget. Over the ceiling, the offline God
  answers and nothing is painted.

Stewards and scripted rules (milestone 5, first version):

- A Major wish ("let us go fishing") is drafted by the God into a scripted
  rule: a short JavaScript event script plus the items it needs. Scripts
  react to players joining, entering a region, using an item, pressing E on
  water, trees or rocks, and defeating creatures, and act only through a
  narrow `game` API (give and take items, heal, gold, XP, messages, timers,
  small saved state).
- Scripts run in a QuickJS sandbox (`packages/server/src/rules.ts`): no
  network, files or timers of their own, 4 MB of memory, 30 ms and 60 actions
  per event, and per-player hourly caps on gold, XP and items. A rule that
  keeps throwing errors or hitting its limits pauses itself and Stewards are
  told.
- Every draft is played through an automated test run in a fresh copy of the
  launch world (`rule-test.ts`). A failing draft is retried once with the
  problems; Stewards see the script, its items and the test report in God's
  View, can ask the God to revise it with a note, and approve it to go live
  at once for everyone.
- God's View also has Rules (pause, resume, roll back, errors and effects),
  Reports, and suspensions. Players report a creation from the Bible's
  Chronicle, or a player with `/report Name what happened` in chat.
- The Owner names Stewards by praying: "make Ilya a Steward".
- Without an AI key the offline God still drafts one rule: fishing (a rod
  for everyone, fish by biome, a rare Golden Carp).

Play together (milestone 7, first version):

- Signing in: invite links still create every account. A player can add an
  email (confirmed by a link) and link Google or GitHub from Account, then
  sign in on any device with a one-time email link (15 minutes) or the
  provider. Sign-in links and provider callbacks carry a one-time code, never
  the session token; each device gets its own session and can sign out alone.
  Setup: [docs/sign-in.md](docs/sign-in.md).
- Your look: the invite form asks how you look. That is your first wish, free
  and granted at once: a tinted placeholder until Gemini paints you, then
  everyone sees your own sprite. Players who joined earlier describe theirs
  from Account. A Steward can roll a look back, and then the player describes
  themself again.
- Chat channels: Say, Region (everyone in your region), Party, Whisper (one
  player, any region) and World. `/w Name`, `/r` to answer, `/p`, `/region`,
  `/world`, `/help`.
- Parties: `/invite Name` or the party box, `/accept`, `/leave`. Members
  close by (24 tiles) share each defeat's XP, a little more in total than
  alone, and their defeat-quest progress. Six is the tuning default, not a
  hard limit. Parties live in memory and break up on a restart.
- "While you were away": on joining, a short feed of what others wished and
  did (new players, level-ups) since you last played.

Adventurer's kit (milestone 8, first version):

- Equipment: weapon, head, body and charm slots, worn from the bag (I) and
  taken off with a click. Gear adds stats, weapon damage and armour, with
  rarity from Common to Legendary. Armour softens creature blows.
- Abilities on the 1 to 4 keys, paid for with Energy (a new bar; Wit raises
  it, Spirit refills it faster) and resting a few seconds after use: Power
  Strike from Old Bramble's quest, Mend from Sister Amala's lessons, Firebolt
  (hits a creature five steps away) from a scroll the Cactus Elder sells.
- Crafting (C): creatures now drop mushroom caps, crab shells and scarab wing
  cases; recipes turn them into Tonics, a Toadstool Hat, a Crab-Shell Lance,
  Shell Mail and a Scarab Charm. Finer recipes need more Wit.
- Shops: Marina and the Cactus Elder sell and buy (at half value); Sister
  Amala teaches. Shop rules live in `packages/shared/src/kit.ts`, so the
  windows show what the server charges.
- Trading: /trade Name with someone close by. Both put items and gold on the
  table; any change clears both agreements; the swap is all or nothing.
- Creator XP: when others fight, talk to, wear, use, craft with or learn from
  what you wished for, you earn Creator XP (once every ten minutes per player,
  thing and way, except fights). Each Creator level pays 3 Favor.
- New wishes: gear to wear (rarity up to Rare; the world sets its numbers),
  crafting recipes (only from things that exist, never making more than they
  use), and abilities that arrive as a scroll you can read, sell or trade.
- New item art (materials, gear, the scroll) was painted with the anchor
  pipeline (`npm run anchors -- --only item-...`, then `npm run game-art`).

Wishes that change the game (milestone 6, first version):

- When the Owner approves an Engine wish in God's View (with an optional note
  for the coding agent, and a box that allows changes to sign-in, roles, the
  budget, keys and the sandbox), the server opens a GitHub issue holding the
  wish card, the note and the conversation with the God. A Major wish the God
  could not script can be sent the same way ("Send to be built as code").
- The "Build a wish" workflow (`.github/workflows/build-wish.yml`) runs
  Claude Code in GitHub Actions on that issue: it writes the change with
  tests on the branch `wish/<issue>`, runs the checks (three rounds of fixes
  at most), and opens a pull request that says in plain words what players
  will see. A wish too big for one change comes back split into smaller
  Engine wishes. One wish builds at a time, with a daily cap, and each build
  counts against the monthly budget (an estimate set in God's View).
- Guardrails: the agent can only push its wish branch and open a pull
  request; it cannot merge or push to main, and `scripts/wish-guard.mjs`
  (run by the build and by CI) refuses changes over 25 files or 1,500 lines,
  changes to the workflows, and changes to core files unless the Owner
  allowed them.
- The workflows report back as hidden comments on the issue, and the server
  reads them with a token that can only use issues. Wish badges gain the new
  steps: Queued to be built, Being built, Waiting for the Owner's review,
  Updating, Live, or Build failed (with Try again). The Owner reviews and
  merges on GitHub (or asks for changes with `@claude` in a comment); a closed
  pull request sends the wish back to the Owner and tells the wisher.
- Updates lists the merged wishes it will release. After the pull and
  restart the wish turns Live, the world is told, and the wisher hears it the
  next time they are in the world. Code changes are undone by reverting the
  pull request, not with Roll back.
- Set up once: see [docs/building-wishes.md](docs/building-wishes.md).

Not yet: abilities, equipment, shops and crafting, parties, Postgres,
multiple region servers. See the milestone list in
[docs/design.md](docs/design.md).

## Run it

Requires Node 20 or newer.

```sh
npm install
npm run dev
```

This starts the game server on port 3001 and the client (Vite) on
http://localhost:5173. The server prints an Owner invite link the first
time; open it, pick a name, and you are in. Use "Invite a friend" in the
top bar to make more invite links. To try multiplayer alone, open an invite
link in a private window.

Updating from GitHub: God's View has an Updates tab (Owner only) that lists
commits on GitHub `main` that this machine doesn't have yet; the server checks
every ten minutes, and the World tab shows a card when something is new.
"Pull main and restart" fast-forwards the checkout, runs `npm install` if
`package.json` or `package-lock.json` changed, restarts the server and Vite,
and every open page reloads itself once the game is back. It refuses, with
the reason, when the machine has uncommitted changes, local commits, or is
on another branch. This needs `npm run dev`, which runs `scripts/dev.mjs` to
do the restart (`npm run dev:raw` runs the game without it).

Production-style, on one port:

```sh
npm run build
PUBLIC_URL=http://localhost:3001 npm start
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Server port |
| `PUBLIC_URL` | `http://localhost:5173` | Base URL used in invite links |
| `DATA_FILE` | `data/world.json` | Where accounts, invites and positions are stored |
| `CLIENT_DIR` | `packages/client/dist` if built | Built client to serve |
| `ART_DIR` | `art/` next to `DATA_FILE` | Where painted wish art is saved |
| `GEMINI_API_KEY` | none | Google AI Studio: the God's default model (`gemini-3.8-flash`), wish art, walks (Veo) and each land's music (Lyria) |
| `ELEVENLABS_API_KEY` | none | ElevenLabs: the game's sound effects; without it the game plays music only |
| `ANTHROPIC_API_KEY` | none | Optional: Claude models for the God |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | none | Optional: OpenAI or any OpenAI-compatible service |
| `GITHUB_ISSUES_TOKEN` | none | Fine-grained GitHub token with only Issues read and write on the game's repository; lets approved Engine wishes become issues for the coding agent |
| `GITHUB_REPO` | from `git remote origin` | The repository wishes are built in, as `owner/name` |
| `RESEND_API_KEY`, `MAIL_FROM` | none | Sends sign-in emails through Resend; without them the links are printed in the server console |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | none | Turns on "Sign in with Google" ([docs/sign-in.md](docs/sign-in.md)) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | none | Turns on "Sign in with GitHub" |

Without any key the offline God answers: it understands simple wishes ("I
wish for a red hat", "make a pink slime", "I want a fish trader") and can
draft the fishing rule, so the game works with no paid service. Which provider and model the God uses is chosen
in God's View, not in code.

## Host it

The `Dockerfile` builds one container that serves the game on port 8080.
Mount a persistent volume at `/data` (accounts, invites and positions are
stored there) and set `PUBLIC_URL` to the address players will use, so
invite links point to it. On first start the logs print the Owner invite.

```sh
docker build -t co-mmo .
docker run -p 8080:8080 -v co-mmo-data:/data -e PUBLIC_URL=http://localhost:8080 co-mmo
```

## Reference art (anchors)

The Style Bible's reference images are generated with Google AI Studio
(Gemini) through `packages/server/src/assets`, where the provider sits behind
an `ImageProvider` interface. With `GEMINI_API_KEY` set:

```sh
npm run anchors -- --dry-run   # show every prompt and the estimated cost
npm run anchors                # generate into assets/anchors/ (skips existing)
npm run anchors -- --process-only   # redo post-processing without new images
```

Each image is saved next to a JSON recipe (description, prompt, model, style
version), so the set can be regenerated later with a better model. The
provider's image is kept in `assets/anchors/raw/`; the game copy has its
magenta background removed (sprites) or is made seamless (ground tiles, with a
4×4 repeat preview in `assets/anchors/previews/`).

The same command makes the biome kit (`packages/server/src/assets/kit.ts`):
each launch biome's trees, palms or cacti, rocks and water, plus the Sanctum
meadow. Kit images are painted with their biome's approved anchors as style
references, and water tiles keep only the middle of the image, since the
model frames water as a pool with banks.

`npm run game-art` turns the anchors into game sizes (128 px tiles and
creatures, 128×192 characters, 192×256 trees, larger set pieces) in
`packages/client/public/art/`, with a `manifest.json` the client loads. It
needs no API key; run it after adding or changing anchors.

## Sound and music

Sounds are made by AI services from descriptions, like pictures: nothing is
synthesized in code. `packages/shared/src/sounds.ts` describes every sound
effect (`SOUND_EFFECTS`) and each land's music (`MUSIC`). When the server
starts it makes whatever is missing: effects with ElevenLabs (about $0.002 a
second of sound) and one 30-second track per land with Google's Lyria 3 on
the Gemini key ($0.04 a track). ffmpeg (already needed for walks) trims each
sound, evens out how loud it is, and blends each track's end over its start
so it loops without a seam. The services are chosen on God's View's AI models
tab, and the Art tab plays every sound and can make any of them again.
Players set effects and music volume with the Sound button.

## Develop

```sh
npm test           # unit and integration tests (Vitest)
npm run typecheck  # TypeScript across all packages
```

| Package | What it holds |
| --- | --- |
| `packages/shared` | Code both sides run: protocol types, world generation, movement, prediction, palette |
| `packages/server` | HTTP API (invites, sign-in), WebSocket game connection, authoritative region simulation, storage |
| `packages/client` | Phaser 3 browser client: rendering, input, chat, invite flow |

The server and the client generate the map from the same seed with the same
code, and run the same `step()` movement function, so prediction matches the
server exactly unless something else (another wish, lag) intervenes.

Storage is a JSON file for now behind the `Store` class, so local
development needs no database. It will move to Postgres before hosting.
