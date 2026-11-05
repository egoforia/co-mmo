import type { Sql, SqlQuery } from './db.ts';
import type { JournalEntry, SpendRecord } from './store.ts';

// Spending and the journal only ever grow, so unlike the rest of the saved
// world they are not compared row by row on every save: each line is added
// once (append-only), and the game keeps only the recent part in memory
// (this month's and last month's spending for the budget, the latest journal
// lines for "While you were away"). Older lines stay in the database.

/** One change to the logs, sent with the next save. */
export type LogOp =
  | { t: 'spend'; record: SpendRecord }
  /** A guessed charge taken back when the real figure arrives. */
  | { t: 'unspend'; ref: string }
  | { t: 'journal'; entry: JournalEntry };

/**
 * Makes the log tables and, from an older database, moves the spending and
 * journal rows out of the old key/JSON tables into them, oldest first.
 */
export async function migrateLogs(q: SqlQuery): Promise<void> {
  await q.query('CREATE TABLE IF NOT EXISTS spend_log (id bigserial PRIMARY KEY, at bigint NOT NULL, ref text, estimate boolean NOT NULL DEFAULT false, usd double precision NOT NULL, data jsonb NOT NULL)');
  await q.query('CREATE INDEX IF NOT EXISTS spend_log_at ON spend_log (at)');
  await q.query('CREATE INDEX IF NOT EXISTS spend_log_ref ON spend_log (ref)');
  await q.query('CREATE TABLE IF NOT EXISTS journal_log (id bigserial PRIMARY KEY, at bigint NOT NULL, player_id text, data jsonb NOT NULL)');
  await q.query('CREATE INDEX IF NOT EXISTS journal_log_at ON journal_log (at)');
  for (const [old, insert] of [
    ['spend', `INSERT INTO spend_log (at, ref, estimate, usd, data)
       SELECT (data->>'at')::bigint, data->>'ref', COALESCE((data->>'estimate')::boolean, false), (data->>'usd')::double precision, data FROM spend ORDER BY n`],
    ['journal', `INSERT INTO journal_log (at, player_id, data) SELECT (data->>'at')::bigint, data->>'playerId', data FROM journal ORDER BY n`],
  ] as const) {
    const { rows } = await q.query<{ found: string | null }>(`SELECT to_regclass('public.${old}')::text AS found`);
    if (!rows[0]?.found) continue;
    await q.query(insert);
    await q.query(`DROP TABLE ${old}`);
  }
}

/** The append-only logs in Postgres. */
export class PostgresLogs {
  constructor(private readonly sql: Sql) {}

  /** True when neither log has a line yet. */
  async empty(): Promise<boolean> {
    for (const table of ['spend_log', 'journal_log']) {
      const { rows } = await this.sql.query(`SELECT 1 FROM ${table} LIMIT 1`);
      if (rows.length) return false;
    }
    return true;
  }

  /** Spending from `since` on (the part the budget needs), oldest first. */
  async spendSince(since: number): Promise<SpendRecord[]> {
    return this.spendBetween(since, Number.MAX_SAFE_INTEGER);
  }

  /** Spending from `since` up to and including `until`, oldest first: any span, for reports. */
  async spendBetween(since: number, until: number): Promise<SpendRecord[]> {
    const { rows } = await this.sql.query<{ data: SpendRecord }>('SELECT data FROM spend_log WHERE at >= $1 AND at <= $2 ORDER BY id', [since, until]);
    return rows.map((r) => r.data);
  }

  /** The latest `limit` journal lines, oldest first. */
  async latestJournal(limit: number): Promise<JournalEntry[]> {
    const { rows } = await this.sql.query<{ data: JournalEntry }>('SELECT data FROM (SELECT id, data FROM journal_log ORDER BY id DESC LIMIT $1) latest ORDER BY id', [limit]);
    return rows.map((r) => r.data);
  }

  /** Applies `ops` in order, inside the save's transaction. */
  async write(q: SqlQuery, ops: readonly LogOp[]): Promise<void> {
    for (const op of ops) {
      if (op.t === 'spend') {
        const r = op.record;
        await q.query('INSERT INTO spend_log (at, ref, estimate, usd, data) VALUES ($1, $2, $3, $4, $5::jsonb)', [r.at, r.ref ?? null, Boolean(r.estimate), r.usd, json(r)]);
      } else if (op.t === 'unspend') {
        await q.query('DELETE FROM spend_log WHERE ref = $1 AND estimate', [op.ref]);
      } else {
        await q.query('INSERT INTO journal_log (at, player_id, data) VALUES ($1, $2, $3::jsonb)', [op.entry.at, op.entry.playerId, json(op.entry)]);
      }
    }
  }
}

/** Midnight (UTC) on the first day of the month before the one holding `now`: how far back memory keeps spending. */
export function keptSpendFrom(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
}

/** JSON for a jsonb column, which cannot hold the NUL character. */
function json(data: unknown): string {
  return JSON.stringify(data, (_key, value: unknown) => (typeof value === 'string' && value.includes('\0') ? value.replaceAll('\0', '') : value));
}
