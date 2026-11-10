import { describe, expect, it } from 'vitest';
import { createServer, connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { lagProxy } from '../netbench/lag-proxy.ts';
import { smoothness } from '../netbench/bench-bot.ts';

describe('the network bench', () => {
  it('delays what passes through its pretend network but keeps it in order, as TCP does', async () => {
    const sink = createServer((socket) => socket.on('data', (chunk) => socket.write(chunk)));
    await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', resolve));
    const proxy = await lagProxy((sink.address() as AddressInfo).port, { name: 'test', delayMs: 20, jitterMs: 40 });
    const client = connect(proxy.port, '127.0.0.1');
    let got = '';
    client.on('data', (chunk) => (got += chunk.toString()));
    await new Promise<void>((resolve) => client.on('connect', () => resolve()));
    const sentAt = performance.now();
    const words = Array.from({ length: 30 }, (_, i) => `<${i}>`);
    for (const w of words) {
      client.write(w);
      await new Promise((r) => setTimeout(r, 2));
    }
    const want = words.join('');
    while (got.length < want.length) await new Promise((r) => setTimeout(r, 5));
    expect(got).toBe(want);
    // There and back: at least the delay each way.
    expect(performance.now() - sentAt).toBeGreaterThanOrEqual(40);
    expect(proxy.counts.down).toBe(want.length);
    client.destroy();
    await proxy.close();
    await new Promise<void>((resolve) => sink.close(() => resolve()));
  });

  it('calls an even walk smooth, and stops and leaps uneven', () => {
    expect(smoothness([4, 4, 4, 4]).wobble).toBe(0);
    const rough = smoothness([4, 0, 8.5, 4]);
    expect(rough.wobble).toBeGreaterThan(0.5);
    expect(rough.stalls).toBe(0.25);
    expect(rough.leaps).toBe(0.25);
  });
});
