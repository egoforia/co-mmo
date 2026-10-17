import {
  SHOPS,
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
  type NpcPlacement,
  type ServerMessage,
} from '@co-mmo/shared';
import type { Bodies } from './bodies.ts';
import { TILE_NAMES } from '../region.ts';
import type { PlayerState, RegionState } from './state.ts';

/**
 * Talking: pressing E by an NPC (their words, quests to take and hand in, a
 * shop), by a body (its loot), or by the land (an event for scripted rules).
 */
export class Quests {
  constructor(
    private readonly s: RegionState,
    private readonly looting: Bodies,
  ) {}

  /** Pressing E: an NPC close by talks, else a body is searched, else the land is acted on. */
  interact(p: PlayerState): void {
    let npc: NpcPlacement | undefined;
    let best = TALK_RANGE;
    for (const n of this.s.townsfolk) {
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
      const spot = this.s.nearestTile(p.x, p.y, [Tile.Water, Tile.Tree, Tile.Rock], 1.6);
      const tile = spot ? spot.tile : tileAt(this.s.map, p.x, p.y);
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
      const handIn = def.goal.kind === 'talk' ? def.goal.npc === npc.id : def.giver === npc.id && questComplete(q);
      if (handIn) {
        const levels = completeQuest(ch, q);
        this.s.notice(p, `Quest complete: ${def.title}. You received ${rewardText(q.id)}.`);
        this.s.levelUps(p, levels);
        p.dirty = true;
        text = def.thanks;
        break;
      }
      if (def.giver === npc.id && def.goal.kind === 'defeat') text = def.waiting;
    }

    const offer = questOffered(ch, npc.id);
    const message: ServerMessage = {
      t: 'dialogue',
      npc: { id: npc.id, name: npc.name, asset: npc.asset },
      text: [text, offer && QUESTS[offer]!.offer].filter(Boolean).join('\n\n') || NPC_GREETINGS[npc.id] || '...',
    };
    if (offer) message.offer = { quest: offer, title: QUESTS[offer]!.title, reward: rewardText(offer) };
    if (SHOPS[npc.id]) message.shop = true;
    p.conn.send(message);
  }

  /** Takes a quest the NPC beside the player offers. */
  accept(p: PlayerState, questId: string): void {
    const def = QUESTS[questId];
    if (!def || questOffered(p.character, def.giver) !== questId) return;
    const giver = this.s.map.npcs.find((n) => n.id === def.giver);
    if (!giver || Math.hypot(giver.x - p.x, giver.y - p.y) > TALK_RANGE + 1) return;
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
      if (q.count === goal.count) this.s.notice(p, `${QUESTS[q.id]!.title}: done! Return to ${npcName(QUESTS[q.id]!.giver)}.`);
    }
  }
}
