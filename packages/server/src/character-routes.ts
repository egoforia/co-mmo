import type { IncomingMessage, ServerResponse } from 'node:http';
import { CALLINGS, RACES, WishError, isCalling, isRace, startCharacter, validateName, type CallingId, type RaceId } from '@co-mmo/shared';
import { suspendedText } from './account-routes.ts';
import { json, readJson, type Authenticate } from './http.ts';
import { maxCharacters } from './settings.ts';
import { StoreError, type Account, type Store } from './store.ts';
import type { Wishes } from './wishes.ts';
import type { World } from './world.ts';

// The characters on a player's account over HTTP (docs/characters.md): the
// list the character screen shows, making a new one, choosing which to play
// and deleting one. The store keeps them (store-roster.ts); the game socket
// puts the chosen one in the world.

export interface CharacterRoutes {
  store: Store;
  wishes: Wishes;
  world: World;
  /** Where new characters start (the Sanctum). */
  homeRegion: () => string;
  authenticate: Authenticate;
}

/** One character as the character screen shows it. */
export interface CharacterCard {
  id: string;
  name: string;
  level: number;
  race: string | null;
  calling: string | null;
  /** The land they stand in. */
  region: string | null;
  /** In the world right now, perhaps in another window. */
  online: boolean;
  lastSeen: number | null;
  /** Their painted look, once there is one. */
  art: string | null;
}

/** Answers the character routes; false when the path is not one of them. */
export async function handleCharacters(req: IncomingMessage, res: ServerResponse, path: string, ctx: CharacterRoutes): Promise<boolean> {
  if (path !== '/api/characters' && !path.startsWith('/api/characters/')) return false;
  const { store, wishes, world } = ctx;
  const signedIn = ctx.authenticate(req);
  if (!signedIn) return json(res, 401, { error: 'unauthorized', message: 'Please sign in again.' }), true;
  const main = store.mainOf(signedIn);
  if (main.suspended) return json(res, 403, { error: 'suspended', message: suspendedText(main) }), true;
  const method = req.method;
  const max = maxCharacters(store.settings);

  if (path === '/api/characters' && method === 'GET') {
    const regions = new Map(world.defs().map((d) => [d.id, d.name]));
    const card = (a: Account): CharacterCard => {
      const c = a.character;
      const look = wishes.lookOf(a.id);
      return {
        id: a.id,
        name: a.name,
        level: c?.level ?? 1,
        race: c?.race ? RACES[c.race as RaceId]?.name ?? null : null,
        calling: c?.calling ? CALLINGS[c.calling as CallingId]?.name ?? null : null,
        region: world.regionOf(a.id)?.def.name ?? regions.get(a.regionId) ?? null,
        online: world.has(a.id),
        lastSeen: a.lastSeen ?? null,
        art: look?.art ?? null,
      };
    };
    return json(res, 200, { characters: store.charactersOf(main).map(card), playing: store.playingOf(main).id, max }), true;
  }

  if (path === '/api/characters' && method === 'POST') {
    const body = await readJson(req);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const nameError = validateName(name);
    if (nameError) return json(res, 400, { error: 'name_invalid', message: nameError }), true;
    if (!isRace(body?.race)) return json(res, 400, { error: 'race_invalid', message: 'Choose which of the five peoples you belong to.' }), true;
    if (!isCalling(body?.calling)) return json(res, 400, { error: 'calling_invalid', message: 'Choose your Calling: how you will fight and help others.' }), true;
    let made: Account;
    try {
      made = store.addCharacter(main, name, ctx.homeRegion(), startCharacter(body.race, body.calling), max);
    } catch (err) {
      if (err instanceof StoreError) return json(res, 400, { error: err.code, message: err.message }), true;
      throw err;
    }
    store.choose(main, made.id);
    store.addJournal(`${made.name} joined the world.`, made.id);
    const notes: string[] = [];
    const look = typeof body?.look === 'string' ? body.look.trim() : '';
    if (look) {
      try {
        wishes.grantLook(made, look, body.race);
      } catch (err) {
        if (!(err instanceof WishError)) throw err;
        notes.push(err.message);
      }
    }
    return json(res, 200, { id: made.id, notes }), true;
  }

  const one = path.match(/^\/api\/characters\/([\w-]+)(\/play)?$/);
  const target = one ? store.charactersOf(main).find((a) => a.id === one[1]) : undefined;
  if (!one) return json(res, 404, { error: 'not_found' }), true;
  if (!target) return json(res, 404, { error: 'not_found', message: 'That character is not on your account.' }), true;

  if (one[2] && method === 'POST') {
    store.choose(main, target.id);
    return json(res, 200, { ok: true }), true;
  }

  if (!one[2] && method === 'DELETE') {
    const body = await readJson(req);
    const typed = typeof body?.name === 'string' ? body.name.trim().toLowerCase() : '';
    if (typed !== target.name.toLowerCase()) return json(res, 400, { error: 'confirm', message: `Type ${target.name} to delete this character.` }), true;
    if (world.has(target.id)) return json(res, 409, { error: 'online', message: `${target.name} is still in the world. Try again in a moment, or close the window they play in.` }), true;
    try {
      store.deleteCharacter(main, target.id);
    } catch (err) {
      if (err instanceof StoreError) return json(res, 400, { error: err.code, message: err.message }), true;
      throw err;
    }
    return json(res, 200, { ok: true }), true;
  }

  return json(res, 404, { error: 'not_found' }), true;
}
