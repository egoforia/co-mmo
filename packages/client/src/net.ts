import type { ClientMessage, ServerMessage } from '@co-mmo/shared';

export type MessageHandler = (message: ServerMessage) => void;

/** The game WebSocket: signs in with the session token, then relays messages. */
export class GameConnection {
  private socket: WebSocket;
  /** Everything received so far, for the performance overlay: messages, their size in characters, and snapshots among them. */
  readonly received = { messages: 0, bytes: 0, snapshots: 0 };

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
        if (message.t === 'snapshot') this.received.snapshots++;
        onMessage(message);
      } catch (err) {
        console.error('Bad server message', err);
      }
    });
    this.socket.addEventListener('close', (event) => onClose(event.reason, event.code));
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
