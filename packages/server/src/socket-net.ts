import type { PerMessageDeflateOptions } from 'ws';

// How the game's WebSocket uses the network (docs/scale.md, Smooth play on
// any connection). Each part can be switched off in .env, to compare or in
// case a player's network does not get on with it.

/** Network choices for the game socket. */
export interface NetOptions {
  /** Compress what goes to players (NET_COMPRESS=off turns it off). */
  compress: boolean;
}

/** The choices from the environment: everything on unless set to `off`. */
export function netFromEnv(env: Record<string, string | undefined>): NetOptions {
  const on = (name: string) => env[name]?.trim().toLowerCase() !== 'off';
  return { compress: on('NET_COMPRESS') };
}

/**
 * WebSocket compression (permessage-deflate), which every browser offers.
 * Snapshots repeat the same names, pictures and numbers tick after tick, so
 * compressing the stream (each message using the ones before it) leaves about
 * a twentieth of it. Tuned for many players: a smaller window and memory per
 * connection, quick compression, nothing kept between the browser's own short
 * messages, and tiny messages sent as they are.
 */
export function deflateOptions(): PerMessageDeflateOptions {
  return {
    zlibDeflateOptions: { level: 3, memLevel: 7 },
    serverMaxWindowBits: 13,
    clientNoContextTakeover: true,
    threshold: 128,
  };
}
