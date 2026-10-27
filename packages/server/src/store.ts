import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PLAYER_COLORS, gainCreatorXp, hashString, upgradeCharacter, type BuildTrack, type Character, type ContentEntry, type Role, type WishDraft, type WorldEdit } from '@co-mmo/shared';
import type { ChatTurn } from './ai/chat.ts';
import { defaultSettings, type Settings } from './settings.ts';
import type { RuleTestReport } from './rule-test.ts';
import type { Sql } from './db.ts';
import { PostgresTables, migrate, type Row } from './store-postgres.ts';

/** Days a Workshop draft is kept after its last change. */
const DRAFT_DAYS = 7;

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
  /** The floor they were on (floors.ts), when not the ground. */
  floor?: number;
  /** Missing until the character first plays. */
  character?: Character;
  /** Set while a Steward or the Owner has suspended the account. */
  suspended?: { by: string; at: number; reason: string };
  /** A confirmed email address: magic sign-in links go here. */
  email?: string;
  /** Google or GitHub accounts linked for signing in. */
  logins?: { provider: LoginProvider; subject: string }[];
  /** SHA-256 of tokens for other devices and browsers signed in later. */
  sessions?: string[];
  /** When the player was last in the world, for the "While you were away" feed. */
  lastSeen?: number;
}

export type LoginProvider = 'google' | 'github';

/** Devices one account may stay signed in on; the oldest is signed out first. */
const MAX_SESSIONS = 10;
/** Lines kept for the "While you were away" feed. */
const MAX_JOURNAL = 500;

/** A notable thing that happened, for players who were away. */
export interface JournalEntry {
  at: number;
  text: string;
  /** Who it is about; they are not told about their own doings. */
  playerId: string | null;
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
  /** A wish shaped in the Wish Workshop: its subcategory and, for wishes people build, its brief ("Label: answer" lines). */
  shaped?: { category: string; brief?: string[] };
  /** Real money it cost (chat and art), US dollars. */
  usd: number;
  /** For Major wishes: the God drafting a scripted rule for it. */
  draft?: { state: 'drafting' | 'ready' | 'failed' | 'impossible'; at: number; message?: string; model?: string; note?: string };
  /** The automated test run of the drafted rule. */
  test?: RuleTestReport;
  /** A live rule a Steward paused, or that paused itself. */
  rule?: { paused: boolean; reason?: string };
  /** An Engine wish being built as a code change by a coding agent. */
  build?: BuildTrack;
  /** What was asked of the image model for each picture painted, by picture id (latest painting). */
  artPrompts?: Record<string, ArtPromptRecord>;
}

/** One picture's request to the image model, kept so Stewards can see exactly what was sent. */
export interface ArtPromptRecord {
  prompt: string;
  /** Anchor ids sent as style references (the ones that were found). */
  references: string[];
  /** Text the provider sends between the references and the prompt, when it adds any. */
  note?: string;
  provider: string;
  model: string;
  at: number;
  usd: number;
  /** What the style check made of it, and how many paintings it took. */
  check?: { pass: boolean; why?: string; tries: number };
  /** An existing picture shown instead of painting a new one. */
  reused?: { from: string; name: string };
}

/** A player telling the Stewards about a wished thing or another player. */
export interface Report {
  id: string;
  at: number;
  reporter: { id: string; name: string };
  kind: 'content' | 'player';
  target: { id: string; name: string };
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  /** Who closed it, how, and when. */
  closed?: { by: string; at: number; action: string };
}

export interface SpendRecord {
  at: number;
  usd: number;
  kind: 'chat' | 'image' | 'video' | 'sound' | 'build';
  provider: string;
  model: string;
  playerId: string | null;
  /** Identifies one charge (a build run), so a report read twice is counted once. */
  ref?: string;
  /** A guess waiting for the real figure (a build before its run reports its cost). */
  estimate?: boolean;
  /** A picture painted as a Wish Workshop sample. */
  sample?: boolean;
}

interface Data {
  accounts: Account[];
  invites: Invite[];
  content: ContentRecord[];
  settings: Settings;
  spend: SpendRecord[];
  reports: Report[];
  /** Scripted rules' saved state: rule id → player id (or "_" for shared) → values. */
  ruleData: Record<string, Record<string, Record<string, unknown>>>;
  journal: JournalEntry[];
  /** Wish Workshop drafts, by player id (missing in older saves). */
  drafts?: Record<string, WishDraft>;
  /** The world editor's changes to each land, by region id (missing in older saves). */
  worldEdits?: Record<string, WorldEditLog>;
}

/** A land's edits in the order they are laid, and those taken back, newest last, for redo. */
export interface WorldEditLog {
  edits: WorldEdit[];
  undone: WorldEdit[];
}

/**
 * Where the store keeps the world between runs: Postgres when DATABASE_URL
 * is set (design doc, Technical architecture), else one JSON file, so local
 * development needs nothing installed.
 */
export interface StoreBackend {
  /** What was saved before, or nothing on a first run. */
  load(): Promise<Partial<Data> | null>;
  /** Saves the whole store; a backend may write only what changed. */
  save(data: Data): Promise<void>;
  close(): Promise<void>;
  /** Shown in the console at start-up: where the world is kept. */
  readonly label: string;
}

/**
 * The saved world: accounts, invites, wishes, reports, spending, the journal
 * and settings. Everything is kept in memory and written behind, so the game
 * never waits on a disk or a database; one game server owns the store.
 */
export class Store {
  private data: Data = { accounts: [], invites: [], content: [], settings: defaultSettings(), spend: [], reports: [], ruleData: {}, journal: [] };
  private saving: Promise<void> = Promise.resolve();
  /** A save is waiting its turn; later changes ride along with it. */
  private queued = false;

  private constructor(private readonly backend: StoreBackend | null) {}

  /** A store backed by a JSON file, created if missing. */
  static async open(path: string): Promise<Store> {
    return Store.withBackend(new FileBackend(path));
  }

  /**
   * A store kept in Postgres. On its first run, while the database is still
   * empty, the world in `importFrom` (the old JSON file) is brought in.
   */
  static async postgres(sql: Sql, importFrom?: string): Promise<Store> {
    const backend = await PostgresBackend.open(sql);
    const store = await Store.withBackend(backend);
    if (importFrom && backend.wasEmpty) {
      const old = await new FileBackend(importFrom).load();
      if (old) {
        store.data = { ...store.data, ...old };
        await backend.save(store.data);
        console.log(`Brought the world in ${importFrom} (${plural(store.data.accounts.length, 'player')}, ${plural(store.data.content.length, 'wish', 'wishes')}) into Postgres. The file is left as it was.`);
      }
    }
    return store;
  }

  private static async withBackend(backend: StoreBackend): Promise<Store> {
    const store = new Store(backend);
    const saved = await backend.load();
    if (saved) store.data = { ...store.data, ...saved };
    return store;
  }

  /** A store that lives only in memory, for tests. */
  static memory(): Store {
    return new Store(null);
  }

  /** Where the world is kept, for the start-up message. */
  get label(): string {
    return this.backend?.label ?? 'memory only';
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

  /** Redeems an invite and returns the new account plus its session token; `character` is the one made at sign-up. */
  acceptInvite(code: string, name: string, regionId: string, character?: Character): { account: Account; token: string } {
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
      ...(character ? { character: structuredClone(character) } : {}),
    };
    invite.usedBy = account.id;
    this.data.accounts.push(account);
    this.persist();
    return { account, token };
  }

  accountByToken(token: string): Account | undefined {
    const hash = hashToken(token);
    return this.data.accounts.find((a) => a.tokenHash === hash || a.sessions?.includes(hash));
  }

  /** Signs an account in on another device; returns the new session token. */
  issueSession(id: string): string {
    const account = this.accountById(id);
    if (!account) throw new StoreError('no_account', 'That player no longer exists.');
    const token = randomBytes(32).toString('base64url');
    account.sessions = [...(account.sessions ?? []), hashToken(token)].slice(-MAX_SESSIONS);
    this.persist();
    return token;
  }

  /** Signs this one device out. */
  endSession(token: string): void {
    const hash = hashToken(token);
    for (const a of this.data.accounts) {
      if (a.tokenHash === hash) a.tokenHash = '';
      if (a.sessions?.includes(hash)) a.sessions = a.sessions.filter((s) => s !== hash);
    }
    this.persist();
  }

  accountByEmail(email: string): Account | undefined {
    const lower = email.trim().toLowerCase();
    return this.data.accounts.find((a) => a.email === lower);
  }

  /** Sets a confirmed email, or throws if another player uses it. */
  setEmail(id: string, email: string): void {
    const lower = email.trim().toLowerCase();
    const other = this.accountByEmail(lower);
    if (other && other.id !== id) throw new StoreError('email_taken', 'Another player already signs in with that email.');
    const account = this.accountById(id);
    if (!account) return;
    account.email = lower;
    this.persist();
  }

  accountByLogin(provider: LoginProvider, subject: string): Account | undefined {
    return this.data.accounts.find((a) => a.logins?.some((l) => l.provider === provider && l.subject === subject));
  }

  /** Links a Google or GitHub account, or throws if another player has it. */
  linkLogin(id: string, provider: LoginProvider, subject: string): void {
    const other = this.accountByLogin(provider, subject);
    if (other && other.id !== id) throw new StoreError('login_taken', `That ${provider === 'google' ? 'Google' : 'GitHub'} account already belongs to another player.`);
    const account = this.accountById(id);
    if (!account || other) return;
    account.logins = [...(account.logins ?? []).filter((l) => l.provider !== provider), { provider, subject }];
    this.persist();
  }

  // --- Wish Workshop drafts --------------------------------------------------------

  /** A player's Workshop draft; one left untouched for a week is dropped. */
  draftOf(playerId: string, now = Date.now()): WishDraft | undefined {
    const draft = this.data.drafts?.[playerId];
    if (draft && now - draft.at > DRAFT_DAYS * 86_400_000) {
      this.saveDraft(playerId, null);
      return undefined;
    }
    return draft;
  }

  saveDraft(playerId: string, draft: WishDraft | null): void {
    const drafts = { ...this.data.drafts };
    if (draft) drafts[playerId] = draft;
    else delete drafts[playerId];
    this.data.drafts = drafts;
    this.persist();
  }

  // --- While you were away ------------------------------------------------------

  addJournal(text: string, playerId: string | null, at = Date.now()): void {
    this.data.journal.push({ at, text, playerId });
    if (this.data.journal.length > MAX_JOURNAL) this.data.journal.splice(0, this.data.journal.length - MAX_JOURNAL);
    this.persist();
  }

  journalSince(since: number): JournalEntry[] {
    return this.data.journal.filter((j) => j.at > since);
  }

  accountById(id: string): Account | undefined {
    return this.data.accounts.find((a) => a.id === id);
  }

  accountByName(name: string): Account | undefined {
    const lower = name.trim().toLowerCase();
    return this.data.accounts.find((a) => a.name.toLowerCase() === lower);
  }

  setSuspended(id: string, suspended: Account['suspended'] | null): void {
    const account = this.accountById(id);
    if (!account || account.role === 'owner') return;
    if (suspended) account.suspended = suspended;
    else delete account.suspended;
    this.persist();
  }

  savePosition(id: string, x: number, y: number, regionId?: string, character?: Character, floor = 0): void {
    const account = this.accountById(id);
    if (!account) return;
    if (regionId) account.regionId = regionId;
    account.lastSeen = Date.now();
    account.x = x;
    account.y = y;
    if (floor) account.floor = floor;
    else delete account.floor;
    if (character) account.character = structuredClone(character);
    this.persist();
  }

  /** Saves a character for a player who is not in the world (one choosing their Calling). */
  saveCharacter(id: string, character: Character): void {
    const account = this.accountById(id);
    if (!account) return;
    account.character = structuredClone(character);
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

  /** Favor for a player who is offline. */
  addFavor(id: string, amount: number): void {
    const account = this.accountById(id);
    if (!account?.character) return;
    account.character.favor += amount;
    this.persist();
  }

  /** Creator XP for a player who is offline; returns Creator levels gained. */
  addCreatorXp(id: string, amount: number): number {
    const account = this.accountById(id);
    if (!account?.character) return 0;
    const character = upgradeCharacter(account.character);
    const levels = gainCreatorXp(character, amount);
    account.character = character;
    this.persist();
    return levels;
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

  // --- Reports ------------------------------------------------------------

  get reports(): readonly Report[] {
    return this.data.reports;
  }

  addReport(report: Report): void {
    this.data.reports.push(report);
    this.persist();
  }

  updateReport(id: string, change: Partial<Report>): Report | undefined {
    const report = this.data.reports.find((r) => r.id === id);
    if (!report) return undefined;
    Object.assign(report, change);
    this.persist();
    return report;
  }

  // --- Scripted rule state ----------------------------------------------------

  ruleData(ruleId: string): Record<string, Record<string, unknown>> {
    return this.data.ruleData[ruleId] ?? {};
  }

  setRuleData(ruleId: string, data: Record<string, Record<string, unknown>>): void {
    this.data.ruleData[ruleId] = data;
    this.persistSoon();
  }

  // --- World editor --------------------------------------------------------

  /** A land's edits and those taken back; empty for a land never edited. */
  worldEdits(regionId: string): WorldEditLog {
    return this.data.worldEdits?.[regionId] ?? { edits: [], undone: [] };
  }

  setWorldEdits(regionId: string, log: WorldEditLog): void {
    this.data.worldEdits = { ...this.data.worldEdits, [regionId]: log };
    this.persist();
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
    if (record.ref && this.data.spend.some((s) => s.ref === record.ref)) return;
    this.data.spend.push(record);
    this.persist();
  }

  /**
   * Swaps the guess recorded under `estimateRef` for what was really spent.
   * Without a guess (already settled, or never made) the record is just added.
   */
  settleSpend(estimateRef: string, record: SpendRecord): void {
    if (record.ref && this.data.spend.some((s) => s.ref === record.ref)) return;
    const i = this.data.spend.findIndex((s) => s.ref === estimateRef && s.estimate);
    if (i >= 0) this.data.spend.splice(i, 1);
    if (record.usd > 0) this.data.spend.push(record);
    this.persist();
  }

  /** Spending from `since` on, such as since Google's last daily reset. */
  spendSince(since: number): SpendRecord[] {
    return this.data.spend.filter((s) => s.at >= since);
  }

  /** Spending on the day (UTC) containing `now`. */
  spendToday(now: number): SpendRecord[] {
    const d = new Date(now);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return this.data.spend.filter((s) => s.at >= start && s.at <= now);
  }

  /** Spending in the calendar month (UTC) containing `now`. */
  spendThisMonth(now: number): SpendRecord[] {
    const d = new Date(now);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    return this.data.spend.filter((s) => s.at >= start && s.at <= now);
  }

  private soon: NodeJS.Timeout | null = null;

  /** Rule state can change many times a second; write it at most once a second. */
  private persistSoon(): void {
    if (this.soon || !this.backend) return;
    this.soon = setTimeout(() => {
      this.soon = null;
      this.persist();
    }, 1000);
    this.soon.unref();
  }

  /** Resolves once every pending write has been saved. */
  flush(): Promise<void> {
    if (this.soon) {
      clearTimeout(this.soon);
      this.soon = null;
      this.persist();
    }
    return this.saving;
  }

  /** Saves, then lets go of the database. */
  async close(): Promise<void> {
    await this.flush();
    await this.backend?.close();
  }

  private persist(): void {
    const backend = this.backend;
    if (!backend || this.queued) return;
    // Saves are chained so they never interleave; changes made while one
    // waits its turn are saved by it, so a burst of changes is one write.
    this.queued = true;
    this.saving = this.saving.then(async () => {
      this.queued = false;
      try {
        await backend.save(this.data);
      } catch (err) {
        // The game keeps running from memory; the next change tries again.
        console.error(`Could not save the world (${backend.label}):`, (err as Error).message);
      }
    });
  }
}

/** The whole world in one JSON file, written through a temp file so a crash mid-write cannot corrupt it. */
class FileBackend implements StoreBackend {
  constructor(private readonly path: string) {}

  get label(): string {
    return this.path;
  }

  async load(): Promise<Partial<Data> | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Partial<Data>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      return null;
    }
  }

  async save(data: Data): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, this.path);
  }

  async close(): Promise<void> {}
}

/**
 * The world in Postgres, one table per kind of thing. Spending and journal
 * lines have no ids of their own, so each gets a number the first time it is
 * saved, remembered beside it.
 */
class PostgresBackend implements StoreBackend {
  readonly label = 'Postgres';
  private readonly keys = new WeakMap<object, string>();
  /** The database had nothing in it when the game started. */
  wasEmpty = false;

  private constructor(private readonly sql: Sql, private readonly tables: PostgresTables) {}

  static async open(sql: Sql): Promise<PostgresBackend> {
    await migrate(sql);
    const backend = new PostgresBackend(sql, new PostgresTables(sql));
    backend.wasEmpty = await backend.tables.empty();
    return backend;
  }

  async load(): Promise<Partial<Data> | null> {
    const t = await this.tables.load();
    if (this.wasEmpty) return null;
    const numbered = <T extends object>(rows: Row[]): T[] => rows.map((r) => {
      this.keys.set(r.data as object, r.key);
      return r.data as T;
    });
    const settings = t.settings.find((r) => r.key === 'settings')?.data as Settings | undefined;
    return {
      accounts: t.accounts.map((r) => r.data as Account),
      invites: t.invites.map((r) => r.data as Invite),
      content: t.content.map((r) => r.data as ContentRecord),
      reports: t.reports.map((r) => r.data as Report),
      spend: numbered<SpendRecord>(t.spend),
      journal: numbered<JournalEntry>(t.journal),
      drafts: Object.fromEntries(t.drafts.map((r) => [r.key, r.data as WishDraft])),
      ruleData: Object.fromEntries(t.rule_data.map((r) => [r.key, r.data as Record<string, Record<string, unknown>>])),
      worldEdits: Object.fromEntries(t.world_edits.map((r) => [r.key, r.data as WorldEditLog])),
      ...(settings ? { settings } : {}),
    };
  }

  async save(data: Data): Promise<void> {
    const numbered = (items: object[]): Row[] => items.map((item) => {
      let key = this.keys.get(item);
      if (!key) {
        key = String(this.tables.takeNumber());
        this.keys.set(item, key);
      }
      return { key, data: item };
    });
    await this.tables.save({
      accounts: data.accounts.map((a) => ({ key: a.id, data: a })),
      invites: data.invites.map((i) => ({ key: i.code, data: i })),
      content: data.content.map((c) => ({ key: c.id, data: c })),
      reports: data.reports.map((r) => ({ key: r.id, data: r })),
      spend: numbered(data.spend),
      journal: numbered(data.journal),
      drafts: Object.entries(data.drafts ?? {}).map(([key, d]) => ({ key, data: d })),
      rule_data: Object.entries(data.ruleData).map(([key, d]) => ({ key, data: d })),
      world_edits: Object.entries(data.worldEdits ?? {}).map(([key, d]) => ({ key, data: d })),
      settings: [{ key: 'settings', data: data.settings }],
    });
  }

  close(): Promise<void> {
    return this.sql.close();
  }
}

export class StoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
