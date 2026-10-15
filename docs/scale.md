# Running at scale: Postgres and Redis

Milestone 11 moves the saved world out of one JSON file and into Postgres,
and keeps the paint queue in Redis (later steps also pass messages between
servers through it). Both are optional for local development: without
`DATABASE_URL` the game keeps using `data/world.json`, and without
`REDIS_URL` the paint queue lives in memory, exactly as before.

## Postgres

The server keeps the whole world in memory and writes what changed behind
it, so play never waits on the database. Each kind of thing has its own
table (`accounts`, `invites`, `content` for wishes, `reports`, `spend`,
`journal`, `drafts`, `rule_data`, `settings`), each row a key and the thing
as JSON, so any Postgres tool can read them.

On its first start with an empty database, the server copies everything
from the JSON file (`DATA_FILE`, `data/world.json` by default) into Postgres
and says so in the console. The file is left as it was, as a backup; later
starts ignore it.

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

The console says `The world is kept in Postgres.` and, the first time, that
it brought the world in from `data/world.json`. If Postgres is not running
the server stops with a message saying it could not reach it.

To go back to the file, remove the line. The file does not have what was
saved in Postgres since; nothing copies it back.

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

## Server health

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
`DATABASE_URL` on the server; the tables are made on first start. Any Redis
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
