# co-MMO

A browser MMORPG built by its own players. Invited friends walk a shared
world and ask an in-world God, in plain language, for new places, creatures,
items and rules, and the God makes those wishes real.

The approved design lives in the project's design doc ("co-MMO: Initial
Design Document"); [docs/design.md](docs/design.md) summarises it and tracks
which milestone the code is at.

## Status: milestone 2 done, milestone 3 "RPG core" under way

- Invite-only accounts. The first run prints a one-time link that creates the
  Owner; any player can then make invite links. Players confirm they are 18+.
- Four regions, each a procedurally generated 64×64 tile map: the Sanctum
  (the God's shrine, Sister Amala) in the middle, with Whispering Woods to the
  west, Sunlit Shore to the east and Mirage Desert to the south. Walk off the
  end of a road to travel; your region and position are saved.
- Each region has its landmark, an NPC and wandering creatures (walking
  mushrooms, crab knights, sun scarabs). Creatures only wander for now.
- Server-authoritative movement at 20 ticks per second, with client-side
  prediction for your own character and interpolation for everyone else.
- Area of interest: each player only receives others within 24 tiles.
- Chat: Say (nearby, 16 tiles) and World, with flood limits.
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

Not yet: the God and wishes, abilities, equipment, shops and crafting,
parties, God's View, Postgres, multiple region servers. See the milestone list in
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
