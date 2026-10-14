import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PLAYER_COLORS, hashString, type Character, type ContentEntry, type Role } from '@co-mmo/shared';
import type { ChatTurn, ProviderId } from './ai/chat.ts';

export interface Account {
  id: string;
  name: string;
  role: Role;
  color: number;
  createdAt: number;
  invitedBy: string | null;
  /** SHA-256 of the session token; the token itself is never stored. */
  tokenHash: string;
  regionId: string;
  x: number | null;
  y: number | null;
  /** Missing until the character first plays. */
  character?: Character;
}

export interface Invite {
  code: string;
  createdBy: string | null;
  createdAt: number;
  /** Role granted to whoever accepts. Only the bootstrap invite grants owner. */
  role: Role;
  usedBy: string | null;
}

/** A content log entry plus what only God's View sees. */
export interface ContentRecord extends ContentEntry {
  /** The conversation that led to the wish. */
  conversation: ChatTurn[];
  /** Real money it cost (chat and art), US dollars. */
  usd: number;
}

export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

export interface Settings {
  ai: {
    /** The in-character God conversation, which also compiles wishes. */
    god: ModelChoice;
    /** Used when the God model is down, over budget or refuses (e.g. mature requests). */
    fallback: ModelChoice | null;
    /** Paints wished things; 'none' keeps tinted placeholders. */
    image: { provider: 'gemini' | 'none'; model: string };
  };
  budget: {
    /** Monthly ceiling; above it wishes still work, with placeholder art. */
    monthlyUsd: number;
    /** God's View warns from here. */
    warnUsd: number;
  };
}

export interface SpendRecord {
  at: number;
  usd: number;
  kind: 'chat' | 'image';
  provider: string;
  model: string;
  playerId: string | null;
}

interface Data {
  accounts: Account[];
  invites: Invite[];
  content: ContentRecord[];
  settings: Settings;
  spend: SpendRecord[];
}

export function defaultSettings(env: Record<string, string | undefined> = process.env): Settings {
  const gemini = Boolean(env.GEMINI_API_KEY);
  return {
    ai: {
      god: gemini ? { provider: 'gemini', model: 'gemini-2.5-flash' } : { provider: 'offline', model: 'scripted' },
      fallback: null,
      image: gemini ? { provider: 'gemini', model: 'gemini-2.5-flash-image' } : { provider: 'none', model: '' },
    },
    budget: { monthlyUsd: 70, warnUsd: 50 },
  };
}

/**
 * Persistence for accounts and invites. This JSON-file version keeps local
 * development dependency-free; a Postgres implementation of the same methods
 * replaces it for hosting (see the design doc, Technical architecture).
 */
export class Store {
  private data: Data = { accounts: [], invites: [], content: [], settings: defaultSettings(), spend: [] };
  private saving: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string | null) {}

  /** A store backed by a JSON file, created if missing. */
  static async open(path: string): Promise<Store> {
    const store = new Store(path);
    try {
      store.data = { ...store.data, ...(JSON.parse(await readFile(path, 'utf8')) as Partial<Data>) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return store;
  }

  /** A store that lives only in memory, for tests. */
  static memory(): Store {
    return new Store(null);
  }

  get accountCount(): number {
    return this.data.accounts.length;
  }

  createInvite(createdBy: string | null, role: Role = 'player'): Invite {
    const invite: Invite = {
      code: randomBytes(9).toString('base64url'),
      createdBy,
      createdAt: Date.now(),
      role,
      usedBy: null,
    };
    this.data.invites.push(invite);
    this.persist();
    return invite;
  }

  findInvite(code: string): Invite | undefined {
    return this.data.invites.find((i) => i.code === code);
  }

  /** Unused invite that grants the owner role, if one is waiting. */
  pendingOwnerInvite(): Invite | undefined {
    return this.data.invites.find((i) => i.role === 'owner' && !i.usedBy);
  }

  nameTaken(name: string): boolean {
    const lower = name.toLowerCase();
    return this.data.accounts.some((a) => a.name.toLowerCase() === lower);
  }

  /** Redeems an invite and returns the new account plus its session token. */
  acceptInvite(code: string, name: string, regionId: string): { account: Account; token: string } {
    const invite = this.findInvite(code);
    if (!invite || invite.usedBy) throw new StoreError('invite_invalid', 'This invite is not valid or was already used.');
    if (this.nameTaken(name)) throw new StoreError('name_taken', 'That name is already taken.');
    const token = randomBytes(32).toString('base64url');
    const account: Account = {
      id: randomUUID(),
      name,
      role: invite.role,
      color: PLAYER_COLORS[hashString(name) % PLAYER_COLORS.length],
      createdAt: Date.now(),
      invitedBy: invite.createdBy,
      tokenHash: hashToken(token),
      regionId,
      x: null,
      y: null,
    };
    invite.usedBy = account.id;
    this.data.accounts.push(account);
    this.persist();
    return { account, token };
  }

  accountByToken(token: string): Account | undefined {
    const hash = hashToken(token);
    return this.data.accounts.find((a) => a.tokenHash === hash);
  }

  accountById(id: string): Account | undefined {
    return this.data.accounts.find((a) => a.id === id);
  }

  savePosition(id: string, x: number, y: number, regionId?: string, character?: Character): void {
    const account = this.accountById(id);
    if (!account) return;
    if (regionId) account.regionId = regionId;
    account.x = x;
    account.y = y;
    if (character) account.character = structuredClone(character);
    this.persist();
  }

  get accounts(): readonly Account[] {
    return this.data.accounts;
  }

  setRole(id: string, role: Role): void {
    const account = this.accountById(id);
    if (!account || account.role === 'owner') return;
    account.role = role;
    this.persist();
  }

  /** Favor for a player who is offline (creator rewards). */
  addFavor(id: string, amount: number): void {
    const account = this.accountById(id);
    if (!account?.character) return;
    account.character.favor += amount;
    this.persist();
  }

  // --- Content log -------------------------------------------------------

  get content(): readonly ContentRecord[] {
    return this.data.content;
  }

  contentById(id: string): ContentRecord | undefined {
    return this.data.content.find((c) => c.id === id);
  }

  addContent(record: ContentRecord): void {
    this.data.content.push(record);
    this.persist();
  }

  updateContent(id: string, change: Partial<ContentRecord>): ContentRecord | undefined {
    const record = this.contentById(id);
    if (!record) return undefined;
    Object.assign(record, change);
    this.persist();
    return record;
  }

  // --- Settings and spending -----------------------------------------------

  get settings(): Settings {
    return this.data.settings;
  }

  updateSettings(settings: Settings): void {
    this.data.settings = settings;
    this.persist();
  }

  recordSpend(record: SpendRecord): void {
    if (record.usd <= 0) return;
    this.data.spend.push(record);
    this.persist();
  }

  /** Spending in the calendar month (UTC) containing `now`. */
  spendThisMonth(now: number): SpendRecord[] {
    const d = new Date(now);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    return this.data.spend.filter((s) => s.at >= start && s.at <= now);
  }

  /** Resolves once every pending write has reached disk. */
  flush(): Promise<void> {
    return this.saving;
  }

  private persist(): void {
    if (!this.path) return;
    const path = this.path;
    // Writes are chained so they never interleave, and go through a temp
    // file so a crash mid-write cannot corrupt the store.
    this.saving = this.saving.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2));
      await rename(tmp, path);
    });
  }
}

export class StoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
