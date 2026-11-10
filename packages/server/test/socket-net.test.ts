import { describe, expect, it } from 'vitest';
import { account, connect, start } from './helpers.ts';
import { netFromEnv } from '../src/socket-net.ts';

describe('the game socket on the network', () => {
  it('compresses what it sends to players, and NET_COMPRESS=off turns that off', async () => {
    expect(netFromEnv({})).toEqual({ compress: true });
    expect(netFromEnv({ NET_COMPRESS: 'off' }).compress).toBe(false);
    const { store, ws } = await start();
    const c = connect(ws, account(store, 'Mara').token);
    await c.waitFor((m) => m.t === 'welcome');
    expect(c.socket.extensions).toContain('permessage-deflate');
    // Snapshots still arrive whole.
    const snapshot = await c.waitFor((m) => m.t === 'snapshot');
    expect(snapshot).toMatchObject({ t: 'snapshot' });
  });

  it('sends plainly when compression is off', async () => {
    const { store, ws } = await start({ net: { compress: false } });
    const c = connect(ws, account(store, 'Mara').token);
    await c.waitFor((m) => m.t === 'welcome');
    expect(c.socket.extensions).toBe('');
  });
});
