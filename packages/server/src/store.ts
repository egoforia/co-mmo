import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PLAYER_COLORS, hashString, type Role } from '@co-mmo/shared';

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
}

export interface Invite {
  code: string;
  createdBy: string | null;
  createdAt: number;
  /** Role granted to whoever accepts. Only the bootstrap invite grants owner. */
  role: Role;
  usedBy: string | null;
}

interface Data {
  accounts: Account[];
  invites: Invite[];
}

/**
 * Persistence for accounts and invites. This JSON-file version keeps local
 * development dependency-free; a Postgres implementation of the same methods
 * replaces it for hosting (see the design doc, Technical architecture).
 */
export class Store {
  private data: Data = { accounts: [], invites: [] };
  private saving: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string | null) {}

  /** A store backed by a JSON file, created if missing. */
  static async open(path: string): Promise<Store> {
    const store = new Store(path);
    try {
      store.data = JSON.parse(await readFile(path, 'utf8')) as Data;
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

  savePosition(id: string, x: number, y: number, regionId?: string): void {
    const account = this.accountById(id);
    if (!account) return;
    if (regionId) account.regionId = regionId;
    account.x = x;
    account.y = y;
    this.persist();
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
