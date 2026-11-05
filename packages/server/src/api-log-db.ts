import { readdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sql } from './db.ts';
import type { ApiCall, ApiCallSummary } from './api-log.ts';

// Where the API Log keeps its calls: one row per call in the `api_log` table,
// with its day and size in columns of their own, so the list loads from the
// summaries alone and a whole day goes in one DELETE.

/** One kept call as the log lists it. */
export interface StoredCall {
  summary: ApiCallSummary;
  day: string;
  bytes: number;
}

/** Makes the table if it is missing. */
export async function migrateApiLog(sql: Sql): Promise<void> {
  await sql.query('CREATE TABLE IF NOT EXISTS api_log (id text PRIMARY KEY, at bigint NOT NULL, day text NOT NULL, bytes integer NOT NULL, summary jsonb NOT NULL, call jsonb NOT NULL)');
  await sql.query('CREATE INDEX IF NOT EXISTS api_log_day ON api_log (day)');
}

/** Every kept call's summary, oldest first. */
export async function loadCalls(sql: Sql): Promise<StoredCall[]> {
  const { rows } = await sql.query<{ summary: ApiCallSummary; day: string; bytes: number }>('SELECT summary, day, bytes FROM api_log ORDER BY at, id');
  return rows.map((r) => ({ summary: r.summary, day: r.day, bytes: Number(r.bytes) }));
}

/** Keeps one call; `stored` may have its headers and bodies left out. */
export async function insertCall(sql: Sql, kept: StoredCall, stored: ApiCall): Promise<void> {
  await sql.query(
    'INSERT INTO api_log (id, at, day, bytes, summary, call) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb) ON CONFLICT (id) DO NOTHING',
    [kept.summary.id, kept.summary.at, kept.day, kept.bytes, json(kept.summary), json(stored)],
  );
}

/** One whole call. */
export async function readCall(sql: Sql, id: string): Promise<ApiCall | undefined> {
  const { rows } = await sql.query<{ call: ApiCall }>('SELECT call FROM api_log WHERE id = $1', [id]);
  return rows[0]?.call;
}

/** Lets a whole day go. */
export async function dropDay(sql: Sql, day: string): Promise<void> {
  await sql.query('DELETE FROM api_log WHERE day = $1', [day]);
}

/**
 * Brings in the calls an older game kept as `<day>.jsonl` files in `dir`,
 * then renames each file `<name>.in-db` so it is kept as a backup and never
 * brought in twice. Returns how many calls came in.
 */
export async function importDayFiles(sql: Sql, dir: string, keep: (call: ApiCall) => StoredCall): Promise<number> {
  const names = await readdir(dir).catch(() => [] as string[]);
  let count = 0;
  for (const name of names.filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort()) {
    const text = await readFile(join(dir, name), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      if (!line) continue;
      let call: ApiCall;
      try {
        call = JSON.parse(line) as ApiCall;
      } catch {
        continue; // A line cut short by a crash; the calls after it are still read.
      }
      if (!call.id || !call.at) continue;
      await insertCall(sql, keep(call), call);
      count++;
    }
    for (const file of [name, name.replace(/\.jsonl$/, '.index.jsonl')]) await rename(join(dir, file), join(dir, `${file}.in-db`)).catch(() => {});
  }
  return count;
}

/** JSON for a jsonb column, which cannot hold the NUL character. */
function json(data: unknown): string {
  return JSON.stringify(data, (_key, value: unknown) => (typeof value === 'string' && value.includes('\0') ? value.replaceAll('\0', '') : value));
}
