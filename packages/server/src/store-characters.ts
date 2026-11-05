import type { Character } from '@co-mmo/shared';
import type { Sql, SqlQuery } from './db.ts';

// Characters are kept apart from their accounts, in tables of their own:
// `characters` (one row per character, with the numbers people ask about,
// such as level, gold and Favor, in columns) and `holdings` (one row per
// stack in a bag and per item worn), so the database can answer "who holds
// this item" or "who has the most gold" without reading every character.
// Like the rest of the saved world they are written behind, and only a
// character that changed since its last save is written again.

/** One stack a character holds, as the `holdings` table keeps it. */
export interface Holding {
  accountId: string;
  /** In the bag, or worn in an equipment slot. */
  place: 'bag' | 'worn';
  /** The bag slot's number, or the equipment slot's name. */
  slot: string;
  item: string;
  qty: number;
}

/** Makes the tables if they are missing. */
export async function migrateCharacters(q: SqlQuery): Promise<void> {
  await q.query(`CREATE TABLE IF NOT EXISTS characters (
    account_id text PRIMARY KEY, level integer NOT NULL, xp bigint NOT NULL, gold bigint NOT NULL, favor bigint NOT NULL,
    race text, calling text, path text, data jsonb NOT NULL)`);
  await q.query(`CREATE TABLE IF NOT EXISTS holdings (
    account_id text NOT NULL, place text NOT NULL, slot text NOT NULL, item text NOT NULL, qty integer NOT NULL,
    PRIMARY KEY (account_id, place, slot))`);
  await q.query('CREATE INDEX IF NOT EXISTS holdings_item ON holdings (item)');
}

/** What a character holds, as rows: each bag stack and each worn item. */
export function holdingsOf(accountId: string, character: Character): Holding[] {
  const bag = character.inventory.map((s, i) => ({ accountId, place: 'bag' as const, slot: String(i), item: s.item, qty: s.qty }));
  const worn = Object.entries(character.equipment ?? {}).flatMap(([slot, item]) => (item ? [{ accountId, place: 'worn' as const, slot, item, qty: 1 }] : []));
  return [...bag, ...worn];
}

/** The characters tables, remembering what each row held when last written. */
export class PostgresCharacters {
  /** Each character's JSON as last written, by account id. */
  private readonly saved = new Map<string, string>();

  constructor(private readonly sql: Sql) {}

  /** Every saved character, by account id. */
  async load(): Promise<Map<string, Character>> {
    const { rows } = await this.sql.query<{ account_id: string; data: Character }>('SELECT account_id, data FROM characters');
    this.saved.clear();
    const all = new Map<string, Character>();
    for (const r of rows) {
      all.set(r.account_id, r.data);
      this.saved.set(r.account_id, JSON.stringify(r.data));
    }
    return all;
  }

  /**
   * The writes that bring the tables to match `now` (characters by account
   * id), to run inside the save's transaction; nothing when nothing changed.
   * `done` marks them saved once that transaction has gone through.
   */
  changes(now: Map<string, Character>): { write: (q: SqlQuery) => Promise<void>; done: () => void } | undefined {
    const changed: [string, Character, string][] = [];
    for (const [id, character] of now) {
      const json = JSON.stringify(character);
      if (this.saved.get(id) !== json) changed.push([id, character, json]);
    }
    const gone = [...this.saved.keys()].filter((id) => !now.has(id));
    if (!changed.length && !gone.length) return undefined;
    return {
      write: async (q) => {
        for (const [id, c, json] of changed) {
          await q.query(
            `INSERT INTO characters (account_id, level, xp, gold, favor, race, calling, path, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
             ON CONFLICT (account_id) DO UPDATE SET level = EXCLUDED.level, xp = EXCLUDED.xp, gold = EXCLUDED.gold, favor = EXCLUDED.favor,
               race = EXCLUDED.race, calling = EXCLUDED.calling, path = EXCLUDED.path, data = EXCLUDED.data`,
            [id, c.level, c.xp, c.gold, c.favor, c.race ?? null, c.calling ?? null, c.path ?? null, clean(json)],
          );
          await q.query('DELETE FROM holdings WHERE account_id = $1', [id]);
          for (const h of holdingsOf(id, c)) {
            await q.query('INSERT INTO holdings (account_id, place, slot, item, qty) VALUES ($1, $2, $3, $4, $5)', [h.accountId, h.place, h.slot, h.item, h.qty]);
          }
        }
        for (const id of gone) {
          await q.query('DELETE FROM holdings WHERE account_id = $1', [id]);
          await q.query('DELETE FROM characters WHERE account_id = $1', [id]);
        }
      },
      done: () => {
        for (const [id, , json] of changed) this.saved.set(id, json);
        for (const id of gone) this.saved.delete(id);
      },
    };
  }

  /** Everyone holding `item`, in their bag or worn, as last saved. */
  async holders(item: string): Promise<Holding[]> {
    const { rows } = await this.sql.query<{ account_id: string; place: 'bag' | 'worn'; slot: string; item: string; qty: number }>(
      'SELECT account_id, place, slot, item, qty FROM holdings WHERE item = $1 ORDER BY account_id, place, slot',
      [item],
    );
    return rows.map((r) => ({ accountId: r.account_id, place: r.place, slot: r.slot, item: r.item, qty: Number(r.qty) }));
  }
}

/** JSON for a jsonb column, which cannot hold the NUL character. */
function clean(json: string): string {
  return json.includes('\\u0000') ? json.replaceAll('\\u0000', '') : json;
}
