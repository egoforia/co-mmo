// Dry-run recipe previews and request builders for every ArtAsk kind, using a
// typed handler registry so new art kinds can be added in one place.

import {
  BUILDING_STYLES,
} from '@co-mmo/shared';
import { plain } from '../art-jobs.ts';
import { Previewed, dryImage, recipeUsd, type Recipe } from '../art-recipes.ts';
import type { SheetGuide } from '../assets/building-kit/sheet.ts';
import type { ImageProvider, ImageRequest } from '../assets/provider.ts';
import { seaCaveBox } from '../assets/sea-cave-kit.ts';
import { paintKitAsset } from '../assets/wild-kit.ts';
import { estimateImageUsd } from '../assets/wish-art.ts';
import { normalRequest } from '../normal-painter.ts';
import { facingWords } from '../walk-painter.ts';
import type { ArtCatalog } from './catalog.ts';
import {
  type ArtAsk,
  ArtRequestError,
  type ArtReview,
  type ArtStudioOptions,
  fingerprint,
  ownPrompt,
  useOf,
  withSelf,
} from './types.ts';

/** What painting one picture again would send. */
export async function previewPaint(
  asset: string,
  note: string,
  options: ArtStudioOptions,
  catalog: ArtCatalog,
  redoneDir: string,
): Promise<Recipe> {
  note = note.trim().slice(0, 1000);
  const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
  if (wishId && pictureId) {
    const record = options.store.contentById(wishId);
    if (!record || record.status !== 'granted') throw new ArtRequestError('That wish is not granted, so it has no picture to paint again.');
    return options.wishes.preview(record, pictureId, note ? `${catalog.promptOf(record, pictureId)}\nAlso: ${note}` : undefined);
  }
  if (Object.values(BUILDING_STYLES).some((s) => asset.startsWith(`${s.id}-`))) return options.buildings.preview(asset, note);
  const kit = catalog.kitAsset(asset);
  if (!kit) throw new ArtRequestError('There is no picture by that name.');
  // A sea cave piece is painted the first time at its kit's size.
  const box = (await options.shipped())[asset] ?? seaCaveBox(asset);
  if (!box) throw new ArtRequestError('That picture is not part of the game yet.');
  const provider = options.ai.image(useOf(kit));
  if (!provider) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
  const dry = dryImage(provider);
  await paintKitAsset(withSelf(kit), dry, options.anchorDir, redoneDir, { box: { width: box.width, height: box.height }, note }).catch((err) => {
    if (!(err instanceof Previewed)) throw err;
  });
  return { at: Date.now(), steps: [await options.recipes.imageStep(kit.name ?? asset, provider, dry.sent!, estimateImageUsd(provider.model))] };
}

/** The picture, model and request for painting a picture's normal map; refused when it cannot be painted. */
export async function normalAsk(
  asset: string,
  prompt: string | undefined,
  options: ArtStudioOptions,
  catalog: ArtCatalog,
): Promise<{ name: string; picture: Buffer; provider: ImageProvider; request: ImageRequest }> {
  const read = options.readArt;
  if (asset.includes(':') || !read) throw new ArtRequestError("Normal maps can be painted for the game's own pictures, not for wished ones yet.");
  const file = await catalog.pictureFile(asset);
  if (!file) throw new ArtRequestError('That picture is not part of the game yet, so it has no normal map to paint.');
  const provider = options.ai.image(catalog.useFor(asset));
  if (!provider) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
  const name = await catalog.nameOf(asset);
  const picture = await read(file).catch(() => {
    throw new ArtRequestError('That picture could not be read from disk.');
  });
  return { name, picture, provider, request: await normalRequest(picture, name, ownPrompt(prompt)) };
}

/** What painting a picture's normal map would send. */
export async function previewNormal(
  asset: string,
  prompt: string | undefined,
  options: ArtStudioOptions,
  catalog: ArtCatalog,
): Promise<Recipe> {
  const { name, provider, request } = await normalAsk(asset, prompt, options, catalog);
  return { at: Date.now(), steps: [await options.recipes.imageStep(`Normal map of ${name}`, provider, request, estimateImageUsd(provider.model))] };
}

/** The guide, model and request for painting a building look's texture sheet, or only some of its textures again. */
export async function sheetAsk(
  look: string,
  textures: string[],
  note: string,
  options: ArtStudioOptions,
): Promise<{ name: string; label: string; provider: ImageProvider; request: ImageRequest; guide: SheetGuide }> {
  const sheets = options.sheets;
  const found = sheets?.look(look);
  if (!sheets || !found) throw new ArtRequestError('There is no building look by that name.');
  const provider = options.ai.image('buildings');
  if (!provider) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
  const names = [...new Set(textures)];
  const guide = await sheets.guide(look, names, note).catch((err) => {
    throw new ArtRequestError(plain(err));
  });
  const label = names.length ? `Paint ${names.length === 1 ? `the ${names[0]} texture` : `${names.length} textures`} of the ${found.name.toLowerCase()} sheet again` : `Paint the ${found.name.toLowerCase()} texture sheet`;
  return { name: found.name, label, provider, request: sheets.request(guide), guide };
}

type ReviewHandler<K extends ArtAsk['kind']> = (
  ask: Extract<ArtAsk, { kind: K }>,
  options: ArtStudioOptions,
  catalog: ArtCatalog,
  redoneDir: string,
) => Promise<{ title: string; parts: ArtReview['parts'] }>;

/** Handler registry keyed by ArtAsk['kind']. Add new reviewable art asks here. */
const REVIEW_HANDLERS: { [K in ArtAsk['kind']]: ReviewHandler<K> } = {
  paint: async (ask, options, catalog, redoneDir) => {
    const name = await catalog.nameOf(ask.asset);
    return {
      title: `Paint ${name} again`,
      parts: [{ name, recipe: await previewPaint(ask.asset, ask.note ?? '', options, catalog, redoneDir) }],
    };
  },
  group: async (ask, options, catalog, redoneDir) => {
    const group = await catalog.group(ask.group);
    const parts: ArtReview['parts'] = [];
    for (const item of group.items) parts.push({ name: item.name, recipe: await previewPaint(item.id, '', options, catalog, redoneDir) });
    return {
      title: `Paint all ${group.items.length} pictures of ${group.title} again`,
      parts,
    };
  },
  view: async (ask, options, catalog) => {
    const walker = catalog.walker(ask.walker, 'two-legged');
    const direction = catalog.way(ask.direction);
    return {
      title: `Paint ${walker.name} standing, facing ${facingWords(direction)}`,
      parts: [{ name: walker.name, recipe: await options.walks.previewView(walker, direction, ownPrompt(ask.prompt), await catalog.sourcesFor(walker, direction, ask.from)) }],
    };
  },
  ways: async (ask, options, catalog) => {
    const todo = await catalog.waysToPaint(ask.walker);
    if (!todo.length) throw new ArtRequestError('Every walker already has a standing picture for every isometric way.');
    const title = ask.walker
      ? `Paint ${todo[0]!.name} standing in the four isometric ways, together on one sheet`
      : `Paint the four isometric ways of every walker missing some: ${todo.length} sheet${todo.length > 1 ? 's' : ''}`;
    const parts: ArtReview['parts'] = [];
    for (const walker of todo) parts.push({ name: walker.name, recipe: await options.walks.previewWays(walker) });
    return { title, parts };
  },
  clip: async (ask, options, catalog) => {
    const walker = catalog.walker(ask.walker, ask.body);
    const direction = catalog.way(ask.direction);
    const title = `Make ${walker.name}'s walk clip, walking ${facingWords(direction)}`;
    return {
      title,
      parts: [{ name: walker.name, recipe: await options.walks.previewClip(walker, direction, ownPrompt(ask.prompt)) }],
    };
  },
  normal: async (ask, options, catalog) => {
    const name = await catalog.nameOf(ask.asset);
    return {
      title: `Paint a normal map for ${name}`,
      parts: [{ name, recipe: await previewNormal(ask.asset, ask.prompt, options, catalog) }],
    };
  },
  sheet: async (ask, options) => {
    const { name, label, provider, request } = await sheetAsk(ask.look, ask.textures ?? [], ask.note ?? '', options);
    return {
      title: label,
      parts: [{
        name,
        recipe: {
          at: Date.now(),
          steps: [await options.recipes.imageStep(label, provider, request, estimateImageUsd(provider.model))],
          notes: ['Each texture is checked for free when it comes back; only those that pass are used, and the rest stay as they were.'],
        },
      }],
    };
  },
  sound: async (ask, options) => {
    const sounds = options.sounds;
    const item = (await sounds?.list())?.find((x) => x.id === ask.sound);
    if (!sounds || !item) throw new ArtRequestError('There is no sound by that name.');
    return {
      title: `Make ${item.name} again`,
      parts: [{ name: item.name, recipe: sounds.preview(ask.sound, (ask.note ?? '').trim().slice(0, 1000)) }],
    };
  },
};

/**
 * Exactly what a request would send to the AI models, before anything is
 * painted: the Owner approves this, and the request then names its
 * fingerprint so nothing different is painted.
 */
export async function reviewAsk(
  ask: ArtAsk,
  options: ArtStudioOptions,
  catalog: ArtCatalog,
  redoneDir: string,
): Promise<ArtReview> {
  try {
    const handler = REVIEW_HANDLERS[ask.kind] as ReviewHandler<typeof ask.kind>;
    const { title, parts } = await handler(ask, options, catalog, redoneDir);
    const estimateUsd = parts.reduce((n, p) => n + recipeUsd(p.recipe), 0);
    return { title, parts, estimateUsd, fingerprint: fingerprint(parts) };
  } catch (err) {
    if (err instanceof ArtRequestError) throw err;
    throw new ArtRequestError(plain(err));
  }
}
