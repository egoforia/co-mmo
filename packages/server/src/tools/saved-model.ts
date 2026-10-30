import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { connectPostgres } from '../db.ts';
import { IMAGE_PROVIDERS, imageProviderFor } from '../ai/services.ts';
import type { ImageProvider } from '../assets/provider.ts';

type SavedSettings = { ai?: { image?: { provider?: string; model?: string } } };

/**
 * The image provider and model chosen in God's View, read from the game's
 * saved world (Postgres when DATABASE_URL is set, else the data file), so
 * art tools paint with the same model wishes do.
 */
export async function savedImageChoice(repoRoot: string): Promise<{ provider?: string; model?: string }> {
  const image = (await savedSettings(repoRoot))?.ai?.image;
  return { provider: image?.provider, model: image?.model || undefined };
}

/**
 * Reads the checkout's `.env` into process.env when there is one, as
 * `npm run dev` does, so the art tools work without exporting keys by hand.
 * Anything already set in the terminal wins.
 */
export function loadEnv(repoRoot: string): void {
  const file = resolve(repoRoot, '.env');
  // process.loadEnvFile arrived in Node 20.12; older Node just skips it.
  if (existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
}

/**
 * The image provider an art tool paints with: `--provider` and `--model` on
 * its command line, else the choice saved in God's View, else Gemini. Exits
 * with a plain sentence when that provider has no key or cannot paint.
 */
export async function toolImageProvider(repoRoot: string, flags: { provider?: string; model?: string }): Promise<ImageProvider> {
  const saved = await savedImageChoice(repoRoot);
  const provider = flags.provider ?? (saved.provider && saved.provider !== 'none' ? saved.provider : 'gemini');
  // A saved model belongs to the saved provider; another provider starts from its own default.
  const model = flags.model ?? (provider === saved.provider ? saved.model : undefined) ?? (provider === 'gemini' ? process.env.GEMINI_IMAGE_MODEL : undefined);
  if (!(IMAGE_PROVIDERS as readonly string[]).includes(provider)) {
    console.error(`"${provider}" cannot paint pictures yet. Pictures can be painted with: ${IMAGE_PROVIDERS.join(', ')}.`);
    process.exit(1);
  }
  const made = imageProviderFor(provider, model, process.env);
  if (!made) {
    console.error(`No key is set for ${provider}. Put it in .env (for Gemini, GEMINI_API_KEY=...) and run this again.`);
    process.exit(1);
  }
  return made;
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
