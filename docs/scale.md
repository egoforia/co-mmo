# Running at scale: Postgres and Redis

Milestone 11 moves the saved world out of one JSON file and into Postgres,
then (later steps) shares the paint queue and messages between servers
through Redis. Both are optional for local development: without
`DATABASE_URL` the game keeps using `data/world.json`, exactly as before.

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

### Hosting

Any Postgres 14 or newer works (Fly.io, Neon, Supabase, a VPS). Set
`DATABASE_URL` on the server; the tables are made on first start.

### Tests

`npm test` runs the Postgres tests on an embedded Postgres (PGlite), so
nothing needs installing. To run them against a real server as well:

```sh
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/empty_test_db npx vitest run packages/server/test/store-postgres.test.ts
```

The test database is wiped, so never point it at the game's.
