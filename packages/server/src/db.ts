import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import type { PGlite } from '@electric-sql/pglite';

/** One query against the database, inside or outside a transaction. */
export interface SqlQuery {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * The little the game asks of a SQL database: a Postgres server
 * (DATABASE_URL), or the Postgres built into the game (PGlite) when there is
 * none, which speaks the same SQL.
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

/** File in the built-in database's folder naming the process that has it open. */
const LOCK = 'co-mmo-server.pid';

/**
 * Opens the Postgres built into the game (PGlite), kept in the folder `dir`
 * and made on first use, so the game starts with nothing installed. Only one
 * process may have it open: a second game server on the same folder is
 * refused rather than let it damage the saved world.
 */
export async function openBuiltInPostgres(dir: string): Promise<Sql> {
  await mkdir(dir, { recursive: true });
  const lock = join(dir, LOCK);
  const holder = Number.parseInt(await readFile(lock, 'utf8').catch(() => ''), 10);
  if (holder && holder !== process.pid && running(holder)) {
    throw new Error(`Another game server (process ${holder}) is already using the world in ${dir}. Stop it first, or set DATABASE_URL to share a Postgres server (docs/scale.md).`);
  }
  await writeFile(lock, String(process.pid));
  const { PGlite } = await import('@electric-sql/pglite');
  let db: PGlite;
  try {
    db = await PGlite.create(dir);
  } catch (err) {
    await rm(lock, { force: true });
    throw new Error(`Could not open the saved world in ${dir}: ${(err as Error).message}`);
  }
  const sql = pgliteSql(db);
  return {
    ...sql,
    close: async () => {
      await sql.close();
      await rm(lock, { force: true });
    },
  };
}

/** A PGlite database as the game's Sql: the built-in one, or one in memory for tests. */
export function pgliteSql(db: PGlite): Sql {
  return {
    query: (text, params) => db.query(text, params) as never,
    transaction: (work) => db.transaction((tx) => work({ query: (text, params) => tx.query(text, params) as never })),
    close: () => db.close(),
  };
}

/** True while a process with this id is alive. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: alive, but someone else's.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
