// Signing in beyond the first invite (design doc, Access and roles): a
// magic link by email, or a linked Google or GitHub account. Invite links
// still create every account; these only let a player back in, on any
// device. Sign-in links and provider callbacks hand the browser a one-time
// code, never a session token, so tokens stay out of URLs and logs.

import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StoreError, type Account, type LoginProvider, type Store } from './store.ts';

/** How long a sign-in or confirm link works. */
export const LINK_MS = 15 * 60_000;
/** How long the trip to Google or GitHub and back may take. */
const STATE_MS = 10 * 60_000;
/** Sign-in emails per address, and per connection, in a window. */
const EMAILS_PER_ADDRESS = 3;
const EMAILS_PER_CLIENT = 10;
const EMAIL_WINDOW_MS = 15 * 60_000;

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Sends email. Tests pass a fake that keeps what it was given. */
export interface Mailer {
  /** 'email' when real email goes out; 'log' when links are printed for local play. */
  readonly kind: 'email' | 'log';
  send(mail: Mail): Promise<void>;
}

export interface AuthOptions {
  store: Store;
  publicUrl: string;
  env: Record<string, string | undefined>;
  /** Overrides how email is sent (tests). */
  mailer?: Mailer;
  /** Overrides HTTP calls to Google, GitHub and the email service (tests). */
  fetch?: typeof fetch;
  now?: () => number;
}

interface Pending {
  purpose: 'login' | 'confirm';
  accountId: string;
  /** For confirming: the address being confirmed. */
  email?: string;
  expires: number;
}

interface OAuthState {
  provider: LoginProvider;
  /** Sign in, or link the provider to an account already signed in. */
  mode: 'login' | 'link';
  accountId?: string;
  expires: number;
}

type Json = (res: ServerResponse, status: number, body: unknown) => void;
type ReadJson = (req: IncomingMessage) => Promise<Record<string, unknown> | null>;

const PROVIDER_NAME: Record<LoginProvider, string> = { google: 'Google', github: 'GitHub' };

/** Sign-in by email link and by Google or GitHub. */
export class Auth {
  private readonly pending = new Map<string, Pending>();
  private readonly states = new Map<string, OAuthState>();
  private readonly sent = new Map<string, number[]>();
  readonly mailer: Mailer;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: AuthOptions) {
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.mailer = options.mailer ?? createMailer(options.env, this.fetch);
  }

  /** Which sign-in buttons to show: email always works; Google and GitHub once set up. */
  providers(): { email: 'email' | 'log'; google: boolean; github: boolean } {
    const env = this.options.env;
    return {
      email: this.mailer.kind,
      google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    };
  }

  /**
   * Sends a link that confirms an email address for this account and signs
   * in. Returns a message for the player, or throws a StoreError.
   */
  async confirmEmail(account: Account, raw: string, client = ''): Promise<string> {
    const email = cleanEmail(raw);
    if (!email) throw new StoreError('email_invalid', 'That does not look like an email address.');
    const other = this.options.store.accountByEmail(email);
    if (other && other.id !== account.id) throw new StoreError('email_taken', 'Another player already signs in with that email.');
    if (!this.allowSend(email, client)) throw new StoreError('email_rate', 'Too many emails asked for. Try again in a few minutes.');
    const link = this.link({ purpose: 'confirm', accountId: account.id, email });
    await this.mailer.send({
      to: email,
      subject: 'Confirm your email for co-MMO',
      text: `Hello ${account.name},\n\nOpen this link to confirm your email. After that you can sign in to co-MMO with it from any device:\n\n${link}\n\nThe link works once, for the next 15 minutes. If you did not ask for this, you can ignore this email.`,
    });
    return `We sent a link to ${email}. Open it to confirm your email.`;
  }

  /** Emails a sign-in link if a player uses this address. Says the same either way. */
  async emailSignIn(raw: string, client = ''): Promise<string> {
    const email = cleanEmail(raw);
    if (!email) throw new StoreError('email_invalid', 'That does not look like an email address.');
    const said = `If a player signs in with ${email}, a sign-in link is on its way. It works for 15 minutes.`;
    const account = this.options.store.accountByEmail(email);
    if (!account || !this.allowSend(email, client)) return said;
    const link = this.link({ purpose: 'login', accountId: account.id });
    await this.mailer.send({
      to: email,
      subject: 'Your co-MMO sign-in link',
      text: `Hello ${account.name},\n\nOpen this link to sign in to co-MMO:\n\n${link}\n\nThe link works once, for the next 15 minutes. If you did not ask for it, you can ignore this email.`,
    });
    return said;
  }

  /** Trades a one-time code from a link for a session token. */
  redeem(code: string): { account: Account; token: string } {
    const key = hash(code);
    const pending = this.pending.get(key);
    this.pending.delete(key);
    if (!pending || pending.expires < this.now()) {
      throw new StoreError('link_invalid', 'This sign-in link has run out or was already used. Ask for a new one.');
    }
    const { store } = this.options;
    const account = store.accountById(pending.accountId);
    if (!account) throw new StoreError('link_invalid', 'That player no longer exists.');
    if (account.suspended) throw new StoreError('suspended', `Your account is suspended${account.suspended.reason ? `: ${account.suspended.reason}` : ''}. Talk to the Owner.`);
    if (pending.purpose === 'confirm' && pending.email) store.setEmail(account.id, pending.email);
    return { account, token: store.issueSession(account.id) };
  }

  /** Where to send the browser to sign in with a provider, or undefined if it is not set up. */
  startUrl(provider: LoginProvider, mode: 'login' | 'link', accountId?: string): string | undefined {
    if (!this.providers()[provider]) return undefined;
    const state = randomBytes(18).toString('base64url');
    this.sweep();
    this.states.set(state, { provider, mode, ...(accountId ? { accountId } : {}), expires: this.now() + STATE_MS });
    const env = this.options.env;
    const redirect = this.callbackUrl(provider);
    if (provider === 'google') {
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirect, response_type: 'code', scope: 'openid email', state, prompt: 'select_account',
      })}`;
    }
    return `https://github.com/login/oauth/authorize?${new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID!, redirect_uri: redirect, scope: 'read:user user:email', state, allow_signup: 'false',
    })}`;
  }

  /**
   * The provider sent the browser back. Returns where to send it next: into
   * the game with a one-time code, or to the sign-in page with a message.
   */
  async callback(provider: LoginProvider, code: string, stateKey: string): Promise<string> {
    const state = this.states.get(stateKey);
    this.states.delete(stateKey);
    if (!state || state.provider !== provider || state.expires < this.now() || !code) {
      return this.page({ signin_error: 'That sign-in took too long or was interrupted. Please try again.' });
    }
    let profile: Profile;
    try {
      profile = await this.profile(provider, code);
    } catch (err) {
      console.error(`${PROVIDER_NAME[provider]} sign-in failed:`, (err as Error).message);
      return this.page({ signin_error: `${PROVIDER_NAME[provider]} did not let us in just now. Please try again.` });
    }
    const { store } = this.options;
    const name = PROVIDER_NAME[provider];
    if (state.mode === 'link') {
      const account = state.accountId ? store.accountById(state.accountId) : undefined;
      if (!account) return this.page({ signin_error: 'Sign in again, then link your account.' });
      try {
        store.linkLogin(account.id, provider, profile.subject);
      } catch (err) {
        if (err instanceof StoreError) return this.page({ signin_error: err.message });
        throw err;
      }
      if (!account.email && profile.email && !store.accountByEmail(profile.email)) store.setEmail(account.id, profile.email);
      return this.page({ linked: provider });
    }
    let account = store.accountByLogin(provider, profile.subject);
    // A confirmed email the provider also vouches for links the two.
    if (!account && profile.email) {
      account = store.accountByEmail(profile.email);
      if (account) store.linkLogin(account.id, provider, profile.subject);
    }
    if (!account) {
      return this.page({ signin_error: `No player uses this ${name} account yet. Join with a friend's invite link first, then link ${name} from Account in the game.` });
    }
    return this.page({ login: this.code({ purpose: 'login', accountId: account.id }) });
  }

  /** Handles the sign-in routes; false when the path is not one of them. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, json: Json, readJson: ReadJson, account: Account | undefined): Promise<boolean> {
    const path = url.pathname;
    const client = req.socket.remoteAddress ?? '';
    if (path === '/api/auth/options' && req.method === 'GET') {
      json(res, 200, this.providers());
      return true;
    }
    if (path === '/api/auth/email' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        json(res, 200, { message: await this.emailSignIn(String(body?.email ?? ''), client) });
      } catch (err) {
        if (!(err instanceof StoreError)) throw err;
        json(res, 400, { error: err.code, message: err.message });
      }
      return true;
    }
    if (path === '/api/auth/redeem' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        const { account: signedIn, token } = this.redeem(String(body?.code ?? ''));
        json(res, 200, { token, name: signedIn.name });
      } catch (err) {
        if (!(err instanceof StoreError)) throw err;
        json(res, err.code === 'suspended' ? 403 : 400, { error: err.code, message: err.message });
      }
      return true;
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      const header = req.headers.authorization ?? '';
      if (header.startsWith('Bearer ')) this.options.store.endSession(header.slice(7));
      json(res, 200, { ok: true });
      return true;
    }
    if (path === '/api/account/email' && req.method === 'POST') {
      if (!account) {
        json(res, 401, { error: 'unauthorized', message: 'Please sign in again.' });
        return true;
      }
      const body = await readJson(req);
      try {
        json(res, 200, { message: await this.confirmEmail(account, String(body?.email ?? ''), client) });
      } catch (err) {
        if (!(err instanceof StoreError)) throw err;
        json(res, 400, { error: err.code, message: err.message });
      }
      return true;
    }
    const start = path.match(/^\/api\/auth\/(google|github)\/(start|link)$/);
    if (start) {
      const provider = start[1] as LoginProvider;
      if (start[2] === 'link') {
        // Linking needs the session token, which a plain redirect cannot carry:
        // the game asks for the address with it, then sends the browser there.
        if (req.method !== 'POST') return false;
        if (!account) {
          json(res, 401, { error: 'unauthorized', message: 'Please sign in again.' });
          return true;
        }
        const target = this.startUrl(provider, 'link', account.id);
        if (!target) json(res, 400, { error: 'not_set_up', message: `${PROVIDER_NAME[provider]} sign-in is not set up yet. The Owner can turn it on.` });
        else json(res, 200, { url: target });
        return true;
      }
      if (req.method !== 'GET') return false;
      const target = this.startUrl(provider, 'login');
      redirect(res, target ?? this.page({ signin_error: `${PROVIDER_NAME[provider]} sign-in is not set up yet.` }));
      return true;
    }
    const back = path.match(/^\/api\/auth\/(google|github)\/callback$/);
    if (back && req.method === 'GET') {
      const provider = back[1] as LoginProvider;
      if (url.searchParams.get('error')) {
        redirect(res, this.page({ signin_error: `${PROVIDER_NAME[provider]} sign-in was cancelled.` }));
        return true;
      }
      redirect(res, await this.callback(provider, url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? ''));
      return true;
    }
    return false;
  }

  // --- Plumbing --------------------------------------------------------------

  private callbackUrl(provider: LoginProvider): string {
    return `${this.options.publicUrl.replace(/\/$/, '')}/api/auth/${provider}/callback`;
  }

  private page(params: Record<string, string>): string {
    return `${this.options.publicUrl.replace(/\/$/, '')}/?${new URLSearchParams(params)}`;
  }

  private code(pending: Omit<Pending, 'expires'>): string {
    this.sweep();
    const code = randomBytes(24).toString('base64url');
    this.pending.set(hash(code), { ...pending, expires: this.now() + LINK_MS });
    return code;
  }

  private link(pending: Omit<Pending, 'expires'>): string {
    return this.page({ login: this.code(pending) });
  }

  private allowSend(email: string, client: string): boolean {
    const now = this.now();
    const recent = (key: string) => (this.sent.get(key) ?? []).filter((t) => now - t < EMAIL_WINDOW_MS);
    const byEmail = recent(`e:${email}`);
    const byClient = recent(`c:${client}`);
    if (byEmail.length >= EMAILS_PER_ADDRESS || byClient.length >= EMAILS_PER_CLIENT) return false;
    this.sent.set(`e:${email}`, [...byEmail, now]);
    this.sent.set(`c:${client}`, [...byClient, now]);
    return true;
  }

  /** Forgets codes and states that ran out. */
  private sweep(): void {
    const now = this.now();
    for (const [k, p] of this.pending) if (p.expires < now) this.pending.delete(k);
    for (const [k, s] of this.states) if (s.expires < now) this.states.delete(k);
  }

  /** Trades the provider's code for who the player is there. */
  private async profile(provider: LoginProvider, code: string): Promise<Profile> {
    const env = this.options.env;
    const redirect = this.callbackUrl(provider);
    if (provider === 'google') {
      const token = await this.post('https://oauth2.googleapis.com/token', {
        code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirect, grant_type: 'authorization_code',
      });
      const me = await this.get('https://openidconnect.googleapis.com/v1/userinfo', token);
      if (!me.sub) throw new Error('Google sent no account id.');
      return { subject: String(me.sub), ...(me.email && me.email_verified ? { email: String(me.email).toLowerCase() } : {}) };
    }
    const token = await this.post('https://github.com/login/oauth/access_token', {
      code, client_id: env.GITHUB_CLIENT_ID!, client_secret: env.GITHUB_CLIENT_SECRET!, redirect_uri: redirect,
    });
    const me = await this.get('https://api.github.com/user', token);
    if (!me.id) throw new Error('GitHub sent no account id.');
    const emails = await this.get('https://api.github.com/user/emails', token).catch(() => []) as unknown;
    const primary = Array.isArray(emails) ? emails.find((e) => e?.primary && e?.verified) : undefined;
    return { subject: String(me.id), ...(primary?.email ? { email: String(primary.email).toLowerCase() } : {}) };
  }

  private async post(url: string, form: Record<string, string>): Promise<string> {
    const res = await this.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.access_token !== 'string') throw new Error(`token exchange failed (${res.status}${body.error ? `, ${String(body.error)}` : ''})`);
    return body.access_token;
  }

  private async get(url: string, token: string): Promise<Record<string, any>> {
    const res = await this.fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'co-mmo' } });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return (await res.json()) as Record<string, any>;
  }
}

interface Profile {
  subject: string;
  /** Only an address the provider says is verified. */
  email?: string;
}

/**
 * Real email through Resend's HTTP API when RESEND_API_KEY and MAIL_FROM are
 * set; otherwise the link is printed in the server's console, which is
 * enough for playing on your own machine.
 */
export function createMailer(env: Record<string, string | undefined>, fetcher: typeof fetch = fetch): Mailer {
  const key = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  if (key && from) {
    return {
      kind: 'email',
      async send(mail) {
        const res = await fetcher('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
        });
        if (!res.ok) throw new Error(`The email service answered ${res.status}.`);
      },
    };
  }
  return {
    kind: 'log',
    async send(mail) {
      console.log(`\n[email not set up] To ${mail.to}: ${mail.subject}\n${mail.text}\n`);
    },
  };
}

/** A lower-cased address, or '' if it does not look like one. */
export function cleanEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function hash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}
