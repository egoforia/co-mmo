import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PLAYER_COLORS, gainCreatorXp, hashString, upgradeCharacter, type BuildTrack, type Character, type ContentEntry, type Role, type WishDraft } from '@co-mmo/shared';
import type { ChatTurn, ProviderId } from './ai/chat.ts';
import type { RuleTestReport } from './rule-test.ts';

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
    /** Drafts scripted rules for Major wishes; null uses the God's model. */
    compiler?: ModelChoice | null;
    /** Paints wished things; 'none' keeps tinted placeholders. `uses` picks another model for some kinds of art. */
    image: { provider: 'gemini' | 'none'; model: string; uses?: Partial<Record<ArtUse, string>> };
    /** Makes walk clips (missing in older saves: Veo whenever the images come from Gemini). */
    video?: { provider: 'gemini' | 'none'; model: string };
    /** Makes sound effects and music (missing in older saves: see soundSettings). */
    sound?: SoundSettings;
  };
  budget: {
    /** Monthly ceiling; above it wishes still work, with placeholder art. */
    monthlyUsd: number;
    /** God's View warns from here. */
    warnUsd: number;
    /** Painting and sound stop for the day (UTC) once this much is spent, and pick up the next day (missing in older saves). */
    dailyUsd?: number;
  };
  /** Building Engine wishes as code changes (missing in older saves). */
  builds?: BuildSettings;
  /** The Wish Workshop (missing in older saves). */
  workshop?: WorkshopSettings;
}

/** The daily spending cap unless the Owner sets one: a busy day's painting, well under the month. */
export const DEFAULT_DAILY_USD = 10;

/**
 * Kinds of art that can each have their own image model (design doc, asset
 * tiers): a dearer model where it shows most, a cheap one elsewhere.
 */
export type ArtUse = 'wishes' | 'buildings' | 'scenery' | 'walks';
export const ART_USES: ArtUse[] = ['wishes', 'buildings', 'scenery', 'walks'];

/** The video model in use: the saved choice, or Veo Lite when images come from Gemini. */
export function videoSettings(settings: Settings): { provider: 'gemini' | 'none'; model: string } {
  return settings.ai.video ?? (settings.ai.image.provider === 'gemini' ? { provider: 'gemini', model: 'veo-3.1-lite-generate-preview' } : { provider: 'none', model: '' });
}

export interface SoundSettings {
  /** Short sound effects; 'none' plays the game without them. */
  effects: { provider: 'elevenlabs' | 'none'; model: string };
  /** One looping track per land; 'none' plays the game without music. */
  music: { provider: 'gemini' | 'none'; model: string };
}

/** The sound services in use: the saved choice, or whatever the server's keys allow. */
export function soundSettings(settings: Settings, env: Record<string, string | undefined> = process.env): SoundSettings {
  return settings.ai.sound ?? {
    effects: env.ELEVENLABS_API_KEY ? { provider: 'elevenlabs', model: 'eleven_text_to_sound_v2' } : { provider: 'none', model: '' },
    music: env.GEMINI_API_KEY ? { provider: 'gemini', model: 'lyria-3-clip-preview' } : { provider: 'none', model: '' },
  };
}

export interface WorkshopSettings {
  /** Players may pay Favor to have a sample painted before sending a wish. Off unless the Owner turns it on. */
  samples: boolean;
  /** Favor one sample costs. */
  sampleFavor: number;
}

export const DEFAULT_WORKSHOP: WorkshopSettings = { samples: false, sampleFavor: 1 };

export interface BuildSettings {
  /** Who writes the change: Claude Code in GitHub Actions, or a person working from the issue. */
  agent: 'claude' | 'manual';
  /** Builds started per day (UTC); more wait in the queue. */
  dailyLimit: number;
  /** What one build is guessed to cost, counted until its run reports the real cost. */
  usdPerBuild: number;
}

export const DEFAULT_BUILDS: BuildSettings = { agent: 'claude', dailyLimit: 3, usdPerBuild: 1.5 };

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
}

export function defaultSettings(env: Record<string, string | undefined> = process.env): Settings {
  const gemini = Boolean(env.GEMINI_API_KEY);
  return {
    ai: {
      god: gemini ? { provider: 'gemini', model: 'gemini-3.8-flash' } : { provider: 'offline', model: 'scripted' },
      fallback: null,
      compiler: null,
      image: gemini ? { provider: 'gemini', model: 'gemini-2.5-flash-image' } : { provider: 'none', model: '' },
    },
    budget: { monthlyUsd: 70, warnUsd: 50, dailyUsd: DEFAULT_DAILY_USD },
    builds: { ...DEFAULT_BUILDS },
  };
}

/**
 * Persistence for accounts and invites. This JSON-file version keeps local
 * development dependency-free; a Postgres implementation of the same methods
 * replaces it for hosting (see the design doc, Technical architecture).
 */
export class Store {
  private data: Data = { accounts: [], invites: [], content: [], settings: defaultSettings(), spend: [], reports: [], ruleData: {}, journal: [] };
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

  savePosition(id: string, x: number, y: number, regionId?: string, character?: Character): void {
    const account = this.accountById(id);
    if (!account) return;
    if (regionId) account.regionId = regionId;
    account.lastSeen = Date.now();
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
    if (this.soon || !this.path) return;
    this.soon = setTimeout(() => {
      this.soon = null;
      this.persist();
    }, 1000);
    this.soon.unref();
  }

  /** Resolves once every pending write has reached disk. */
  flush(): Promise<void> {
    if (this.soon) {
      clearTimeout(this.soon);
      this.soon = null;
      this.persist();
    }
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
