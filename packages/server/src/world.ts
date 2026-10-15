import {
  CREATOR_LEVEL_FAVOR,
  CREATOR_REPEAT_MS,
  CREATOR_XP,
  WEAKENED_MS,
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
  type ContentEntry,
  type NpcPlacement,
  type PartyActionMessage,
  type PartyMessage,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Parties } from './parties.ts';
import { Region, type Connection, type Departure, type Leaving } from './region.ts';
import type { CharacterOp, OpResult } from './character-ops.ts';
import type { Placement, RegionHandle, WorldState } from './region-link.ts';

/**
 * Where regions run. Without one every region runs in this process; the
 * region servers' coordinator gives one that puts them on region servers.
 */
export interface Hosting {
  /** Sets a region up on a host of the hosting's choosing, or undefined to run it here. */
  host(def: RegionDef, placements: Placement[], world: World): RegionHandle | undefined;
  /** The world changed in a way every region server must hear of (regions, who is online, parties). */
  changed?(state: WorldState): void;
  /** Wished things came into being or went away: region servers must know them before they are placed. */
  content?(entries: ContentEntry[]): void;
}

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
 * All regions, and the moves between them. Each region runs in this process
 * or on a region server (design doc, Scaling without a cap); the world
 * routes to it either way, and moves players between regions wherever they run.
 */
export class World {
  readonly regions = new Map<string, RegionHandle>();
  /** Wished things placed in each region, so a region set up again elsewhere gets them back. */
  private readonly placements = new Map<string, Placement[]>();
  /** Players on their way between regions (or regions between hosts); their inputs wait. */
  private readonly moving = new Set<string>();
  /** Moves still under way, so closing can wait for them. */
  readonly pending = new Set<Promise<unknown>>();
  /** Where new and moved regions run; unset, everything runs here. */
  hosting?: Hosting;
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

  /** Sets a region up wherever the hosting says, with what was wished into it. */
  private makeRegion(def: RegionDef): RegionHandle {
    const placements = this.placements.get(def.id) ?? [];
    return this.hosting?.host(def, placements, this) ?? this.runHere(def, placements);
  }

  /** A region run in this process. */
  private runHere(def: RegionDef, placements: Placement[] = []): Region {
    const region: Region = new Region(def, {
      worldChat: (m) => this.broadcast(m),
      online: () => this.where.size,
      creator: (thing, playerId, credit) => this.creatorCredit(thing, playerId, credit),
      event: (type, playerId, data) => this.onEvent?.(type, playerId, data),
      route: (message, to) => this.route(message, to),
      party: (playerId) => this.parties.members(playerId),
      journal: (text, playerId) => this.onJournal?.(text, playerId),
      // Every region around this one, corners too, so the world is drawn as one map.
      neighbours: () => this.neighbours(region.def),
    }, this.now, this.random);
    for (const p of placements) {
      if (p.kind === 'creatures') region.addCreatures(p.id, p.spots);
      else region.addNpc(p.npc);
    }
    return region;
  }

  /** The regions around one, corners too. */
  neighbours(def: RegionDef): RegionDef[] {
    return this.defs().filter((d) => d.id !== def.id && Math.max(Math.abs(d.at.x - def.at.x), Math.abs(d.at.y - def.at.y)) === 1);
  }

  /** What every region server must know about the world: its regions, who is online, and parties. */
  state(): WorldState {
    const parties: Record<string, string[]> = {};
    for (const id of this.where.keys()) {
      const members = this.parties.members(id);
      if (members.length > 1) parties[id] = members;
    }
    return { defs: this.defs(), online: this.where.size, parties };
  }

  /** Wished things came into being or went away (wishes granted, restored or rolled back). */
  contentChanged(entries: ContentEntry[]): void {
    this.hosting?.content?.(entries);
  }

  private stateChanged(): void {
    this.hosting?.changed?.(this.state());
  }

  // --- Wished things in regions ------------------------------------------------

  /** Places a wished kind of creature in a region, here or on its region server. */
  placeCreatures(regionId: string, kind: string, spots: { x: number; y: number }[]): void {
    this.remember(regionId, { kind: 'creatures', id: kind, spots });
    this.regions.get(regionId)?.addCreatures(kind, spots);
  }

  /** Places a wished person in a region. */
  placeNpc(regionId: string, npc: NpcPlacement): void {
    this.remember(regionId, { kind: 'npc', npc });
    this.regions.get(regionId)?.addNpc(npc);
  }

  /** Takes a wish's things out of every region. */
  unplace(id: string): void {
    for (const [regionId, list] of this.placements) {
      this.placements.set(regionId, list.filter((p) => (p.kind === 'creatures' ? p.id : p.npc.id) !== id));
    }
    for (const region of this.regions.values()) region.removeWish(id);
  }

  private remember(regionId: string, placement: Placement): void {
    const list = this.placements.get(regionId) ?? [];
    const key = placement.kind === 'creatures' ? placement.id : placement.npc.id;
    this.placements.set(regionId, [...list.filter((p) => (p.kind === 'creatures' ? p.id : p.npc.id) !== key || p.kind !== placement.kind), placement]);
  }

  /**
   * Sets a region up on another host (or this one again, as a restart):
   * everyone inside is taken out, the region is made afresh with what was
   * wished into it, and they are put back where they stood. `gone` says the
   * old host cannot answer, so players are moved from what they were last sent.
   */
  async moveRegion(id: string, gone = false): Promise<void> {
    const old = this.regions.get(id);
    if (!old) return;
    const players = old.playerIds();
    for (const p of players) this.moving.add(p);
    try {
      const leaving = await takeAll(old, gone);
      if (this.regions.get(id) !== old) return;
      const fresh = this.makeRegion(old.def);
      this.regions.set(id, fresh);
      for (const l of leaving) {
        fresh.join(l.info, l.conn, { x: l.x, y: l.y }, l.character, '', l.carry);
        this.where.set(l.info.id, id);
      }
    } finally {
      for (const p of players) this.moving.delete(p);
    }
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
    this.stateChanged();
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
    this.regions.delete(id);
    this.placements.delete(id);
    for (const playerId of region.playerIds()) {
      this.moving.add(playerId);
      this.track(settle(region.remove(playerId), (leaving) => {
        this.moving.delete(playerId);
        if (!leaving) return;
        this.where.set(playerId, home.def.id);
        home.join(leaving.info, leaving.conn, home.map.spawn, leaving.character, `${leaving.info.name} was carried back to ${home.def.name}.`);
        leaving.conn.send({ t: 'notice', text: `${region.def.name} faded from the world, and the God carried you back to the shrine.` });
        this.partyChanged(playerId);
      }));
    }
    this.relink(region.def.at);
    this.stateChanged();
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
  openEdge(playerId: string): { region: RegionHandle; side: Side; cell: { x: number; y: number } } | undefined {
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
    if (!region) {
      this.offlineCreatorXp?.(wisher, amount);
      return;
    }
    this.track(settle(region.change(wisher, { op: 'creatorXp', amount }), ({ levels }) => {
      if (!levels) return;
      const name = this.names.get(wisher);
      const level = region.character(wisher)?.creatorLevel;
      if (!level) return;
      region.tell(wisher, `✦ Others love what you wished into the world. You reached Creator level ${level} and earned ${levels * CREATOR_LEVEL_FAVOR} Favor.`);
      if (name) this.onJournal?.(`${name}'s creations earned them Creator level ${level}.`, wisher);
    }));
  }

  /** Sends one player a message, wherever they are. */
  sendTo(playerId: string, message: ServerMessage): void {
    this.regionOf(playerId)?.send(playerId, message);
  }

  get home(): RegionHandle {
    return this.regions.get(WORLD_REGIONS[0]!.id)!;
  }

  region(id: string): RegionHandle | undefined {
    return this.regions.get(id);
  }

  /** A region running in this process, for tests and tools that reach into the simulation. */
  local(id: string): Region | undefined {
    const region = this.regions.get(id);
    return region instanceof Region ? region : undefined;
  }

  regionOf(playerId: string): RegionHandle | undefined {
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
      void settle(previous.remove(info.id, `${info.name} left.`), (left) => left?.conn.close('Signed in from another window.'));
    }
    const region = this.regions.get(saved.regionId) ?? this.home;
    this.where.set(info.id, region.def.id);
    this.names.set(info.id, info.name);
    region.join(info, conn, saved, character);
    this.partyChanged(info.id);
    this.stateChanged();
  }

  /** Takes a player out of the world; where they were comes back at once, or after their region server answers. */
  leave(playerId: string): Place | undefined | Promise<Place | undefined> {
    const region = this.regionOf(playerId);
    if (!region) return undefined;
    this.where.delete(playerId);
    this.moving.delete(playerId);
    const left = settle(region.remove(playerId), (l) => l && { id: playerId, regionId: region.def.id, x: l.x, y: l.y, character: l.character });
    this.partyChanged(playerId);
    this.stateChanged();
    return left;
  }

  handle(playerId: string, message: ClientMessage): void {
    if (message.t === 'party') return this.partyAction(playerId, message);
    // On the way to another region: the step is dropped, and the player's own screen catches up from the last one applied.
    if (this.moving.has(playerId)) return;
    this.regionOf(playerId)?.handle(playerId, message);
  }

  /** A change to an online player's character, wherever they are; false when they are not online. */
  change(playerId: string, op: CharacterOp): OpResult | Promise<OpResult> {
    return this.regionOf(playerId)?.change(playerId, op) ?? { ok: false };
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
  route(message: ChatMessage, to?: string): string | void {
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
    this.stateChanged();
  }

  /** Ticks every region here, then moves players who walked off an open edge or fell. Regions on region servers tick there. */
  tick(): void {
    for (const region of this.regions.values()) {
      for (const departure of region.tick()) this.depart(region, departure);
    }
  }

  /** Players a region server let go of: they walked off an edge or fell there. */
  departed(regionId: string, list: (Departure & { x: number; y: number })[]): void {
    const region = this.regions.get(regionId);
    if (!region) return;
    for (const d of list) {
      if (!region.has(d.id)) continue;
      (region as { moved?: (id: string, x: number, y: number) => void }).moved?.(d.id, d.x, d.y);
      this.depart(region, d);
    }
  }

  /**
   * Moves a player who fell to the shrine, or who walked off an edge into
   * the region beyond. Between regions in this process it happens at once;
   * a region server is asked to let the player go first.
   */
  private depart(region: RegionHandle, departure: Departure): void {
    const id = departure.id;
    if (this.moving.has(id) || this.where.get(id) !== region.def.id) return;
    const name = region.nameOf(id) ?? 'Someone';
    if (departure.died) {
      // Respawn at the shrine, Weakened for a while; nothing is lost.
      this.moving.add(id);
      this.track(settle(region.remove(id, `${name} fell in ${region.def.name}.`), (fallen) => {
        this.moving.delete(id);
        if (!fallen || this.where.get(id) !== region.def.id) return;
        const home = this.home;
        fallen.character.hp = maxHp(fallen.character);
        fallen.character.weakenedUntil = this.now() + WEAKENED_MS;
        this.where.set(id, home.def.id);
        home.join(fallen.info, fallen.conn, home.map.spawn, fallen.character, `${name} woke at the shrine of ${home.def.name}.`);
        this.partyChanged(id);
        fallen.conn.send({ t: 'notice', text: `You fell, and woke at the shrine. You are Weakened for ${WEAKENED_MS / 1000} seconds.` });
      }));
      return;
    }
    const target = this.regions.get(region.def.exits[departure.side] ?? '');
    // Keep the player's place along the edge, so crossing feels like one more step.
    const at = region.position(id);
    const arrival = target && at && arrivalPoint(target.map, departure.side, at);
    if (!target || !arrival) return;
    this.moving.add(id);
    this.track(settle(region.remove(id, `${name} set off for ${target.def.name}.`), (moving) => {
      this.moving.delete(id);
      if (!moving || this.where.get(id) !== region.def.id) return;
      // The region beyond may itself have moved host meanwhile.
      const beyond = this.regions.get(target.def.id) ?? this.home;
      this.where.set(id, beyond.def.id);
      beyond.join(moving.info, moving.conn, arrival, moving.character, `${name} arrived from ${region.def.name}.`, moving.carry);
      this.onEvent?.('enter', id, { region: beyond.def.id });
      // Walking into a wished region earns its wisher Creator XP.
      this.creatorCredit(beyond.def.id, id, 'visit');
      this.partyChanged(id);
    }));
  }

  /** Keeps a move under way until it settles, so closing can wait for it. */
  private track(value: unknown): void {
    if (!(value instanceof Promise)) return;
    const p = value.catch((err) => console.error('Moving a player failed:', err)).finally(() => this.pending.delete(p));
    this.pending.add(p);
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

/** Runs `then` on a value now, or once it arrives when a region server has to answer first. */
export function settle<T, R>(value: T | Promise<T>, then: (value: T) => R): R | Promise<R> {
  return value instanceof Promise ? value.then(then) : then(value);
}

/** Everyone in a region, taken out quietly to be put back elsewhere. */
async function takeAll(region: RegionHandle, gone: boolean): Promise<Leaving[]> {
  const remote = region as { drop?: (reachable: boolean) => Promise<Leaving[]> };
  if (remote.drop) return remote.drop(!gone);
  const leaving: Leaving[] = [];
  for (const id of region.playerIds()) {
    const left = await region.remove(id, '');
    if (left) leaving.push(left);
  }
  return leaving;
}

