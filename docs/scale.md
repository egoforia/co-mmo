# Running at scale: Postgres and Redis

The saved world is always kept in Postgres, and the paint queue can be
kept in Redis (which also passes messages between servers). Neither needs
installing for local development: without `DATABASE_URL` the game uses the
Postgres built into it (PGlite), kept in `data/db/`, and without
`REDIS_URL` the paint queue lives in memory.

## Postgres

The server keeps the whole world in memory and writes what changed behind
it, so play never waits on the database. Each kind of thing has its own
table (`accounts`, `invites`, `content` for wishes, `reports`, `drafts`,
`rule_data`, `world_edits`, `settings`), each row a key and the thing as
JSON, so any Postgres tool can read them.

Spending (`spend_log`) and the journal (`journal_log`) only grow, so they
are append-only: each line is written once, with its time (and, for
spending, its dollars and reference) in columns of their own. Memory keeps
only this month's and last month's spending, which is all the budget needs,
and the latest 500 journal lines; older lines stay in the database
(`Store.spendBetween` reads any span). An older database's `spend` and
`journal` tables are moved into the logs on the first start.

Small things kept beside the world go in one `kept` table (`kept.ts`): a
JSON document under a kind and a key, written straight through so every
game server sees the same one, with an expiry for things that run out.
Sign-in uses it for email links waiting to be opened (`sign-in-link`, by
the hash of the code), Google and GitHub sign-ins in progress
(`sign-in-state`) and recent emails for the send limits (`sign-in-sent`),
so a restart no longer breaks a link that was just sent.

The Art tab's bookkeeping is kept there too (`kept-doc.ts`): paint requests
waiting on a limit (`paint-request`, one per request), the Up Next queue
(`art-up-next`), the Art Director's notes (`art-director`), the hands and
grips found and the Owner's hand questions (`art-hands`), and the recipe of
every picture's current and earlier versions (`art-recipe`,
`art-recipe-version`), and the painting log's finished jobs (`art-job`, the
latest 200), so God's View still shows what was painted before a restart. On first use each is brought in from its old JSON
file under `data/art/`, which is renamed `<name>.in-db` as a backup. The
pictures, clips and sounds themselves stay files, and so do the manifests
that list them, since they describe those files and the art tools read them.

God's View's API Log keeps one row per call in `api_log` (`api-log-db.ts`):
its id, time, day and size in columns, its summary and the whole call as
JSON. The summaries are also in memory, so the list and filters never wait
on the database; a whole call is read when it is opened. Old days go with
one `DELETE` (`API_LOG_DAYS`, `API_LOG_MAX_MB`). An older game's
`data/api-log/<day>.jsonl` files are brought in on the first start and
renamed `<name>.in-db`.

Characters have tables of their own (`store-characters.ts`), apart from
their accounts: `characters` holds one row per character with its level,
XP, gold, Favor, people, Calling and Path in columns and the whole character
as JSON, and `holdings` holds one row per bag stack and per worn item, with
an index on the item. Only a character that changed since its last save is
written again. God's View can ask who holds an item
(`GET /api/admin/holders?item=<id>`, Stewards and the Owner), and any
Postgres tool can ask things like `SELECT account_id, gold FROM characters
ORDER BY gold DESC`. An older database's characters, kept inside the
account rows, move out on the first save.

**Where the database is.** With `DATABASE_URL` set, the server uses that
Postgres server; region servers and several machines can share it. Without
it, the server opens the Postgres built into the game in `DB_DIR`
(`data/db/` by default, next to `DATA_FILE`), made on first start. Only one
game server may have that folder open at a time; a second one stops with a
message saying so. Back it up by copying the folder while the game is
stopped.

On its first start with an empty database, the server copies everything
from an older game's world file (`DATA_FILE`, `data/world.json` by
default), if there is one, and says so in the console. The file is left as
it was, as a backup; later starts ignore it. The game no longer writes it.

If a save fails (the database restarted, say) the game keeps running and the
next change saves everything that was missed.

### Set it up on your machine

Either way takes a few minutes, once.

**With Docker** (Docker Desktop, or `sudo apt install docker.io docker-compose-v2`):

```sh
docker compose up -d
```

**Without Docker** (Ubuntu or Debian):

```sh
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER co_mmo WITH PASSWORD 'co_mmo';"
sudo -u postgres psql -c "CREATE DATABASE co_mmo OWNER co_mmo;"
```

Then add this line to `.env` and start the game as usual (`npm run dev`, or
"Pull and restart" in God's View once the line is in):

```sh
DATABASE_URL=postgres://co_mmo:co_mmo@localhost:5432/co_mmo
```

The console says `The world is kept in Postgres on localhost:5432.` and,
the first time, that it brought the world in from `data/world.json`. If
Postgres is not running the server stops with a message saying it could not
reach it.

Removing the line goes back to the built-in Postgres in `data/db/`, which
is a separate world: nothing is copied between the two.

## Redis

Every picture, clip and sound waits its turn in the paint queue, so Google
and ElevenLabs are never asked faster than they allow. With `REDIS_URL` set
the turns are counted in Redis: servers sharing one key share its limits,
and when Google stops a model for the day (Veo's daily clips, say) it stays
stopped after a restart until Google's reset at 08:00 UTC, instead of the
first painting after the restart asking again and being refused. A turn
taken by a server that died lapses after a minute.

If Redis goes away while the game runs, waiting paintings wait and ask
again every few seconds; nothing is lost.

### Set it up on your machine

`docker compose up -d` (above) starts Redis too. Without Docker:

```sh
sudo apt install redis-server
```

Then add to `.env`:

```sh
REDIS_URL=redis://localhost:6379
```

The console says `The paint queue is kept in Redis.`

## Region servers

The world is a grid of regions, and each region is simulated by one host:
the game server itself, or a region server (design doc, Scaling without a
cap). Players always connect to the game server, which keeps the sockets,
the saved world, the God and God's View; a region server runs the regions
it is given and sends each player's updates back through the game server,
over Redis.

- While no region server is up, every region runs in the game server, as
  before. Nothing changes for local play without `REDIS_URL`.
- When a region server starts, the game server hands it the regions it is
  running, and a second server takes its share of the regions nobody is in.
- Walking from a region on one server into a region on another works like
  any other road: the first server lets the player go, the second takes
  them in where they stepped across.
- A region server that stops (or stops answering for 7 seconds) loses its
  regions to the others, or back to the game server; players inside are put
  back where they were last seen, with what they carry. Nothing is lost
  except the last moment of a fight.
- Wished creatures and people come with their region wherever it moves.

### Run some

With Redis set up (above), either start them by hand, as many as you like,
on this machine or any machine that reaches the same Redis:

```sh
REDIS_URL=redis://localhost:6379 npm run region-server
```

or let `npm run dev` start them with the game by adding to `.env`:

```sh
REGION_SERVERS=2
```

Each one says `Region server <name> joined.` in the game server's console.
For a few friends on one laptop, region servers are not needed; they are
how the world grows past what one process can run.

## Smooth play on any connection

What the game server sends players is made to stay smooth on home Wi-Fi
and phones, and to fit a home connection's upload when the game runs on a
laptop. `npm run netbench` measures it (docs/playtest.md).

- **Others on the server's clock.** The browser draws other players and
  creatures on the server's time, worked out from each snapshot's tick
  (shared `snapshot-clock.ts`), just far enough behind it for the network's
  wobble, so an uneven connection does not make them stutter.
- **Compression.** Snapshots are compressed on the way out (WebSocket
  permessage-deflate, `socket-net.ts`): with 40 players in view each player
  gets about 7 KB a second instead of 98, and the host sends about 0.3 MB a
  second instead of 3.8. It costs some processor time on the game server.
  `NET_COMPRESS=off` turns it off.
- **No queue on a slow line.** The browser says a few times a second which
  snapshot it has (`seen`). When snapshots start taking much longer than
  usual to get there, they are waiting in a queue, so the game server skips
  them (`snapshot-gate.ts`) and sends one every half second until the line
  catches up, rather than let the player fall seconds behind. Each snapshot
  carries everything in view, so nothing is lost but in-between steps; F3
  shows how many were skipped. `NET_SKIP_STALE=off` turns it off.

## Crowds

Nobody is turned away from a crowded region (design doc, Scaling without a
cap). Two things happen as it fills:

- **Fewer snapshots.** A player's snapshots go out every tick until more
  than 40 people and creatures are in view, then every 2, 3 and at most 4
  ticks. A process whose ticks take more than half their time slows them
  down the same way. Players' own steps are predicted on their screen and
  others are drawn a little further in the past (one gap between snapshots
  plus the network's wobble, `snapshot-clock.ts`), so movement stays smooth,
  just slightly less precise.
- **Cells.** Past 50 players a region splits into strips side by side
  (up to four, at least 16 tiles wide), each run on its own, spread over
  the region servers when there are some. Players walk between cells
  without noticing and see across the borders; fights, trades, searching
  bodies and nearby talk stay within a cell, and the Region channel reaches
  them all. A split region joins up again once it has stayed under three
  quarters of that for half a minute. Splitting or joining sets the
  creatures up afresh, like a restart.


God's View has an Owner-only **Server health** tab. It lists the game
server and every region server with the regions each one runs, how many
players are in them, how long a tick takes on average and at worst (a tick
has 50 ms; a card turns red when the slowest one ran over), memory, the
errors it caught and the last one, and the machine and process it runs as.
It refreshes every few seconds.

Each region has **Restart**, which sets it up again where it runs, and
**Move** with a choice of host, which sets it up on another server. Players
inside stay where they stood and see a short pause; creatures respawn.
Without region servers, Restart still works on the game server.

## Hosting

Any Postgres 14 or newer works (Fly.io, Neon, Supabase, a VPS). Set
`DATABASE_URL` on the server; the tables are made on first start. A single
server can also run on the built-in Postgres, with `DB_DIR` on a lasting
volume. Any Redis
6.2 or newer works for `REDIS_URL` (Upstash, Fly.io, a VPS).

## Tests

`npm test` runs the Postgres tests on an embedded Postgres (PGlite), so
nothing needs installing. To run them against a real server as well:

```sh
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_test_db npx vitest run packages/server/test/store-postgres.test.ts
```

The test database is wiped, so never point it at the game's. The Redis
ledger's tests run only with `TEST_REDIS_URL` set (keys starting with
`co-mmo-test:` are deleted); the shared queue itself is tested on an
in-memory ledger in every run.
