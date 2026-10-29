import {
  ABILITIES,
  SANCTUM_MENTORS,
  SHOPS,
  choosePath,
  mentorOf,
  pathChoices,
  pathOf,
  questTurnIn,
  settlePathSkills,
  NPC_GREETINGS,
  QUESTS,
  TALK_RANGE,
  completeQuest,
  npcName,
  questComplete,
  questOffered,
  rewardText,
  tileAt,
  Tile,
  type ServerMessage,
} from '@co-mmo/shared';
import type { Bodies } from './bodies.ts';
import { TILE_NAMES } from '../region.ts';
import { greetingNow, type Townsperson } from '../townsfolk.ts';
import { learnedWords, mentorWords } from './paths/words.ts';
import type { PlayerState, RegionState } from './state.ts';

/**
 * Talking: pressing E by an NPC (their words, quests to take and hand in, a
 * shop), by a body (its loot), or by the land (an event for scripted rules).
 */
export class Quests {
  constructor(
    private readonly s: RegionState,
    private readonly looting: Bodies,
    /** Where the day is now (sky.ts dayPhase). */
    private readonly phase: () => number,
  ) {}

  /** Pressing E: an NPC close by talks, else a body is searched, else the land is acted on. */
  interact(p: PlayerState): void {
    let npc: Townsperson | undefined;
    let best = TALK_RANGE;
    for (const n of this.s.townsfolk) {
      if (n.floor !== p.floor) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d <= best) {
        best = d;
        npc = n;
      }
    }
    if (npc) this.s.credit(npc.id, p, 'talk');
    if (!npc && this.looting.search(p)) return;
    if (!npc) {
      // Nobody to talk to: the player is acting on the land (fishing at water, say).
      const spot = this.s.nearestTile(p.x, p.y, [Tile.Water, Tile.Tree, Tile.Rock], 1.6, p.floor);
      const tile = spot ? spot.tile : tileAt(this.s.map, p.x, p.y, p.floor);
      const name = Object.keys(TILE_NAMES).find((k) => TILE_NAMES[k] === tile) ?? 'ground';
      this.s.hooks.event?.('interact', p.info.id, { tile: name, x: spot?.x ?? Math.floor(p.x), y: spot?.y ?? Math.floor(p.y) });
      return;
    }
    const ch = p.character;
    let text: string | undefined;

    // A talk quest that ends here, or a finished quest to hand in.
    for (const q of ch.quests) {
      const def = QUESTS[q.id];
      if (!def || q.done) continue;
      const handIn = questTurnIn(q.id) === npc.id && (def.goal.kind === 'talk' || questComplete(q, ch));
      if (handIn) {
        const levels = completeQuest(ch, q);
        this.s.notice(p, `Quest complete: ${def.title}. You received ${rewardText(q.id)}.`);
        this.s.levelUps(p, levels);
        p.dirty = true;
        text = def.thanks;
        break;
      }
      if (def.giver === npc.id && def.goal.kind !== 'talk') text = def.waiting;
    }

    // Your Calling's mentor in the Sanctum teaches again any Path skill you have forgotten.
    if (ch.calling && SANCTUM_MENTORS[ch.calling] === npc.id) {
      const again = settlePathSkills(ch);
      if (again.length) {
        this.s.notice(p, `${npc.name} teaches you ${again.map((a) => ABILITIES[a]!.name).join(' and ')} again.`);
        p.dirty = true;
      }
    }
    // A Path mentor, once the trial is done, lets you choose a Path.
    const paths = pathChoices(ch, npc.id);
    if (paths) text = [text, mentorWords(ch)].filter(Boolean).join('\n\n');

    const offer = questOffered(ch, npc.id);
    // What they are up to at this hour comes first: woken from sleep, or out gathering herbs.
    const now = greetingNow(npc, this.phase());
    const said = [text, offer && QUESTS[offer]!.offer].filter(Boolean).join('\n\n') || NPC_GREETINGS[npc.id] || '...';
    const message: ServerMessage = {
      t: 'dialogue',
      npc: { id: npc.id, name: npc.name, asset: npc.asset },
      text: now ? `${now}\n\n${said}` : said,
    };
    if (offer) message.offer = { quest: offer, title: QUESTS[offer]!.title, reward: rewardText(offer) };
    if (SHOPS[npc.id]) message.shop = true;
    if (paths?.length) message.paths = paths;
    p.conn.send(message);
  }

  /** Chooses (or changes to) a Path at the Calling's Path mentor, standing beside them. */
  choosePath(p: PlayerState, npcId: string, path: string): void {
    const ch = p.character;
    const npc = this.s.townsfolk.find((n) => n.id === npcId);
    if (!npc || npc.floor !== p.floor || Math.hypot(npc.x - p.x, npc.y - p.y) > TALK_RANGE + 1) return;
    if (!ch.calling || mentorOf(npcId) !== ch.calling) return this.s.notice(p, `${npc.name} cannot set you on a Path.`);
    const before = new Set(ch.abilities);
    const why = choosePath(ch, path);
    if (why) return this.s.notice(p, why);
    const def = pathOf(ch.calling, path)!;
    this.s.notice(p, `You walk the ${def.name} Path now.`);
    for (const id of def.skills.filter((s) => s.level <= ch.level).map((s) => s.skill)) {
      if (!before.has(id)) this.s.notice(p, learnedWords(id));
    }
    this.s.broadcastSystem(`${p.info.name} walks the ${def.name} Path.`);
    p.dirty = true;
  }

  /** Takes a quest the NPC beside the player offers. */
  accept(p: PlayerState, questId: string): void {
    const def = QUESTS[questId];
    if (!def || questOffered(p.character, def.giver) !== questId) return;
    const giver = this.s.map.npcs.find((n) => n.id === def.giver);
    if (!giver || (giver.floor ?? 0) !== p.floor || Math.hypot(giver.x - p.x, giver.y - p.y) > TALK_RANGE + 1) return;
    p.character.quests.push({ id: questId, count: 0, done: false });
    this.s.notice(p, `New quest: ${def.title}.`);
    p.dirty = true;
  }

  /** A defeat counts toward the player's defeat quests for that creature. */
  countDefeat(p: PlayerState, kind: string): void {
    for (const q of p.character.quests) {
      const goal = QUESTS[q.id]?.goal;
      if (q.done || goal?.kind !== 'defeat' || goal.creature !== kind || q.count >= goal.count) continue;
      q.count++;
      if (q.count === goal.count) this.s.notice(p, `${QUESTS[q.id]!.title}: done! Return to ${npcName(questTurnIn(q.id))}.`);
    }
  }
}
