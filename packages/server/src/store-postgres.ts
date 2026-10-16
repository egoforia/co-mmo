import type { Sql, SqlQuery } from './db.ts';

/**
 * Each part of the saved world gets its own table of the same shape: a key,
 * the order things were added in, and the thing itself as JSON. People can
 * read the tables with any Postgres tool; the game keeps a copy in memory
 * and writes only what changed.
 */
export const TABLES = ['accounts', 'invites', 'content', 'reports', 'spend', 'journal', 'drafts', 'rule_data', 'settings'] as const;
export type Table = (typeof TABLES)[number];

/** One saved thing: its key, its place in the order, and its JSON. */
export interface Row {
  key: string;
  data: unknown;
}

/** Bumped when the tables change shape, so an older database is brought up to date. */
const SCHEMA_VERSION = 1;

/** Makes the tables if they are missing. */
export async function migrate(sql: Sql): Promise<void> {
  await sql.transaction(async (q) => {
    await q.query('CREATE TABLE IF NOT EXISTS co_mmo_meta (key text PRIMARY KEY, value text NOT NULL)');
    for (const table of TABLES) {
      await q.query(`CREATE TABLE IF NOT EXISTS ${table} (key text PRIMARY KEY, n bigint NOT NULL, data jsonb NOT NULL)`);
      await q.query(`CREATE INDEX IF NOT EXISTS ${table}_n ON ${table} (n)`);
    }
    await q.query(
      `INSERT INTO co_mmo_meta (key, value) VALUES ('schema', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(SCHEMA_VERSION)],
    );
  });
}

/**
 * Remembers what is in the database, so a save writes only the rows that
 * changed, added or went away since the last one.
 */
export class PostgresTables {
  /** Per table: each key's JSON as last written, and its place in the order. */
  private readonly saved = new Map<Table, Map<string, { json: string; n: number }>>();
  private next = 1;

  constructor(private readonly sql: Sql) {
    for (const table of TABLES) this.saved.set(table, new Map());
  }

  /** Reads every table in the order things were added. */
  async load(): Promise<Record<Table, Row[]>> {
    const result = {} as Record<Table, Row[]>;
    for (const table of TABLES) {
      const { rows } = await this.sql.query<{ key: string; n: string | number; data: unknown }>(`SELECT key, n, data FROM ${table} ORDER BY n`);
      const saved = this.saved.get(table)!;
      saved.clear();
      result[table] = rows.map((r) => {
        const n = Number(r.n);
        this.next = Math.max(this.next, n + 1);
        saved.set(r.key, { json: toJson(r.data), n });
        return { key: r.key, data: r.data };
      });
    }
    return result;
  }

  /** True when nothing has been saved yet, so an old world file may be brought in. */
  async empty(): Promise<boolean> {
    for (const table of TABLES) {
      const { rows } = await this.sql.query(`SELECT 1 FROM ${table} LIMIT 1`);
      if (rows.length) return false;
    }
    return true;
  }

  /** Highest order number handed out so far, for keys made from it. */
  takeNumber(): number {
    return this.next++;
  }

  /**
   * Writes the tables to match `now`, in one transaction. Only what changed
   * is sent; if the write fails nothing is marked saved, so the next save
   * tries again.
   */
  async save(now: Record<Table, Row[]>): Promise<number> {
    const writes: { table: Table; key: string; json: string; n: number }[] = [];
    const deletes: { table: Table; key: string }[] = [];
    for (const table of TABLES) {
      const saved = this.saved.get(table)!;
      const seen = new Set<string>();
      for (const row of now[table]) {
        seen.add(row.key);
        const json = toJson(row.data);
        const before = saved.get(row.key);
        if (before?.json === json) continue;
        writes.push({ table, key: row.key, json, n: before?.n ?? this.next++ });
      }
      for (const key of saved.keys()) if (!seen.has(key)) deletes.push({ table, key });
    }
    if (!writes.length && !deletes.length) return 0;
    await this.sql.transaction(async (q: SqlQuery) => {
      for (const w of writes) {
        await q.query(
          `INSERT INTO ${w.table} (key, n, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
          [w.key, w.n, w.json],
        );
      }
      for (const d of deletes) await q.query(`DELETE FROM ${d.table} WHERE key = $1`, [d.key]);
    });
    for (const w of writes) this.saved.get(w.table)!.set(w.key, { json: w.json, n: w.n });
    for (const d of deletes) this.saved.get(d.table)!.delete(d.key);
    return writes.length + deletes.length;
  }
}

/** JSON for a jsonb column, which cannot hold the NUL character: one stray NUL must not stop every later save. */
function toJson(data: unknown): string {
  return JSON.stringify(data, (_key, value: unknown) => (typeof value === 'string' && value.includes('\0') ? value.replaceAll('\0', '') : value));
}
