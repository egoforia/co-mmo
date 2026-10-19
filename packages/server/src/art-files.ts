import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { serveFile } from './http.ts';

// Pictures, clips' frames and sounds the server painted or made, served
// under /wished-art/ from the art directory. Each kind of file has one row:
// a URL pattern and the folder it maps to. Names are checked by the pattern,
// so no URL can reach outside its folder.

/** One kind of painted file: its URL pattern, and the path in the art directory its match names. */
interface ArtRoute {
  pattern: RegExp;
  file: (m: RegExpMatchArray) => string[];
}

const ROUTES: ArtRoute[] = [
  { pattern: /^\/wished-art\/([\w-]+)\.png$/, file: (m) => [`${m[1]}.png`] },
  { pattern: /^\/wished-art\/buildings\/([\w-]+\.(?:png|webp))$/, file: (m) => ['buildings', m[1]!] },
  { pattern: /^\/wished-art\/samples\/([\w-]+)\.png$/, file: (m) => ['samples', `${m[1]}.png`] },
  { pattern: /^\/wished-art\/walks\/([\w-]+\.png)$/, file: (m) => ['walks', m[1]!] },
  { pattern: /^\/wished-art\/walks\/views\/([\w-]+\.png)$/, file: (m) => ['walks', 'views', m[1]!] },
  { pattern: /^\/wished-art\/redone\/([\w-]+\.png)$/, file: (m) => ['redone', m[1]!] },
  { pattern: /^\/wished-art\/history\/([\w~-]+)\/([0-9a-z]+\.(?:png|webp))$/, file: (m) => ['history', m[1]!, m[2]!] },
  { pattern: /^\/wished-art\/history\/([\w~-]+)\/([0-9a-z]+)\/strip\.png$/, file: (m) => ['history', m[1]!, m[2]!, 'strip.png'] },
  { pattern: /^\/wished-art\/recipes\/pictures\/([0-9a-f]+\.webp)$/, file: (m) => ['recipes', 'pictures', m[1]!] },
  { pattern: /^\/wished-art\/sounds\/([\w-]+\.mp3)$/, file: (m) => ['sounds', m[1]!] },
  { pattern: /^\/wished-art\/biomes\/([\w-]+\.png)$/, file: (m) => ['biomes', m[1]!] },
  { pattern: /^\/wished-art\/kit-houses\/([\w-]+)\/([\w-]+\.png)$/, file: (m) => ['kit-houses', m[1]!, m[2]!] },
];

/** The file in `artDir` a /wished-art/ URL path names, or undefined when it names none. */
export function artFilePath(artDir: string, path: string): string | undefined {
  for (const route of ROUTES) {
    const m = path.match(route.pattern);
    if (m) return join(artDir, ...route.file(m));
  }
  return undefined;
}

/** Serves a painted file for a GET of its URL; false when the path is not one. */
export async function serveArtFile(artDir: string, path: string, method: string | undefined, res: ServerResponse): Promise<boolean> {
  if (method !== 'GET') return false;
  const file = artFilePath(artDir, path);
  if (!file) return false;
  await serveFile(file, res);
  return true;
}
