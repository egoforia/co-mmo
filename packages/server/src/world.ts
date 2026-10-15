import {
  CREATOR_LEVEL_FAVOR,
  CREATOR_REPEAT_MS,
  CREATOR_XP,
  WEAKENED_MS,
  gainCreatorXp,
  wisherOf,
  WORLD_REGIONS,
  arrivalPoint,
  cellBeyond,
  linkRegions,
  nearestOpenSide,
  type RegionDef,
  type Side,
  maxHp,
  type Character,
  type ChatMessage,
  type CreatorCredit,
  type ClientMessage,
  type PartyActionMessage,
  type PartyMessage,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Parties } from './parties.ts';
import { Region, type Connection } from './region.ts';

export interface SavedPlace {
  regionId: string;
  x: number | null;
  y: number | null;
}

/** Where a player is and who they are, for saving. */
export interface Place {
  id: string;
  regionId: string;
  x: number;
  y: number;
  character: Character;
}

/**
 * All regions, and the moves between them. Today every region runs in this
 * process; the world is the seam where regions move to separate processes.
 */
export class World {
  readonly regions = new Map<string, Region>();
  private readonly where = new Map<string, string>();
  readonly parties: Parties;
  /** Names of party members who are offline, so the party list can still show them. */
  private readonly names = new Map<string, string>();
  /** Who last whispered to each player, for replying. */
  private readonly lastWhisper = new Map<string, string>();
  /** When a player last earned someone Creator XP for a thing, per kind of enjoyment. */
  private readonly credited = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now, private readonly random: () => number = Math.random) {
    this.parties = new Parties(now);
    // Each world keeps its own copies: wished regions change the exits.
    const launch = WORLD_REGIONS.map((def) => structuredClone(def));
    const links = linkRegions(launch);
    for (const def of launch) {
      def.exits = links.get(def.id) ?? {};
      this.regions.set(def.id, this.makeRegion(def));
    }
  }

  private makeRegion(def: RegionDef): Region {
    const region: Region = new Region(def, {
      worldChat: (m) => this.broadcast(m),
      online: () => this.where.size,
      creator: (thing, playerId, credit) => this.creatorCredit(thing, playerId, credit),
      event: (type, playerId, data) => this.onEvent?.(type, playerId, data),
      route: (message, to) => this.route(message, to),
      party: (playerId) => this.parties.members(playerId),
      journal: (text, playerId) => this.onJournal?.(text, playerId),
      // Every region around this one, corners too, so the world is drawn as one map.
      neighbours: () => this.defs().filter((d) => d !== region.def && Math.max(Math.abs(d.at.x - region.def.at.x), Math.abs(d.at.y - region.def.at.y)) === 1),
    }, this.now, this.random);
    return region;
  }

  /** Every region's layout, launch and wished. */
  defs(): RegionDef[] {
    return [...this.regions.values()].map((r) => r.def);
  }

  /**
   * Adds a region on its square of the world grid, joined by roads to every
   * region beside it (design doc, World structure: the map grows outward).
   * Returns false when the square is taken.
   */
  addRegion(def: RegionDef): boolean {
    if (this.regions.has(def.id) || this.defs().some((d) => d.at.x === def.at.x && d.at.y === def.at.y)) return false;
    def.exits = linkRegions([...this.defs(), def]).get(def.id) ?? {};
    this.regions.set(def.id, this.makeRegion(def));
    this.relink(def.at);
    return true;
  }

  /**
   * Takes a wished region out of the world (its wish was rolled back).
   * Anyone inside wakes at the shrine; the roads that led there close.
   */
  removeRegion(id: string): void {
    const region = this.regions.get(id);
    if (!region || id === this.home.def.id) return;
    const home = this.home;
    for (const playerId of region.playerIds()) {
      const leaving = region.remove(playerId);
      if (!leaving) continue;
      this.where.set(playerId, home.def.id);
      home.join(leaving.info, leaving.conn, home.map.spawn, leaving.character, `${leaving.info.name} was carried back to ${home.def.name}.`);
      leaving.conn.send({ t: 'notice', text: `${region.def.name} faded from the world, and the God carried you back to the shrine.` });
      this.partyChanged(playerId);
    }
    this.regions.delete(id);
    this.relink(region.def.at);
  }

  /**
   * Gives every region whose neighbours changed its new roads, and shows the
   * change at `cell` to everyone in the regions around it, corners too.
   */
  private relink(cell: { x: number; y: number }): void {
    const links = linkRegions(this.defs());
    for (const region of this.regions.values()) {
      const exits = links.get(region.def.id) ?? {};
      if (JSON.stringify(exits) !== JSON.stringify(region.def.exits)) region.setExits(exits);
      else if (Math.max(Math.abs(region.def.at.x - cell.x), Math.abs(region.def.at.y - cell.y)) === 1) region.welcomeAll();
    }
  }

  /**
   * Where a region wished by this player would go: beyond the open edge of
   * their region nearest to them. Undefined when every edge has a neighbour.
   */
  openEdge(playerId: string): { region: Region; side: Side; cell: { x: number; y: number } } | undefined {
    const region = this.regionOf(playerId);
    const at = region?.position(playerId);
    if (!region || !at) return undefined;
    const side = nearestOpenSide(this.defs(), region.def, at.x, at.y, region.map.width);
    return side && { region, side, cell: cellBeyond(region.def, side) };
  }

  /** True when no region stands on this grid square. */
  cellFree(cell: { x: number; y: number }): boolean {
    return !this.defs().some((d) => d.at.x === cell.x && d.at.y === cell.y);
  }

  /** Something worth a line in the "While you were away" feed (set by the app, which stores it). */
  onJournal?: (text: string, playerId: string) => void;

  /** Events for scripted rules: set by whoever runs them (the app, or a rule's test run). */
  onEvent?: (type: 'use' | 'interact' | 'defeat' | 'enter' | 'join', playerId: string, data: Record<string, string | number>) => void;

  /** Credits Creator XP to a player who is not online; returns Creator levels gained (set by the app, which owns storage). */
  offlineCreatorXp?: (playerId: string, amount: number) => number;

  /**
   * Someone enjoyed a thing another player wished for: its wisher earns
   * Creator XP (design doc, Characters and progression). Talking, using,
   * wearing, crafting and learning count once per player, thing and kind
   * every few minutes, so nobody farms a friend's creation.
   */
  creatorCredit(thing: string, playerId: string, credit: CreatorCredit): void {
    const wisher = wisherOf(thing);
    if (!wisher || wisher === playerId) return;
    if (credit !== 'defeat') {
      const key = `${playerId} ${thing} ${credit}`;
      const last = this.credited.get(key);
      if (last !== undefined && this.now() - last < CREATOR_REPEAT_MS) return;
      this.credited.set(key, this.now());
      if (this.credited.size > 10_000) this.credited.clear();
    }
    const amount = CREATOR_XP[credit];
    const region = this.regionOf(wisher);
    let levels = 0;
    if (region) {
      region.updateCharacter(wisher, (c) => {
        levels = gainCreatorXp(c, amount);
      });
    } else {
      levels = this.offlineCreatorXp?.(wisher, amount) ?? 0;
    }
    if (!levels) return;
    const name = this.names.get(wisher);
    const level = region?.character(wisher)?.creatorLevel;
    if (region && level) {
      region.tell(wisher, `✦ Others love what you wished into the world. You reached Creator level ${level} and earned ${levels * CREATOR_LEVEL_FAVOR} Favor.`);
    }
    if (name && level) this.onJournal?.(`${name}'s creations earned them Creator level ${level}.`, wisher);
  }

  /** Sends one player a message, wherever they are. */
  sendTo(playerId: string, message: ServerMessage): void {
    this.regionOf(playerId)?.send(playerId, message);
  }

  get home(): Region {
    return this.regions.get(WORLD_REGIONS[0]!.id)!;
  }

  region(id: string): Region | undefined {
    return this.regions.get(id);
  }

  regionOf(playerId: string): Region | undefined {
    const id = this.where.get(playerId);
    return id ? this.regions.get(id) : undefined;
  }

  has(playerId: string): boolean {
    return this.where.has(playerId);
  }

  join(info: PlayerInfo, conn: Connection, saved: SavedPlace, character: Character): void {
    // A second window replaces the first wherever it was, keeping its progress.
    const previous = this.regionOf(info.id);
    character = previous?.character(info.id) ?? character;
    if (previous && previous.def.id !== saved.regionId) {
      previous.remove(info.id, `${info.name} left.`)?.conn.close('Signed in from another window.');
    }
    const region = this.regions.get(saved.regionId) ?? this.home;
    this.where.set(info.id, region.def.id);
    this.names.set(info.id, info.name);
    region.join(info, conn, saved, character);
    this.partyChanged(info.id);
  }

  leave(playerId: string): Place | undefined {
    const region = this.regionOf(playerId);
    if (!region) return undefined;
    const left = region.remove(playerId);
    this.where.delete(playerId);
    this.partyChanged(playerId);
    return left && { id: playerId, regionId: region.def.id, x: left.x, y: left.y, character: left.character };
  }

  handle(playerId: string, message: ClientMessage): void {
    if (message.t === 'party') return this.partyAction(playerId, message);
    this.regionOf(playerId)?.handle(playerId, message);
  }

  /** The online player with this name, if any. */
  findOnline(name: string): string | undefined {
    const lower = name.trim().replace(/^@/, '').toLowerCase();
    for (const [id] of this.where) {
      if (this.names.get(id)?.toLowerCase() === lower) return id;
    }
    return undefined;
  }

  // --- Party and whisper chat ------------------------------------------------

  /** Delivers party and whisper lines, which cross regions; returns why it could not. */
  private route(message: ChatMessage, to?: string): string | void {
    const from = message.from.id;
    if (message.channel === 'party') {
      const members = this.parties.members(from);
      if (members.length <= 1) return 'You are not in a party. Invite someone with /invite and their name.';
      for (const id of members) this.sendTo(id, message);
      return;
    }
    // A whisper with no name answers whoever whispered last.
    const name = to?.trim() || this.names.get(this.lastWhisper.get(from) ?? '');
    if (!name) return 'Whisper to whom? Write /w, their name, then your message.';
    const target = this.findOnline(name);
    if (!target) return `${name} is not online right now.`;
    if (target === from) return 'Whispering to yourself? Your secret is safe.';
    const whisper: ChatMessage = { ...message, to: { id: target, name: this.names.get(target)! } };
    this.lastWhisper.set(target, from);
    this.sendTo(target, whisper);
    this.sendTo(from, whisper);
  }

  // --- Parties -----------------------------------------------------------------

  private partyAction(playerId: string, message: PartyActionMessage): void {
    const tell = (text: string) => this.sendTo(playerId, { t: 'notice', text });
    const me = this.names.get(playerId) ?? 'Someone';
    switch (message.action) {
      case 'invite': {
        const target = message.name ? this.findOnline(message.name) : undefined;
        if (!target) return tell(message.name ? `${message.name} is not online right now.` : 'Invite whom? Write /invite and their name.');
        const why = this.parties.invite(playerId, target);
        if (why) return tell(why);
        this.sendTo(target, { t: 'party-invite', from: { id: playerId, name: me } });
        return tell(`You invited ${this.names.get(target)} to your party.`);
      }
      case 'accept': {
        const result = this.parties.accept(playerId);
        if (typeof result === 'string') return tell(result);
        for (const id of result.members) {
          if (id !== playerId) this.sendTo(id, { t: 'notice', text: `${me} joined the party.` });
        }
        tell('You joined the party. Party chat and XP are shared.');
        return this.partyChanged(playerId);
      }
      case 'decline': {
        const from = this.parties.decline(playerId);
        if (from) this.sendTo(from, { t: 'notice', text: `${me} said no to your party invite.` });
        return;
      }
      case 'leave': {
        const party = this.parties.leave(playerId);
        if (!party) return tell('You are not in a party.');
        tell('You left the party.');
        this.sendTo(playerId, { t: 'party', party: null });
        for (const id of party.members) this.sendTo(id, { t: 'notice', text: `${me} left the party.` });
        if (party.members.length <= 1) {
          for (const id of party.members) this.sendTo(id, { t: 'party', party: null });
        } else {
          this.partyChanged(party.members[0]!);
        }
      }
    }
  }

  /** Tells everyone in this player's party who is in it and where. */
  private partyChanged(playerId: string): void {
    const party = this.parties.of(playerId);
    if (!party) return;
    const message: PartyMessage = {
      t: 'party',
      party: {
        leader: party.leader,
        members: party.members.map((id) => {
          const region = this.regionOf(id);
          return { id, name: this.names.get(id) ?? 'Someone', online: Boolean(region), ...(region ? { region: region.def.name } : {}) };
        }),
      },
    };
    for (const id of party.members) this.sendTo(id, message);
  }

  /** Ticks every region, then moves players who walked off an open edge or fell. */
  tick(): void {
    for (const region of this.regions.values()) {
      for (const departure of region.tick()) {
        const name = region.nameOf(departure.id) ?? 'Someone';
        if (departure.died) {
          // Respawn at the shrine, Weakened for a while; nothing is lost.
          const home = this.home;
          const fallen = region.remove(departure.id, `${name} fell in ${region.def.name}.`);
          if (!fallen) continue;
          fallen.character.hp = maxHp(fallen.character);
          fallen.character.weakenedUntil = this.now() + WEAKENED_MS;
          this.where.set(departure.id, home.def.id);
          home.join(fallen.info, fallen.conn, home.map.spawn, fallen.character, `${name} woke at the shrine of ${home.def.name}.`);
          this.partyChanged(departure.id);
          fallen.conn.send({ t: 'notice', text: `You fell, and woke at the shrine. You are Weakened for ${WEAKENED_MS / 1000} seconds.` });
          continue;
        }
        const target = this.regions.get(region.def.exits[departure.side] ?? '');
        // Keep the player's place along the edge, so crossing feels like one more step.
        const at = region.position(departure.id);
        const arrival = target && at && arrivalPoint(target.map, departure.side, at);
        if (!target || !arrival) continue;
        const moving = region.remove(departure.id, `${name} set off for ${target.def.name}.`);
        if (!moving) continue;
        this.where.set(departure.id, target.def.id);
        target.join(moving.info, moving.conn, arrival, moving.character, `${name} arrived from ${region.def.name}.`, moving.carry);
        this.onEvent?.('enter', departure.id, { region: target.def.id });
        // Walking into a wished region earns its wisher Creator XP.
        this.creatorCredit(target.def.id, departure.id, 'visit');
        this.partyChanged(departure.id);
      }
    }
  }

  /** Where every online player is, for saving. */
  places(): Place[] {
    const result: Place[] = [];
    for (const [id, regionId] of this.where) {
      const region = this.regions.get(regionId);
      const pos = region?.position(id);
      const character = region?.character(id);
      if (pos && character) result.push({ id, regionId, ...pos, character });
    }
    return result;
  }

  broadcast(message: ServerMessage): void {
    for (const region of this.regions.values()) region.broadcast(message);
  }
}

