import { Redis } from 'ioredis';
import { safeUrl } from './db.ts';

/**
 * Connects to Redis at `url` (REDIS_URL), checking it answers before the game
 * starts. Later drops are reconnected by the client; each is logged once.
 */
export async function connectRedis(url: string): Promise<Redis> {
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
  let down = false;
  let ready = false;
  let first: Error | undefined;
  redis.on('error', (err: Error) => {
    first ??= err;
    if (ready && !down) console.error(`Lost Redis at ${safeUrl(url)}: ${err.message}`);
    down = true;
  });
  redis.on('ready', () => {
    if (ready && down) console.log('Redis is back.');
    ready = true;
    down = false;
  });
  try {
    await redis.connect();
    await redis.ping();
  } catch (err) {
    redis.disconnect();
    const why = (first ?? (err as Error)).message.replace(/\.$/, '');
    throw new Error(`Could not reach Redis at ${safeUrl(url)}: ${why}. Is it running? (docs/scale.md)`);
  }
  return redis;
}
