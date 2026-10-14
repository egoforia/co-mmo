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
