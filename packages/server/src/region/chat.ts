import {
  MAX_CHAT_LENGTH,
  SAY_RADIUS,
  type ChatChannel,
  type ChatMessage,
} from '@co-mmo/shared';
import type { PlayerState, RegionState } from './state.ts';

/** Chat flood limit: at most this many messages per window. */
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5000;

/** Chat from a player: nearby, region, world, party and whispers, with a flood limit. */
export class Chat {
  constructor(
    private readonly s: RegionState,
  ) {}

  /** Sends a line on its channel, or tells the player why it could not go. */
  chat(from: PlayerState, channel: ChatChannel, raw: string, to?: string): void {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) return;
    const now = this.s.now();
    from.chatTimes = from.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (from.chatTimes.length >= CHAT_BURST) {
      from.conn.send({ t: 'error', code: 'chat_rate', message: 'You are speaking too fast. Wait a moment.' });
      return;
    }
    from.chatTimes.push(now);
    const message: ChatMessage = { t: 'chat', channel, from: { id: from.info.id, name: from.info.name }, text, at: now };
    if (channel === 'world') {
      this.s.hooks.worldChat(message);
      return;
    }
    if (channel === 'region') return this.s.hooks.regionChat ? this.s.hooks.regionChat(message) : this.s.broadcast(message);
    if (channel === 'party' || channel === 'whisper') {
      const why = this.s.hooks.route ? this.s.hooks.route(message, to) : 'Nobody can hear that here.';
      if (why) from.conn.send({ t: 'error', code: 'chat_undelivered', message: why });
      return;
    }
    for (const p of this.s.players.values()) {
      if (p.floor === from.floor && Math.hypot(p.x - from.x, p.y - from.y) <= SAY_RADIUS) p.conn.send(message);
    }
  }
}
