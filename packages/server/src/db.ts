import pg from 'pg';

/** One query against the database, inside or outside a transaction. */
export interface SqlQuery {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * The little the game asks of a SQL database: Postgres in play, or an
 * embedded Postgres (PGlite) in tests, which speaks the same SQL.
 */
export interface Sql extends SqlQuery {
  /** Runs `work` in one transaction: all of it is saved, or none of it. */
  transaction<T>(work: (sql: SqlQuery) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Connects to Postgres at `url` (DATABASE_URL), checking it answers before the game starts. */
export async function connectPostgres(url: string): Promise<Sql> {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  // An idle connection dropped by the database must not crash the server; the pool makes a new one.
  pool.on('error', (err) => console.error('Postgres connection lost:', err.message));
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    await pool.end().catch(() => {});
    throw new Error(`Could not reach Postgres at ${safeUrl(url)}: ${(err as Error).message}. Is it running? (docs/scale.md)`);
  }
  return {
    query: (text, params) => pool.query(text, params as unknown[]) as never,
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work({ query: (text, params) => client.query(text, params as unknown[]) as never });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** A database address fit for the console: the password is never printed. */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'the DATABASE_URL address';
  }
}
