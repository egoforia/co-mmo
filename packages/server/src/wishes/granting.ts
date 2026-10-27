import {
  ABILITIES,
  ITEMS,
  SLEEPING_ABILITIES,
  WishError,
  applyContent,
  standing,
  lookFromWords,
  regionFromWish,
  removeContent,
  validateLoot,
  wishArtKey,
  type ContentEntry,
  type RaceId,
} from '@co-mmo/shared';
import type { LiveRules } from '../live-rules.ts';
import type { ContentRecord, Store } from '../store.ts';
import type { World } from '../world.ts';
import type { RuleDrafts } from './drafting.ts';
import { newWishId, publicEntry, type WishNews } from './news.ts';
import type { WishPainter } from './painter.ts';

/**
 * What a wish does to the world once it stands: putting it in (at start-up
 * and when granted), the Stewards' review, the free wishes (a new player's
 * look, the Loot tab), and undoing it.
 */
export class Granting {
  constructor(
    private readonly store: Store,
    private readonly world: World,
    private readonly rules: LiveRules,
    private readonly painter: WishPainter,
    private readonly drafts: RuleDrafts,
    private readonly news: WishNews,
    private readonly now: () => number,
  ) {}

  /** Puts every granted wish back into the world (at start-up). */
  restore(): void {
    for (const record of this.store.content) {
      this.apply(record);
      if (!standing(record)) continue;
      this.place(record);
      if (record.definition?.kind === 'rule') {
        this.rules.start(record).catch((err) => console.error(`Rule ${record.id} did not load:`, (err as Error).message));
      }
    }
    // A draft interrupted by a restart can be asked for again.
    for (const record of this.store.content) {
      if (record.draft?.state === 'drafting') this.store.updateContent(record.id, { draft: { ...record.draft, state: 'failed', message: 'The server restarted while drafting. Ask the God to revise.' } });
    }
  }

  /** The content log as players see it. */
  entries(): ContentEntry[] {
    return this.store.content.map(publicEntry);
  }

  // --- A player's look ------------------------------------------------------------

  /** The player's look wish, while it stands. */
  lookOf(playerId: string): ContentRecord | undefined {
    // A look changed in the Workshop replaces the older one; rolling it back brings the older one back.
    return [...this.store.content].reverse().find((c) => c.definition?.kind === 'player' && c.wisher.id === playerId && standing(c));
  }

  /**
   * A new player describes how they look: their first wish, free, granted at
   * once and painted like any wished thing. A Steward can roll it back, and
   * then the player may describe themself again. The people, when given,
   * decides the body the painter draws. Throws a WishError.
   */
  grantLook(player: { id: string; name: string }, words: string, race?: RaceId): ContentRecord {
    if (this.lookOf(player.id)) throw new WishError('Your look is already chosen. Changing it later will be a wish of its own.');
    const definition = lookFromWords(player.name, words, race);
    const record: ContentRecord = {
      id: newWishId(this.now()),
      wisher: { id: player.id, name: player.name },
      regionId: this.world.home.def.id,
      at: this.now(),
      tier: 'minor',
      title: `${player.name}'s look`,
      summary: definition.description,
      status: 'granted',
      favor: 0,
      definition,
      conversation: [{ role: 'user', content: words }],
      usd: 0,
    };
    this.store.addContent(record);
    this.news.broadcast(record);
    this.painter.paint(record);
    return record;
  }

  /**
   * A changed people repaints the player's look as one of them (docs/races.md,
   * Choosing): a new look entry from the same words, replacing the old one as
   * a Workshop look does. Nothing happens for a player with no look yet.
   */
  repaintLook(player: { id: string; name: string }, race: RaceId): ContentRecord | undefined {
    const old = this.lookOf(player.id);
    if (old?.definition?.kind !== 'player') return undefined;
    const before = old.definition;
    // A look made from words gets new words about the body; a Workshop look keeps its own and carries the people.
    const fromWords = lookFromWords(player.name, before.description, before.race).look.body === before.look.body;
    const definition = fromWords ? lookFromWords(player.name, before.description, race) : { ...before, race };
    const record: ContentRecord = {
      id: newWishId(this.now()),
      wisher: { id: player.id, name: player.name },
      regionId: old.regionId,
      at: this.now(),
      tier: 'minor',
      title: `${player.name}'s look`,
      summary: definition.description,
      status: 'granted',
      favor: 0,
      definition,
      conversation: [],
      usd: 0,
    };
    this.store.addContent(record);
    this.news.broadcast(record);
    this.painter.paint(record);
    return record;
  }

  /**
   * Sets a creature's whole loot from God's View. It is kept as a content
   * entry like a wish, made by `by`, so it is saved, reaches every region
   * server and can be rolled back. Throws a WishError.
   */
  setLoot(by: { id: string; name: string }, raw: unknown): ContentRecord {
    const definition = validateLoot(raw, true);
    const record: ContentRecord = {
      id: newWishId(this.now()),
      wisher: { id: by.id, name: by.name },
      regionId: this.world.home.def.id,
      at: this.now(),
      tier: 'minor',
      title: definition.name,
      summary: definition.description,
      status: 'granted',
      favor: 0,
      definition,
      godsView: true,
      conversation: [],
      usd: 0,
    };
    this.store.addContent(record);
    this.apply(record);
    this.news.broadcast(record);
    return record;
  }

  // --- Mods: switching off and on, undoing -------------------------------------

  /**
   * Switches a granted wish off or back on (design doc, Wishes as mods).
   * Off, its things leave the world and what players hold sleeps; an Engine
   * wish's code stands aside through `modOn`. Returns the record, or why not
   * in words for God's View.
   */
  switchOff(id: string, off: boolean, by: { id: string; name: string }): ContentRecord | string {
    const record = this.store.contentById(id);
    if (!record || record.status !== 'granted') return 'Only a granted wish can be switched off or on.';
    if (Boolean(record.off) === off) return off ? 'This wish is switched off already.' : 'This wish is on already.';
    if (record.build && !record.build.issue) return 'This wish changed the game before wishes became mods, so it has no switch. It can only be undone.';
    if (!off && record.definition?.kind === 'region' && record.cell && !this.world.cellFree(record.cell)) {
      return 'Another land has grown where this region stood, so it cannot come back there.';
    }
    this.store.updateContent(id, { off: off ? { by: by.name, at: this.now() } : undefined });
    this.apply(record);
    if (off) {
      this.rules.stop(id);
      if (record.definition?.kind === 'region') this.world.removeRegion(id);
      this.world.unplace(id);
      this.settleBags();
    } else {
      this.place(record);
      if (record.definition?.kind === 'rule') {
        this.rules.start(record).catch((err) => console.error(`Rule ${id} did not load:`, (err as Error).message));
      }
    }
    this.news.broadcast(record);
    if (record.wisher.id !== by.id) {
      this.news.tellWisher(record, off
        ? `Your wish "${record.title}" was switched off for now by ${by.name}. Nothing you hold is lost; it can be switched on again.`
        : `Your wish "${record.title}" is back in the world.`);
    }
    return record;
  }

  /**
   * Asks for a code change to be taken out again: a new Engine wish, "Undo:
   * <title>", that the coding agent builds like any other (a pull request the
   * Owner merges). When it goes live, the old wish is marked undone.
   */
  undoCode(id: string, by: { id: string; name: string }): ContentRecord | string {
    const record = this.store.contentById(id);
    const pr = record?.build?.pr;
    if (!record || record.status !== 'granted' || record.build?.state !== 'live' || !pr) return 'Only a code change that is live in the game can be undone this way.';
    const open = this.store.content.find((c) => c.undoes === id && (c.status === 'pending' || c.status === 'approved'));
    if (open) return `Undoing it is already asked for: "${open.title}".`;
    const undo: ContentRecord = {
      id: newWishId(this.now()),
      wisher: { id: by.id, name: by.name },
      regionId: record.regionId,
      at: this.now(),
      tier: 'engine',
      title: `Undo: ${record.title}`.slice(0, 80),
      summary: `Take out what the wish "${record.title}" added to the game in pull request #${pr.number} (${pr.url}), so the game works as it did before it, keeping everything added since.${record.mod ? ` Its code checks modOn('${record.mod}'); remove those parts.` : ''}`,
      status: 'pending',
      favor: 0,
      undoes: id,
      conversation: [],
      usd: 0,
    };
    this.store.addContent(undo);
    this.news.broadcast(undo);
    return undo;
  }

  /** Has every bag, body and spellbook catch up with a wish leaving: gone for good, or asleep. */
  private settleBags(): void {
    for (const region of this.world.regions.values()) {
      for (const playerId of region.playerIds()) {
        const c = region.character(playerId);
        if (!c) continue;
        const worn = Object.entries(c.equipment).some(([slot, item]) => item && ITEMS[item]?.slot !== slot);
        if (worn || c.inventory.some((s) => !ITEMS[s.item]) || c.abilities.some((a) => !ABILITIES[a] && !SLEEPING_ABILITIES.has(a))) {
          void region.change(playerId, { op: 'forget' });
        }
      }
    }
  }

  // --- Undo, review, art -------------------------------------------------------

  /** Undoes a granted wish everywhere (God's View, content log). */
  rollback(id: string): ContentRecord | undefined {
    const record = this.store.contentById(id);
    // A code change is undone by reverting its pull request, not from here.
    if (!record || record.status !== 'granted' || record.build) return undefined;
    this.store.updateContent(id, { status: 'rolled-back' });
    this.unapply(record);
    this.rules.stop(id);
    if (record.definition?.kind === 'region') this.world.removeRegion(id);
    this.world.unplace(id);
    this.settleBags();
    this.news.broadcast(record);
    return record;
  }

  /**
   * A Steward or the Owner decided a major or engine wish. Approving a Major
   * wish with a drafted rule that passed its test run puts the rule into the
   * world at once; other approved wishes wait for people to build them.
   */
  async review(id: string, approve: boolean): Promise<{ record: ContentRecord } | { error: string; message: string }> {
    const record = this.store.contentById(id);
    // A build that failed can still be given up on.
    const failedBuild = record?.status === 'approved' && record.build?.state === 'failed' && !approve;
    if (!record || (record.status !== 'pending' && !failedBuild)) return { error: 'not_pending', message: 'This wish is not waiting for review.' };
    if (approve && record.definition?.kind === 'rule') {
      if (this.drafts.busy(id)) return { error: 'drafting', message: 'The God is still drafting this rule.' };
      if (!record.test?.passed) return { error: 'untested', message: 'This rule has not passed its test run. Ask the God to revise it, or reject it.' };
      return this.grantRule(record);
    }
    this.store.updateContent(id, { status: approve ? 'approved' : 'rejected' });
    this.news.broadcast(record);
    this.world.sendTo(record.wisher.id, {
      t: 'god',
      say: approve
        ? record.tier === 'engine'
          ? `Your wish "${record.title}" was approved. It will be built into the game, and you will hear when it is live.`
          : `Your wish "${record.title}" was approved. It will be built for the world.`
        : `Your wish "${record.title}" was not approved this time.`,
    });
    return { record };
  }

  /**
   * One step of a wish too big for one code change, recorded as its own
   * Engine wish for the Owner to approve.
   */
  addStep(from: ContentRecord, title: string, summary: string): ContentRecord {
    const record: ContentRecord = {
      id: newWishId(this.now()),
      wisher: from.wisher,
      regionId: from.regionId,
      at: this.now(),
      tier: 'engine',
      title: title.slice(0, 80),
      summary,
      status: 'pending',
      favor: 0,
      conversation: from.conversation,
      usd: 0,
    };
    this.store.addContent(record);
    this.news.broadcast(record);
    return record;
  }

  private async grantRule(record: ContentRecord): Promise<{ record: ContentRecord } | { error: string; message: string }> {
    const def = record.definition;
    if (def?.kind !== 'rule') return { error: 'not_rule', message: 'This wish has no rule.' };
    const summary = record.summary;
    // The Chronicle shows what was made, not the words of the wish.
    this.store.updateContent(record.id, { status: 'granted', summary: def.description || summary, rule: { paused: false } });
    this.apply(record);
    try {
      await this.rules.start(record);
    } catch (err) {
      this.store.updateContent(record.id, { status: 'pending', summary, test: { ...record.test!, passed: false, errors: [(err as Error).message] } });
      this.unapply(record);
      this.news.changed(record.id);
      return { error: 'load_failed', message: `The rule did not load: ${(err as Error).message}` };
    }
    this.news.broadcast(record);
    this.world.broadcast({ t: 'system', text: `✦ The God granted ${record.wisher.name}'s wish: ${def.name}. ${def.howTo}`, at: this.now() });
    this.world.sendTo(record.wisher.id, { t: 'god', say: `Your wish "${record.title}" is now part of the world. ${def.howTo}` });
    this.rules.greet(record.id);
    this.painter.paint(record);
    return { record };
  }


  // --- Plumbing --------------------------------------------------------------

  /** Makes a wish's things exist here and on every region server, before anything is placed. */
  apply(record: ContentRecord): void {
    applyContent(publicEntry(record));
    this.world.contentChanged([publicEntry(record)]);
  }

  unapply(record: ContentRecord): void {
    removeContent(record);
    this.world.contentChanged([publicEntry(record)]);
  }

  place(record: ContentEntry): void {
    const def = record.definition;
    if (def?.kind === 'region') {
      const land = regionFromWish(record);
      if (land && !this.world.addRegion(land)) console.error(`Region ${record.id} could not be placed: its square is taken.`);
      return;
    }
    if (!def || !record.placements) return;
    if (def.kind === 'creature') this.world.placeCreatures(record.regionId, record.id, record.placements);
    if (def.kind === 'npc') {
      const at = record.placements[0]!;
      this.world.placeNpc(record.regionId, { id: record.id, name: def.name, asset: wishArtKey(record.id), x: at.x, y: at.y });
    }
  }
}
