import { PARTY_SIZE } from '@co-mmo/shared';

/** How long a party invite waits for an answer. */
export const INVITE_MS = 60_000;

export interface Party {
  id: string;
  leader: string;
  /** Player ids, in the order they joined. */
  members: string[];
}

interface Invite {
  from: string;
  at: number;
}

/**
 * Who is in which party, and the invites waiting for an answer. Only state:
 * the world tells players what changed. Parties live in memory, so a server
 * restart breaks them up, which is fine for a group that plays together.
 */
export class Parties {
  private readonly parties = new Map<string, Party>();
  private readonly memberOf = new Map<string, string>();
  private readonly invites = new Map<string, Invite>();
  private nextId = 1;

  constructor(private readonly now: () => number = Date.now, readonly size = PARTY_SIZE) {}

  of(playerId: string): Party | undefined {
    const id = this.memberOf.get(playerId);
    return id ? this.parties.get(id) : undefined;
  }

  /** Everyone in the player's party, themself included; just them when in none. */
  members(playerId: string): string[] {
    return this.of(playerId)?.members ?? [playerId];
  }

  /** Records an invite, or returns why it cannot be sent. */
  invite(from: string, to: string): string | null {
    if (from === to) return 'You cannot invite yourself.';
    const party = this.of(from);
    if (party && party.members.length >= this.size) return `Your party is full (${this.size} is the most for now).`;
    if (party && party.members.includes(to)) return 'They are already in your party.';
    if (this.of(to)) return 'They are already in a party.';
    this.invites.set(to, { from, at: this.now() });
    return null;
  }

  /** Who invited this player, if the invite is still open. */
  invitedBy(playerId: string): string | undefined {
    const invite = this.invites.get(playerId);
    if (!invite) return undefined;
    if (this.now() - invite.at > INVITE_MS) {
      this.invites.delete(playerId);
      return undefined;
    }
    return invite.from;
  }

  /** Joins the inviter's party (making one if needed); returns the party, or why not. */
  accept(playerId: string): Party | string {
    const from = this.invitedBy(playerId);
    this.invites.delete(playerId);
    if (!from) return 'That invite has run out. Ask for a new one.';
    if (this.of(playerId)) return 'You are already in a party. Leave it first.';
    let party = this.of(from);
    if (!party) {
      party = { id: `p${this.nextId++}`, leader: from, members: [from] };
      this.parties.set(party.id, party);
      this.memberOf.set(from, party.id);
    }
    if (party.members.length >= this.size) return 'That party is full now.';
    party.members.push(playerId);
    this.memberOf.set(playerId, party.id);
    return party;
  }

  /** Turns an invite down; returns who sent it. */
  decline(playerId: string): string | undefined {
    const from = this.invitedBy(playerId);
    this.invites.delete(playerId);
    return from;
  }

  /**
   * Takes a player out of their party. A party of one is no party: the last
   * member is freed too. The next member leads if the leader left.
   * Returns the party as it is now, for telling those still in it.
   */
  leave(playerId: string): Party | undefined {
    const party = this.of(playerId);
    if (!party) return undefined;
    party.members = party.members.filter((m) => m !== playerId);
    this.memberOf.delete(playerId);
    if (party.leader === playerId) party.leader = party.members[0] ?? playerId;
    if (party.members.length <= 1) {
      for (const m of party.members) this.memberOf.delete(m);
      this.parties.delete(party.id);
    }
    return party;
  }
}
