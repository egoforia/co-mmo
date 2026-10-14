import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Runs git in the checkout and returns its trimmed output, or throws. */
export type GitRunner = (args: string[]) => Promise<string>;

export interface UpdaterOptions {
  /** The git checkout the server runs from. */
  repoDir: string;
  branch?: string;
  remote?: string;
  /**
   * Where to ask the dev supervisor (scripts/dev.mjs) for a pull and
   * restart. Unset when the server was started without it, so it cannot
   * restart itself.
   */
  requestFile?: string;
  /** Where the supervisor writes how the last update went. */
  resultFile?: string;
  git?: GitRunner;
  now?: () => number;
}

export interface UpdateCommit {
  hash: string;
  subject: string;
  author: string;
  at: number;
}

export interface UpdateResult {
  at: number;
  ok: boolean;
  from?: string;
  to?: string;
  installed?: boolean;
  message: string;
}

export interface UpdateStatus {
  /** False when this is not a git checkout (a container build, say). */
  available: boolean;
  reason?: string;
  branch?: string;
  commit?: string;
  upstream?: string;
  behind: number;
  ahead: number;
  /** Tracked files changed on this machine; a pull would refuse to run. */
  dirty: string[];
  commits: UpdateCommit[];
  checkedAt: number | null;
  fetchError?: string;
  /** True when the dev supervisor is there to pull and restart. */
  canRestart: boolean;
  /** Why the update button is off, in words for the Owner. */
  blocked?: string;
  lastUpdate: UpdateResult | null;
}

const FETCH_EVERY_MS = 10 * 60_000;
const MIN_FETCH_GAP_MS = 15_000;

/**
 * Checks GitHub for new commits on main, and asks the dev supervisor to
 * pull them and restart the game. Only fast-forward pulls: local changes or
 * local commits block the update instead of being merged or thrown away.
 */
export class Updater {
  readonly branch: string;
  readonly remote: string;
  private readonly git: GitRunner;
  private readonly now: () => number;
  private last: UpdateStatus | null = null;
  private lastFetch = 0;
  private fetchError: string | undefined;
  private checking: Promise<UpdateStatus> | null = null;
  private timer: NodeJS.Timeout | null = null;
  requested = false;

  constructor(private readonly options: UpdaterOptions) {
    this.branch = options.branch ?? 'main';
    this.remote = options.remote ?? 'origin';
    this.git = options.git ?? gitIn(options.repoDir);
    this.now = options.now ?? Date.now;
  }

  get canRestart(): boolean {
    return Boolean(this.options.requestFile);
  }

  /** Checks in the background now and every ten minutes. */
  start(): void {
    void this.check().catch(() => undefined);
    this.timer = setInterval(() => void this.check().catch(() => undefined), FETCH_EVERY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The last known status without touching git or the network. */
  cached(): UpdateStatus | null {
    return this.last;
  }

  /** Fetches main (at most every 15 seconds) and works out what is new. */
  check(force = false): Promise<UpdateStatus> {
    this.checking ??= this.run(force).finally(() => (this.checking = null));
    return this.checking;
  }

  private async run(force: boolean): Promise<UpdateStatus> {
    const base = { behind: 0, ahead: 0, dirty: [], commits: [], canRestart: this.canRestart, lastUpdate: this.lastUpdate() };
    try {
      await this.git(['rev-parse', '--git-dir']);
    } catch {
      this.last = { ...base, available: false, reason: 'The server is not running from a git checkout.', checkedAt: this.now() };
      return this.last;
    }
    const upstream = `${this.remote}/${this.branch}`;
    if (force || this.now() - this.lastFetch > MIN_FETCH_GAP_MS) {
      this.lastFetch = this.now();
      try {
        await this.git(['fetch', '--quiet', this.remote, `+refs/heads/${this.branch}:refs/remotes/${upstream}`]);
        this.fetchError = undefined;
      } catch (err) {
        this.fetchError = firstLine((err as Error).message);
      }
    }
    const branch = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const commit = await this.git(['rev-parse', '--short', 'HEAD']);
    const dirty = (await this.git(['diff', '--name-only', 'HEAD'])).split('\n').filter(Boolean);
    let behind = 0;
    let ahead = 0;
    let commits: UpdateCommit[] = [];
    let upstreamHash: string | undefined;
    try {
      upstreamHash = await this.git(['rev-parse', '--short', upstream]);
      const [a, b] = (await this.git(['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).split(/\s+/);
      ahead = Number(a) || 0;
      behind = Number(b) || 0;
      const log = await this.git(['log', '-n', '30', '--format=%h%x1f%s%x1f%an%x1f%ct', `HEAD..${upstream}`]);
      commits = log.split('\n').filter(Boolean).map((line) => {
        const [hash = '', subject = '', author = '', at = '0'] = line.split('\x1f');
        return { hash, subject, author, at: Number(at) * 1000 };
      });
    } catch {
      // No remote branch yet (never fetched): nothing to compare against.
    }
    const status: UpdateStatus = {
      ...base,
      available: true,
      branch,
      commit,
      upstream: upstreamHash,
      behind,
      ahead,
      dirty,
      commits,
      checkedAt: this.now(),
      fetchError: this.fetchError,
    };
    status.blocked = this.blockedReason(status);
    this.last = status;
    return status;
  }

  private blockedReason(s: UpdateStatus): string | undefined {
    if (!s.canRestart) return 'Start the game with "npm run dev" so it can pull and restart itself.';
    if (s.branch !== this.branch) return `This machine is on the branch "${s.branch}", not ${this.branch}. Switch to ${this.branch} first.`;
    if (s.dirty.length) return `This machine has uncommitted changes (${s.dirty.slice(0, 3).join(', ')}${s.dirty.length > 3 ? ', …' : ''}). Commit or stash them first.`;
    if (s.ahead) return `This machine has ${s.ahead} commit${s.ahead === 1 ? '' : 's'} that ${this.branch} on GitHub does not. Push or reset them first.`;
    if (!s.behind) return 'Already up to date.';
    return undefined;
  }

  /**
   * Re-checks, then asks the supervisor to pull and restart. Returns the
   * reason it can't when the update is blocked.
   */
  async request(by: string, prepare?: () => Promise<void>): Promise<{ ok: true; status: UpdateStatus } | { ok: false; message: string }> {
    if (this.requested) return { ok: false, message: 'An update is already under way.' };
    const status = await this.check(true);
    if (!status.available) return { ok: false, message: status.reason ?? 'Updates are not available.' };
    if (status.blocked) return { ok: false, message: status.blocked };
    this.requested = true;
    // Save the world before the supervisor stops us.
    await prepare?.();
    writeFileSync(this.options.requestFile!, JSON.stringify({ at: this.now(), by, from: status.commit, to: status.upstream }));
    return { ok: true, status };
  }

  /** True when the running checkout already contains this commit. */
  async contains(sha: string): Promise<boolean> {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return false;
    try {
      await this.git(['merge-base', '--is-ancestor', sha, 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  private lastUpdate(): UpdateResult | null {
    const file = this.options.resultFile;
    if (!file || !existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as UpdateResult;
    } catch {
      return null;
    }
  }
}

/** The commit the server started from, for clients to notice a restart. */
export function currentCommit(repoDir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function gitIn(cwd: string): GitRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd,
        timeout: 30_000,
        // Never wait on a password prompt; fail and say so instead.
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
        },
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout.trim());
      });
    });
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim().slice(0, 200) ?? 'git fetch failed';
}
