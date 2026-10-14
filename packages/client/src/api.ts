import type { PlayerInfo } from '@co-mmo/shared';

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

export async function acceptInvite(code: string, name: string, adult: boolean): Promise<{ token: string; player: PlayerInfo }> {
  const res = await fetch('/api/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name, adult }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Could not accept the invite.');
  return body;
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
