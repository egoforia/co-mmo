import { execFileSync } from 'node:child_process';
import type { BuildIssues, IssueComment, IssueState } from '../builds.ts';

/** GitHub's REST API with a token that may only open and read issues. */
export class GitHubIssues implements BuildIssues {
  private readonly fetch: typeof fetch;

  constructor(readonly repo: string, private readonly token: string, fetchImpl?: typeof fetch) {
    this.fetch = fetchImpl ?? fetch;
  }

  async createIssue(title: string, body: string): Promise<{ number: number; url: string }> {
    const issue = (await this.call('POST', '/issues', { title: title.slice(0, 200), body })) as { number: number; html_url: string };
    return { number: issue.number, url: issue.html_url };
  }

  async comments(issue: number): Promise<IssueComment[]> {
    const list = (await this.call('GET', `/issues/${issue}/comments?per_page=100`)) as { user?: { login?: string }; body?: string; created_at?: string }[];
    return list.map((c) => ({ author: c.user?.login ?? '', body: c.body ?? '', at: Date.parse(c.created_at ?? '') || 0 }));
  }

  async close(issue: number, comment?: string): Promise<void> {
    if (comment) await this.call('POST', `/issues/${issue}/comments`, { body: comment });
    await this.call('PATCH', `/issues/${issue}`, { state: 'closed', state_reason: 'not_planned' });
  }

  async issue(issue: number): Promise<IssueState> {
    const data = (await this.call('GET', `/issues/${issue}`)) as { state?: string; closed_at?: string | null };
    const closedAt = Date.parse(data.closed_at ?? '');
    return { open: data.state !== 'closed', ...(Number.isFinite(closedAt) ? { closedAt } : {}) };
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetch(`https://api.github.com/repos/${this.repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'co-mmo-server',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (data as { message?: string }).message ?? res.statusText;
      throw new Error(githubError(res.status, message, this.repo));
    }
    return data;
  }
}

/**
 * What the Owner reads in God's View when GitHub refuses a call. A 401 means
 * GitHub does not know the token at all (expired, deleted or mistyped), which
 * a permission change cannot fix, so it says to make a new one.
 */
export function githubError(status: number, message: string, repo: string): string {
  if (status === 401) {
    return `GitHub no longer accepts the token (${message}). It has probably expired or been deleted. Make a new fine-grained token for ${repo} with Issues set to read and write, put it in the server's .env as GITHUB_ISSUES_TOKEN, and restart the game.`;
  }
  if (status === 403 || status === 404) {
    return `GitHub said ${status} (${message}). The token works but cannot reach issues on ${repo}: check that it was made for this repository with Issues set to read and write.`;
  }
  return `GitHub said ${status}: ${message}`;
}

/** owner/name from the checkout's origin remote, if it is on GitHub. */
export function repoFromRemote(repoDir: string): string | null {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return url.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}
