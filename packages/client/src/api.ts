import type { PerfView, PlayerInfo, WorldEdit, WorldEditDraft, buildingKit } from '@co-mmo/shared';

const TOKEN_KEY = 'co-mmo.token';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode: the session lasts until the tab closes.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    // Whoever signs in next chooses their own character.
    sessionStorage.removeItem('co-mmo.chosen');
  } catch {
    // Nothing stored.
  }
}

export interface InviteCheck {
  valid: boolean;
  invitedBy?: string | null;
  role?: string;
}

export async function checkInvite(code: string): Promise<InviteCheck> {
  const res = await fetch(`/api/invites/${encodeURIComponent(code)}`);
  return (await res.json()) as InviteCheck;
}

export interface Joining {
  name: string;
  adult: boolean;
  /** Optional: an email to sign in with later. */
  email?: string;
  /** Optional: how the player looks, in their own words. */
  look?: string;
  /** Their people and Calling ids; the server checks them. */
  race: string;
  calling: string;
}

/** Accepts an invite; `notes` are things to tell the player (an email was sent). */
export async function acceptInvite(code: string, joining: Joining): Promise<{ token: string; player: PlayerInfo; notes?: string[] }> {
  const res = await fetch('/api/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, ...joining }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Could not accept the invite.');
  return body;
}

/** Which ways to sign in this world offers. */
export interface SignInOptions {
  /** 'log' when no email service is set up and links go to the server console. */
  email: 'email' | 'log';
  google: boolean;
  github: boolean;
}

export async function signInOptions(): Promise<SignInOptions> {
  const res = await fetch('/api/auth/options');
  return res.ok ? ((await res.json()) as SignInOptions) : { email: 'log', google: false, github: false };
}

/** Asks for a sign-in link by email; resolves with what to tell the player. */
export async function emailSignIn(email: string): Promise<string> {
  return post('/api/auth/email', { email });
}

/** Trades the one-time code from a sign-in link for a session token. */
export async function redeemLogin(code: string): Promise<string> {
  const res = await fetch('/api/auth/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'That sign-in link did not work. Ask for a new one.');
  return body.token as string;
}

/** The kit houses of a land's buildings, for the isometric camera; none when the server will not say. */
export async function kitHouses(token: string, region: string): Promise<buildingKit.KitHouseInfo[]> {
  const res = await fetch(`/api/kit-houses?region=${encodeURIComponent(region)}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
  if (!res?.ok) return [];
  return ((await res.json()) as { houses: buildingKit.KitHouseInfo[] }).houses;
}

/** A land's edits (newest last) and how many were taken back and can be made again. */
export interface EditLog {
  edits: WorldEdit[];
  undone: number;
  /** Edits that no longer fit the land and were passed over, by id. */
  unlaid?: string[];
}

/**
 * The world editor (Owner and Stewards): reads a land's edits, or makes a
 * change (`edit`, or `edits` made together; drafts unless `live`), `undo`, `redo` or `remove` one, or `publish` or `discard` the drafts. Throws with the server's
 * words when it cannot be done.
 */
export async function worldEdits(token: string, region: string, action?: { edit: WorldEditDraft; live?: boolean } | { edits: WorldEditDraft[]; live?: boolean } | { undo: true } | { redo: true } | { remove: string } | { publish: true } | { discard: true }): Promise<EditLog> {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const path = !action || 'edit' in action || 'edits' in action ? '' : `/${Object.keys(action)[0]}`;
  const body = !action ? undefined : 'remove' in action ? { region, id: action.remove } : 'edit' in action || 'edits' in action ? { region, ...action } : { region };
  const res = !action
    ? await fetch(`/api/world-edits?region=${encodeURIComponent(region)}`, { headers })
    : await fetch(`/api/world-edits${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(answer.message ?? 'The editor could not reach the server. Try again.');
  return answer as EditLog;
}

/** How the server running your part of the world keeps up, for the performance overlay (Stewards and the Owner). */
export async function perfStats(token: string): Promise<PerfView | undefined> {
  const res = await fetch('/api/admin/perf', { headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
  return res?.ok ? ((await res.json()) as PerfView) : undefined;
}

export async function signOut(token: string): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
  clearToken();
}

export interface AccountInfo {
  name: string;
  email: string | null;
  logins: ('google' | 'github')[];
  providers: SignInOptions;
  look: { description: string; art?: string } | null;
  /** How many characters are on the account. */
  characters?: number;
}

export async function accountInfo(token: string): Promise<AccountInfo> {
  const res = await fetch('/api/account', { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Could not load your account.');
  return (await res.json()) as AccountInfo;
}

/** Sends a confirm link to a new sign-in email. */
export async function setEmail(token: string, email: string): Promise<string> {
  return post('/api/account/email', { email }, token);
}

/** Describes your look: your first, free wish. */
export async function describeLook(token: string, look: string): Promise<string> {
  return post('/api/account/look', { look }, token);
}

/** Where to go to link Google or GitHub to this account. */
export async function linkUrl(token: string, provider: 'google' | 'github'): Promise<string> {
  const res = await fetch(`/api/auth/${provider}/link`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Could not link that account.');
  return body.url as string;
}

/** One of your characters, as the character screen shows it. */
export interface CharacterCard {
  id: string;
  name: string;
  level: number;
  race: string | null;
  calling: string | null;
  region: string | null;
  online: boolean;
  lastSeen: number | null;
  art: string | null;
}

/** Your characters, the one played last, and how many you may have. */
export interface Roster {
  characters: CharacterCard[];
  playing: string;
  max: number;
}

/** Calls a character route; throws a sentence for the player when it fails. */
async function characters<T>(token: string, path = '', method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/characters${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(answer.message ?? 'Something went wrong. Try again.'), { status: res.status });
  return answer as T;
}

/** The characters on your account. */
export function listCharacters(token: string): Promise<Roster> {
  return characters<Roster>(token);
}

/** Makes a new character, who is played next; `notes` are things to tell the player. */
export function createCharacter(token: string, joining: Omit<Joining, 'adult' | 'email'>): Promise<{ id: string; notes: string[] }> {
  return characters(token, '', 'POST', joining);
}

/** Chooses which character enters the world next. */
export async function chooseCharacter(token: string, id: string): Promise<void> {
  await characters(token, `/${encodeURIComponent(id)}/play`, 'POST');
}

/** Deletes a character for good; `name` is what the player typed to confirm. */
export async function deleteCharacter(token: string, id: string, name: string): Promise<void> {
  await characters(token, `/${encodeURIComponent(id)}`, 'DELETE', { name });
}

async function post(path: string, body: unknown, token?: string): Promise<string> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(answer.message ?? 'Something went wrong. Try again.');
  return answer.message as string;
}

export async function createInvite(token: string): Promise<string> {
  const res = await fetch('/api/invites', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Could not create an invite.');
  return body.url as string;
}

/**
 * After an update: waits until the server is back (on a new commit, or after
 * it was down), then reloads the page so it runs the new code too.
 */
export async function reloadWhenBack(from: string | null = null): Promise<void> {
  const version = async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      return res.ok ? ((await res.json()) as { commit: string | null; updating: boolean }) : null;
    } catch {
      return null;
    }
  };
  const start = (await version()) ?? null;
  const before = from ?? start?.commit ?? null;
  let wentDown = start === null;
  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const now = await version();
    if (!now) wentDown = true;
    else if (now.commit !== before || (wentDown && !now.updating) || Date.now() > deadline) break;
  }
  location.reload();
}

/** After a dropped connection: waits until the server answers, then reloads to rejoin. */
export async function rejoinWhenBack(): Promise<void> {
  for (let delay = 1000; ; delay = Math.min(delay * 1.5, 10_000)) {
    await new Promise((r) => setTimeout(r, delay));
    const up = await fetch('/api/version', { cache: 'no-store' }).then((r) => r.ok, () => false);
    if (up) return location.reload();
  }
}
