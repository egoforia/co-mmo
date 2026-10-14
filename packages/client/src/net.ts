import type { ClientMessage, ServerMessage } from '@co-mmo/shared';

export type MessageHandler = (message: ServerMessage) => void;

/** The game WebSocket: signs in with the session token, then relays messages. */
export class GameConnection {
  private socket: WebSocket;

  constructor(token: string, onMessage: MessageHandler, onClose: (reason: string, code: number) => void) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${scheme}://${location.host}/ws`);
    this.socket.addEventListener('open', () => this.socket.send(JSON.stringify({ t: 'hello', token })));
    this.socket.addEventListener('message', (event) => {
      try {
        onMessage(JSON.parse(event.data as string) as ServerMessage);
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
