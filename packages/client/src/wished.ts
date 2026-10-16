import { applyContent, placeholderArt, regionPictures, ruleItemId, wishArtKey, type ContentEntry, type PicturedWish, type RuleItem } from '@co-mmo/shared';

// Everything the God has made, as this client knows it: the content log, and
// a picture for each wished thing. Until the image model paints a wish's own
// art, it wears the built-in sprite of its kind as it is.

const entries = new Map<string, ContentEntry>();
const urls = new Map<string, string>();
const listeners = new Set<(changed: ContentEntry[]) => void>();

/** Applies a content message: registers definitions and prepares art. */
export function updateContent(list: ContentEntry[], replace: boolean): void {
  if (replace) {
    for (const old of entries.values()) if (!list.some((e) => e.id === old.id)) applyContent({ ...old, status: 'rolled-back' });
    entries.clear();
  }
  for (const entry of list) {
    entries.set(entry.id, entry);
    applyContent(entry);
  }
  void Promise.all(list.map(prepareArt)).then(() => {
    for (const listener of listeners) listener(list);
  });
}

export function onContent(listener: (changed: ContentEntry[]) => void): void {
  listeners.add(listener);
}

export function contentEntries(): ContentEntry[] {
  return [...entries.values()].sort((a, b) => b.at - a.at);
}

/** The art key of a player's own look, once they have described it. */
export function lookArt(playerId: string): string | undefined {
  // A newer look (changed in the Wish Workshop) replaces an older one.
  let newest: ContentEntry | undefined;
  for (const e of entries.values()) {
    if (e.status === 'granted' && e.definition?.kind === 'player' && e.wisher.id === playerId && (!newest || e.at > newest.at)) newest = e;
  }
  return newest ? wishArtKey(newest.id) : undefined;
}

/**
 * Art the world scene draws for granted wishes, as [texture key, URL]: each
 * wished thing, the creatures and person a region brings, and a wished
 * biome's painted kit.
 */
export function sceneArt(): [string, string][] {
  const art: [string, string][] = [];
  for (const e of entries.values()) {
    const def = e.definition;
    if (e.status !== 'granted' || !def) continue;
    if (def.kind === 'region') {
      for (const p of regionPictures(e.id, def)) {
        const key = wishArtKey(p.id);
        if (urls.has(key)) art.push([key, urls.get(key)!]);
      }
      for (const [id, url] of Object.entries(e.kitArt ?? {})) art.push([id, url]);
    } else if (def.kind !== 'recipe' && def.kind !== 'loot') {
      const key = wishArtKey(e.id);
      art.push([key, artSrc(key)]);
    }
  }
  return art;
}

/** Picture for an asset key, wished or built-in. */
export function artSrc(asset: string, icon = false): string {
  if (asset.startsWith('wished-')) return urls.get(asset) ?? 'art/item-goat-horn-icon.png';
  return icon ? `art/${asset}-icon.png` : `art/${asset}.png`;
}

async function prepareArt(entry: ContentEntry): Promise<void> {
  const def = entry.definition;
  if (!def || entry.status !== 'granted') return;
  // A scripted rule brings items, each with its own picture.
  if (def.kind === 'rule') {
    await Promise.all(Object.entries(def.items).map(([key, item]) => {
      const id = ruleItemId(entry.id, key);
      return picture(wishArtKey(id), entry.itemArt?.[id], item);
    }));
    return;
  }
  if (def.kind === 'region') {
    await Promise.all(regionPictures(entry.id, def).map((p) => picture(wishArtKey(p.id), entry.itemArt?.[p.id], p.def)));
    return;
  }
  if (def.kind !== 'recipe' && def.kind !== 'loot') await picture(wishArtKey(entry.id), entry.art, def);
}

async function picture(key: string, painted: string | undefined, def: PicturedWish | RuleItem): Promise<void> {
  if (painted) {
    urls.set(key, painted);
    return;
  }
  if (!urls.has(key)) urls.set(key, `art/${placeholderArt(def)}.png`);
}
