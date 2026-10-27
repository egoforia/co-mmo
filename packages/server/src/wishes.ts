import type { BiomeId, ContentEntry, PicturedWish, PlayerInfo, RaceId, WishDefinition, WishTier } from '@co-mmo/shared';
import type { ChatTurn } from './ai/chat.ts';
import type { AiServices, ServiceOverrides } from './ai/services.ts';
import type { Budget } from './budget.ts';
import type { ArtJobs } from './art-jobs.ts';
import type { Recipe, RecipeBook } from './art-recipes.ts';
import type { PaintRequest, PaintRequests } from './paint-requests.ts';
import type { GodReply, WorkshopContext, WorkshopReply } from './god.ts';
import type { LiveRules } from './live-rules.ts';
import type { ContentRecord, Store } from './store.ts';
import type { World } from './world.ts';
import { WishCards, type ShapedWish } from './wishes/cards.ts';
import { RuleDrafts } from './wishes/drafting.ts';
import { Granting } from './wishes/granting.ts';
import { WishNews } from './wishes/news.ts';
import { WishPainter, type PaintedSample } from './wishes/painter.ts';
import { Prayers } from './wishes/prayers.ts';

export { publicEntry } from './wishes/news.ts';
export type { PaintedSample } from './wishes/painter.ts';
export type { ShapedWish } from './wishes/cards.ts';

/** What wishes need from the rest of the server. */
export interface WishServices {
  ai: AiServices;
  budget: Budget;
  /** The painting log God's View shows. */
  artJobs?: ArtJobs;
  /** Wish paintings kept across a restart until they are done. */
  paintRequests?: PaintRequests;
  /** Keeps what was sent to make each picture, for God's View. */
  recipes?: RecipeBook;
}

/** Where wish art lives, plus test stand-ins for the AI services (passed on to AiServices). */
export interface WishOptions extends Pick<ServiceOverrides, 'chatModel' | 'compilerModel' | 'imageProvider' | 'judgeModel'> {
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Where approved anchors live (style references for wished art). */
  anchorDir: string;
  /** Where painted wish art is written; served at /wished-art/. */
  artDir: string;
}

/**
 * The God's side of the game, as one face for the rest of the server: it
 * builds the parts in `wishes/` and passes each call to the part that owns
 * it. Prayers talk to the God, WishCards turn answers into wishes, Granting
 * puts them into the world and takes them out, RuleDrafts writes scripted
 * rules, WishPainter paints what was wished, and WishNews tells people.
 */
export class Wishes {
  private readonly news: WishNews;
  private readonly painter: WishPainter;
  private readonly rulesDrafts: RuleDrafts;
  private readonly granting: Granting;
  private readonly cards: WishCards;
  private readonly prayers: Prayers;

  constructor(store: Store, world: World, rules: LiveRules, options: WishOptions, services: WishServices) {
    const now = options.now ?? Date.now;
    this.news = new WishNews(store, world);
    this.painter = new WishPainter({ store, ai: services.ai, budget: services.budget, news: this.news, now, options, artJobs: services.artJobs, paintRequests: services.paintRequests, recipes: services.recipes });
    this.rulesDrafts = new RuleDrafts(store, services.ai, services.budget, this.news, now);
    this.granting = new Granting(store, world, rules, this.painter, this.rulesDrafts, this.news, now);
    this.cards = new WishCards(store, world, this.granting, this.painter, this.rulesDrafts, this.news, now);
    this.prayers = new Prayers(store, world, services.ai, services.budget, this.cards, this.news, now);
  }

  /** Art being painted, so tests and shutdown can wait for it. */
  get painting(): Set<Promise<void>> {
    return this.painter.painting;
  }

  /** Rule drafts in flight, so tests and shutdown can wait for them. */
  get drafts(): Set<Promise<unknown>> {
    return this.rulesDrafts.drafts;
  }

  /** Told when a confirmed card became a wish (granted or sent for review), so its Workshop draft can go. */
  set onCardUsed(listener: ((playerId: string, cardId: string) => void) | undefined) {
    this.cards.onCardUsed = listener;
  }

  get onCardUsed(): ((playerId: string, cardId: string) => void) | undefined {
    return this.cards.onCardUsed;
  }

  // --- Talking to the God ------------------------------------------------------

  /** A player's prayer. */
  pray(player: PlayerInfo, raw: string): Promise<void> {
    return this.prayers.pray(player, raw);
  }

  /** One God turn about a Workshop draft, or what to tell the player instead. */
  consult(player: PlayerInfo, w: WorkshopContext, history: ChatTurn[]): Promise<{ reply: WorkshopReply } | { refused: string }> {
    return this.prayers.consult(player, w, history);
  }

  /** The player's open wish card from Talk and the talk that led to it. */
  talkOf(playerId: string): { wish?: { tier: WishTier; definition?: WishDefinition }; conversation: ChatTurn[] } {
    return this.prayers.talkOf(playerId);
  }

  // --- Cards -------------------------------------------------------------------

  /** The card a wish would make, without offering it, or why it cannot be made here. */
  cardFor(
    playerId: string,
    wish: Pick<NonNullable<GodReply['wish']>, 'tier' | 'title' | 'summary' | 'definition'>,
    regionName: string,
    look = false,
  ): ReturnType<WishCards['cardFor']> {
    return this.cards.cardFor(playerId, wish, regionName, look);
  }

  /** Offers a wish shaped in the Workshop as the usual card. Returns the card's id when one was made. */
  offer(
    player: PlayerInfo,
    wish: Pick<NonNullable<GodReply['wish']>, 'tier' | 'title' | 'summary' | 'definition'>,
    conversation: ChatTurn[],
    say: string,
    extra?: ShapedWish,
  ): string | undefined {
    return this.cards.offer(player, wish, conversation, say, extra);
  }

  /** The player confirmed or turned down a wish card. */
  answer(player: PlayerInfo, cardId: string, confirm: boolean): void {
    this.cards.answer(player, cardId, confirm);
  }

  // --- Wishes in the world -------------------------------------------------------

  /** Puts every granted wish back into the world (at start-up). */
  restore(): void {
    this.granting.restore();
  }

  /** The content log as players see it. */
  entries(): ContentEntry[] {
    return this.granting.entries();
  }

  /** The player's look wish, while it stands. */
  lookOf(playerId: string): ContentRecord | undefined {
    return this.granting.lookOf(playerId);
  }

  /** A new player's free first wish: how they look. Throws a WishError. */
  grantLook(player: { id: string; name: string }, words: string, race?: RaceId): ContentRecord {
    return this.granting.grantLook(player, words, race);
  }

  /** Sets a creature's whole loot from God's View. Throws a WishError. */
  setLoot(by: { id: string; name: string }, raw: unknown): ContentRecord {
    return this.granting.setLoot(by, raw);
  }

  /** Undoes a granted wish everywhere. */
  rollback(id: string): ContentRecord | undefined {
    return this.granting.rollback(id);
  }

  /** Switches a granted wish off or back on; returns the record, or why not. */
  switchOff(id: string, off: boolean, by: { id: string; name: string }): ContentRecord | string {
    return this.granting.switchOff(id, off, by);
  }

  /** Asks for a live code change to be taken out again, as a new Engine wish; returns it, or why not. */
  undoCode(id: string, by: { id: string; name: string }): ContentRecord | string {
    return this.granting.undoCode(id, by);
  }

  /** A Steward or the Owner decided a major or engine wish. */
  review(id: string, approve: boolean): Promise<{ record: ContentRecord } | { error: string; message: string }> {
    return this.granting.review(id, approve);
  }

  /** One step of a wish too big for one code change, as its own Engine wish. */
  addStep(from: ContentRecord, title: string, summary: string): ContentRecord {
    return this.granting.addStep(from, title, summary);
  }

  /** Drafts (or revises, with a Steward's note) a Major wish's scripted rule. */
  draft(id: string, note?: string): Promise<ContentRecord | undefined> {
    return this.rulesDrafts.draft(id, note);
  }

  // --- Wish art ------------------------------------------------------------------

  /** Paints a granted wish's art when a provider is set and the budget allows. */
  paint(record: ContentRecord, force = false, prompts: Record<string, string> = {}, only?: string): Promise<void> | undefined {
    return this.painter.paint(record, force, prompts, only);
  }

  /** Paints a Workshop sample of a draft's picture for a player. */
  paintSample(playerId: string, def: PicturedWish, biome: BiomeId): Promise<PaintedSample | undefined> {
    return this.painter.paintSample(playerId, def, biome);
  }

  /** Tells players a wish's picture file changed on disk. False when it has no such picture. */
  touchArt(recordId: string, pictureId: string): boolean {
    return this.painter.touchArt(recordId, pictureId);
  }

  /** Paints a wish's pictures again after a restart cut their painting short. */
  resumePaint(request: Extract<PaintRequest, { kind: 'wish' }>): void {
    this.painter.resumePaint(request);
  }

  /** Exactly what painting one of a wish's pictures again would send, without painting it. */
  preview(record: ContentRecord, pictureId: string, prompt?: string): Promise<Recipe> {
    return this.painter.preview(record, pictureId, prompt);
  }

  /** Painted kit art for every biome painted so far. */
  kitManifest(): Promise<Record<string, { file: string; kind: string; width: number; height: number }>> {
    return this.painter.kitManifest();
  }

  /** Paints whatever granted wishes still lack, now that the budget allows. */
  paintMissing(): void {
    this.painter.paintMissing();
  }

  // --- Telling people ----------------------------------------------------------------

  /** Tells every client a wish's progress changed. */
  changed(id: string): void {
    this.news.changed(id);
  }

  /** A line to the wisher, if they are online. */
  tellWisher(record: ContentRecord, text: string): void {
    this.news.tellWisher(record, text);
  }

  /** A line for every Steward and the Owner who is online. */
  notifyStewards(text: string): void {
    this.news.notifyStewards(text);
  }
}
