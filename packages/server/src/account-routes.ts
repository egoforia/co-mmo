import type { IncomingMessage, ServerResponse } from 'node:http';
import { WishError, isCalling, isRace, startCharacter, validateName, type PlayerInfo } from '@co-mmo/shared';
import { cleanEmail, type Auth } from './auth.ts';
import { json, readJson, type Authenticate } from './http.ts';
import { StoreError, type Account, type Store } from './store.ts';
import type { Updater } from './updates.ts';
import type { Wishes } from './wishes.ts';

// A player's own account over HTTP: invite links, joining, who am I, making
// invites, and the Account window (email, linked logins, your look). Sign-in
// itself lives in auth.ts and God's View in admin.ts.

export interface AccountRoutes {
  store: Store;
  auth: Auth;
  wishes: Wishes;
  /** Where new players start (the Sanctum). */
  homeRegion: () => string;
  /** Public base URL used in invite links. */
  publicUrl: string;
  /** The commit this server runs, so clients can tell it restarted. */
  commit?: string | null;
  updater?: Updater;
  authenticate: Authenticate;
}

/** Answers the account routes; false when the path is not one of them. */
export async function handleAccount(req: IncomingMessage, res: ServerResponse, path: string, ctx: AccountRoutes): Promise<boolean> {
  const { store, auth, wishes } = ctx;
  const method = req.method;

  if (path.startsWith('/api/invites/') && method === 'GET') {
    const invite = store.findInvite(decodeURIComponent(path.slice('/api/invites/'.length)));
    if (!invite || invite.usedBy) return json(res, 404, { valid: false }), true;
    const inviter = invite.createdBy ? store.accountById(invite.createdBy)?.name ?? null : null;
    return json(res, 200, { valid: true, invitedBy: inviter, role: invite.role }), true;
  }

  if (path === '/api/accept' && method === 'POST') {
    const body = await readJson(req);
    const code = typeof body?.code === 'string' ? body.code : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (body?.adult !== true) {
      return json(res, 400, { error: 'adult_required', message: 'co-MMO is for players aged 18 and over.' }), true;
    }
    const nameError = validateName(name);
    if (nameError) return json(res, 400, { error: 'name_invalid', message: nameError }), true;
    // An email and a look are optional; both can be added later from Account.
    const rawEmail = typeof body?.email === 'string' ? body.email.trim() : '';
    const email = rawEmail ? cleanEmail(rawEmail) : '';
    if (rawEmail && !email) return json(res, 400, { error: 'email_invalid', message: 'That does not look like an email address.' }), true;
    if (email && store.accountByEmail(email)) return json(res, 400, { error: 'email_taken', message: 'Another player already signs in with that email.' }), true;
    // Every new Wishbearer is one of the five peoples and takes a Calling (docs/races.md, docs/classes.md).
    if (!isRace(body?.race)) return json(res, 400, { error: 'race_invalid', message: 'Choose which of the five peoples you belong to.' }), true;
    if (!isCalling(body?.calling)) return json(res, 400, { error: 'calling_invalid', message: 'Choose your Calling: how you will fight and help others.' }), true;
    const race = body.race;
    const look = typeof body?.look === 'string' ? body.look.trim() : '';
    let created: ReturnType<Store['acceptInvite']>;
    try {
      created = store.acceptInvite(code, name, ctx.homeRegion(), startCharacter(race, body.calling));
    } catch (err) {
      if (err instanceof StoreError) return json(res, 400, { error: err.code, message: err.message }), true;
      throw err;
    }
    const { account, token } = created;
    const inviter = account.invitedBy ? store.accountById(account.invitedBy)?.name : undefined;
    store.addJournal(`${account.name} joined the world${inviter ? `, invited by ${inviter}` : ''}.`, account.id);
    const notes: string[] = [];
    if (look) {
      try {
        wishes.grantLook(account, look, race);
      } catch (err) {
        if (!(err instanceof WishError)) throw err;
        notes.push(err.message);
      }
    }
    if (email) {
      notes.push(await auth.confirmEmail(account, email, req.socket.remoteAddress ?? '').catch((err: Error) => `We could not send the email: ${err.message}`));
    }
    return json(res, 200, { token, player: publicInfo(account), notes }), true;
  }

  if (path === '/api/version' && method === 'GET') {
    return json(res, 200, { commit: ctx.commit ?? null, updating: ctx.updater?.requested ?? false }), true;
  }

  if (path === '/api/me' && method === 'GET') {
    const account = ctx.authenticate(req);
    if (!account) return json(res, 401, { error: 'unauthorized' }), true;
    if (account.suspended) return json(res, 403, { error: 'suspended', message: suspendedText(account) }), true;
    return json(res, 200, { player: publicInfo(account) }), true;
  }

  if (path === '/api/invites' && method === 'POST') {
    const account = ctx.authenticate(req);
    if (!account) return json(res, 401, { error: 'unauthorized' }), true;
    if (account.suspended) return json(res, 403, { error: 'suspended', message: suspendedText(account) }), true;
    const invite = store.createInvite(account.id);
    return json(res, 200, { code: invite.code, url: inviteUrl(ctx.publicUrl, invite.code) }), true;
  }

  if (path === '/api/account' && method === 'GET') {
    const account = ctx.authenticate(req);
    if (!account) return json(res, 401, { error: 'unauthorized' }), true;
    const look = wishes.lookOf(account.id);
    return json(res, 200, {
      name: account.name,
      email: account.email ?? null,
      logins: (account.logins ?? []).map((l) => l.provider),
      providers: auth.providers(),
      look: look ? { description: look.summary, ...(look.art ? { art: look.art } : {}) } : null,
    }), true;
  }

  if (path === '/api/account/look' && method === 'POST') {
    const account = ctx.authenticate(req);
    if (!account) return json(res, 401, { error: 'unauthorized' }), true;
    if (account.suspended) return json(res, 403, { error: 'suspended', message: suspendedText(account) }), true;
    const body = await readJson(req);
    try {
      wishes.grantLook(account, typeof body?.look === 'string' ? body.look : '', account.character?.race);
    } catch (err) {
      if (err instanceof WishError) return json(res, 400, { error: 'look_invalid', message: err.message }), true;
      throw err;
    }
    return json(res, 200, { message: 'The God has heard how you look. Your picture is being painted.' }), true;
  }

  return false;
}

/** The link that joins the world with an invite code. */
export function inviteUrl(publicUrl: string, code: string): string {
  return `${publicUrl.replace(/\/$/, '')}/?invite=${encodeURIComponent(code)}`;
}

/** What a suspended player is told. */
export function suspendedText(account: Account): string {
  return `Your account is suspended${account.suspended?.reason ? `: ${account.suspended.reason}` : ''}. Talk to the Owner.`;
}

/** What other players may know of an account. */
export function publicInfo(account: Account): PlayerInfo {
  return { id: account.id, name: account.name, color: account.color, role: account.role };
}
