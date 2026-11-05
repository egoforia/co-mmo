import { PGlite } from '@electric-sql/pglite';
import { connectPostgres, pgliteSql, type Sql } from '../src/db.ts';

/** A database the store can use in tests, emptied by `reset` and ended by `end`. */
export interface TestSql extends Sql {
  reset(): Promise<void>;
  end(): Promise<void>;
}

/**
 * An embedded Postgres (PGlite) in memory, or the real Postgres at
 * TEST_DATABASE_URL when it is set. `close` keeps it open, so a test can
 * start the store again on the same data, as after a restart.
 */
export async function testSql(): Promise<TestSql> {
  const url = process.env.TEST_DATABASE_URL;
  const sql: Sql = url ? await connectPostgres(url) : pgliteSql(new PGlite());
  return {
    query: (text, params) => sql.query(text, params),
    transaction: (work) => sql.transaction(work),
    close: async () => {},
    reset: async () => {
      await sql.query('DROP SCHEMA IF EXISTS public CASCADE');
      await sql.query('CREATE SCHEMA public');
    },
    end: () => sql.close(),
  };
}
