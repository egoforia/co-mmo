import type { ClientMessage, ServerMessage } from '@co-mmo/shared';

/** How often the browser says which snapshot it has, ms (SeenMessage). */
export const SEEN_EVERY_MS = 250;

export type MessageHandler = (message: ServerMessage) => void;

/** The game WebSocket: signs in with the session token, then relays messages. */
export class GameConnection {
  private socket: WebSocket;
  /** Everything received so far, for the performance overlay: messages, their size in characters, and snapshots among them. */
  readonly received = { messages: 0, bytes: 0, snapshots: 0, skipped: 0 };
  /** The last hundred times between snapshots arriving, ms: how evenly the network brings them. */
  readonly snapshotGaps: number[] = [];
  private lastSnapshotAt = 0;
  private lastSeenSent = 0;

  constructor(token: string, onMessage: MessageHandler, onClose: (reason: string, code: number) => void) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${scheme}://${location.host}/ws`);
    this.socket.addEventListener('open', () => this.socket.send(JSON.stringify({ t: 'hello', token })));
    this.socket.addEventListener('message', (event) => {
      const data = event.data as string;
      this.received.messages++;
      this.received.bytes += data.length;
      try {
        const message = JSON.parse(data) as ServerMessage;
        if (message.t === 'snapshot') this.snapshotArrived(message.tick, message.skipped ?? 0);
        onMessage(message);
      } catch (err) {
        console.error('Bad server message', err);
      }
    });
    this.socket.addEventListener('close', (event) => onClose(event.reason, event.code));
  }

  private snapshotArrived(tick: number, skipped: number): void {
    this.received.snapshots++;
    this.received.skipped += skipped;
    const now = performance.now();
    // Tell the server what we have, a few times a second, so it can stop queueing snapshots when we fall behind.
    if (now - this.lastSeenSent >= SEEN_EVERY_MS) {
      this.lastSeenSent = now;
      this.send({ t: 'seen', tick });
    }
    if (this.lastSnapshotAt) this.snapshotGaps.push(now - this.lastSnapshotAt);
    if (this.snapshotGaps.length > 100) this.snapshotGaps.shift();
    this.lastSnapshotAt = now;
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
