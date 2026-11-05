import type { Sql, SqlQuery } from './db.ts';

// Small things the server keeps between restarts outside the saved world's
// main tables: sign-in links waiting to be opened, the Art tab's queues and
// notes, the painting log. Each is a JSON document under a kind and a key,
// written straight through (not behind, like the world), so every game
// server sharing the database sees the same one. Things that run out carry
// an expiry and are swept away.

/** One kept document and its key. */
export interface KeptRow<T> {
  key: string;
  data: T;
}

/** JSON documents by kind and key, kept in Postgres in play and in memory in tests. */
export interface Kept {
  get<T>(kind: string, key: string): Promise<T | undefined>;
  /** Saves `data` under the key, replacing what was there; `expires` (ms since 1970) lets it run out. */
  put(kind: string, key: string, data: unknown, expires?: number): Promise<void>;
  /** Reads and removes in one step, so a one-time code can only be used once even with two servers. */
  take<T>(kind: string, key: string): Promise<T | undefined>;
  delete(kind: string, key: string): Promise<void>;
  /** Every document of a kind, in the order they were first saved. */
  list<T>(kind: string): Promise<KeptRow<T>[]>;
  /** Removes every document whose expiry is before `now`. */
  sweep(now: number): Promise<void>;
}

/** Makes the table if it is missing. */
export async function migrateKept(q: SqlQuery): Promise<void> {
  await q.query('CREATE TABLE IF NOT EXISTS kept (kind text NOT NULL, key text NOT NULL, n bigserial, data jsonb NOT NULL, expires bigint, PRIMARY KEY (kind, key))');
  await q.query('CREATE INDEX IF NOT EXISTS kept_expires ON kept (expires) WHERE expires IS NOT NULL');
}

/** Kept documents in Postgres. */
export class PostgresKept implements Kept {
  constructor(private readonly sql: Sql) {}

  async get<T>(kind: string, key: string): Promise<T | undefined> {
    const { rows } = await this.sql.query<{ data: T }>('SELECT data FROM kept WHERE kind = $1 AND key = $2', [kind, key]);
    return rows[0]?.data;
  }

  async put(kind: string, key: string, data: unknown, expires?: number): Promise<void> {
    await this.sql.query(
      'INSERT INTO kept (kind, key, data, expires) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (kind, key) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires',
      [kind, key, json(data), expires ?? null],
    );
  }

  async take<T>(kind: string, key: string): Promise<T | undefined> {
    const { rows } = await this.sql.query<{ data: T }>('DELETE FROM kept WHERE kind = $1 AND key = $2 RETURNING data', [kind, key]);
    return rows[0]?.data;
  }

  async delete(kind: string, key: string): Promise<void> {
    await this.sql.query('DELETE FROM kept WHERE kind = $1 AND key = $2', [kind, key]);
  }

  async list<T>(kind: string): Promise<KeptRow<T>[]> {
    const { rows } = await this.sql.query<{ key: string; data: T }>('SELECT key, data FROM kept WHERE kind = $1 ORDER BY n', [kind]);
    return rows;
  }

  async sweep(now: number): Promise<void> {
    await this.sql.query('DELETE FROM kept WHERE expires IS NOT NULL AND expires < $1', [now]);
  }
}

/** Kept documents in memory, for tests and a store with no database. */
export class MemoryKept implements Kept {
  private readonly rows = new Map<string, { kind: string; key: string; json: string; expires?: number }>();

  async get<T>(kind: string, key: string): Promise<T | undefined> {
    const row = this.rows.get(id(kind, key));
    return row && (JSON.parse(row.json) as T);
  }

  async put(kind: string, key: string, data: unknown, expires?: number): Promise<void> {
    const at = id(kind, key);
    const row = { kind, key, json: json(data), ...(expires !== undefined ? { expires } : {}) };
    // Like the table, a replaced document keeps its place in the order (a Map does).
    this.rows.set(at, row);
  }

  async take<T>(kind: string, key: string): Promise<T | undefined> {
    const data = await this.get<T>(kind, key);
    this.rows.delete(id(kind, key));
    return data;
  }

  async delete(kind: string, key: string): Promise<void> {
    this.rows.delete(id(kind, key));
  }

  async list<T>(kind: string): Promise<KeptRow<T>[]> {
    return [...this.rows.values()].filter((r) => r.kind === kind).map((r) => ({ key: r.key, data: JSON.parse(r.json) as T }));
  }

  async sweep(now: number): Promise<void> {
    for (const [at, row] of this.rows) if (row.expires !== undefined && row.expires < now) this.rows.delete(at);
  }
}

function id(kind: string, key: string): string {
  return `${kind}\u0000${key}`;
}

/** JSON for a jsonb column, which cannot hold the NUL character. */
function json(data: unknown): string {
  return JSON.stringify(data, (_key, value: unknown) => (typeof value === 'string' && value.includes('\0') ? value.replaceAll('\0', '') : value));
}
