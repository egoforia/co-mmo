import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectPostgres } from '../db.ts';

type SavedSettings = { ai?: { image?: { provider?: string; model?: string } } };

/**
 * The image model chosen in God's View, read from the game's saved world
 * (Postgres when DATABASE_URL is set, else the data file), so
 * art tools paint with the same model wishes do. `--model` on a tool's
 * command line overrides it.
 */
export async function savedImageModel(repoRoot: string): Promise<string | undefined> {
  const image = (await savedSettings(repoRoot))?.ai?.image;
  return image?.provider === 'gemini' && image.model ? image.model : undefined;
}

async function savedSettings(repoRoot: string): Promise<SavedSettings | undefined> {
  if (process.env.DATABASE_URL) {
    try {
      const sql = await connectPostgres(process.env.DATABASE_URL);
      try {
        const { rows } = await sql.query<{ data: SavedSettings }>(`SELECT data FROM settings WHERE key = 'settings'`);
        return rows[0]?.data;
      } finally {
        await sql.close();
      }
    } catch {
      return undefined;
    }
  }
  const file = resolve(process.env.DATA_FILE ?? resolve(repoRoot, 'data/world.json'));
  try {
    return (JSON.parse(await readFile(file, 'utf8')) as { settings?: SavedSettings }).settings;
  } catch {
    return undefined;
  }
}
