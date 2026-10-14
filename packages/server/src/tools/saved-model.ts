import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The image model chosen in God's View, read from the game's data file, so
 * art tools paint with the same model wishes do. `--model` on a tool's
 * command line overrides it.
 */
export async function savedImageModel(repoRoot: string): Promise<string | undefined> {
  const file = resolve(process.env.DATA_FILE ?? resolve(repoRoot, 'data/world.json'));
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as { settings?: { ai?: { image?: { provider?: string; model?: string } } } };
    const image = data.settings?.ai?.image;
    return image?.provider === 'gemini' && image.model ? image.model : undefined;
  } catch {
    return undefined;
  }
}
