# co-MMO

A browser MMORPG built by its own players. Invited friends walk a shared
world and ask an in-world God, in plain language, for new places, creatures,
items and rules, and the God makes those wishes real.

The approved design lives in the project's design doc ("co-MMO: Initial
Design Document"); [docs/design.md](docs/design.md) summarises it and tracks
which milestone the code is at.

## Status: milestone 2, "Walk together"

- Invite-only accounts. The first run prints a one-time link that creates the
  Owner; any player can then make invite links. Players confirm they are 18+.
- One region, the Sanctum: a procedurally generated 64×64 tile map with the
  God's shrine in a central plaza.
- Server-authoritative movement at 20 ticks per second, with client-side
  prediction for your own character and interpolation for everyone else.
- Area of interest: each player only receives others within 24 tiles.
- Chat: Say (nearby, 16 tiles) and World, with flood limits.
- Positions saved every 30 seconds and on disconnect.
- 128×128 tiles (Style Bible). Tier 0 placeholder art is drawn in code and
  scaled up; generated hand-painted art replaces it later.
- Biome definitions for all ten Style Bible biomes; the Sanctum, Whispering
  Woods, Sunlit Shore and Mirage Desert are the launch set.

Not yet: the God and wishes, RPG systems (stats, combat, items, quests),
God's View, Postgres, multiple region servers. See the milestone list in
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
```

Each image is saved next to a JSON recipe (description, prompt, model, style
version), so the set can be regenerated later with a better model.

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
