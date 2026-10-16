import { describe, expect, it } from 'vitest';
import { FLAME_LIGHT } from '@co-mmo/shared';
import { OfflineGod } from '../src/god.ts';

/** What the offline God offers for a wish. */
async function offer(said: string) {
  const reply = await new OfflineGod().complete({ system: '', messages: [{ role: 'user', content: said }] } as never);
  return JSON.parse(reply.text).wish.definition;
}

describe('the offline God and light', () => {
  it('lights a sword on fire and a torch', async () => {
    expect((await offer('I wish for a sword on fire')).light).toEqual(FLAME_LIGHT);
    expect((await offer('I wish for a torch')).light).toEqual(FLAME_LIGHT);
  });

  it('leaves plain gear unlit', async () => {
    expect((await offer('I wish for a sword')).light).toBeUndefined();
  });
});
