// A region server (npm run region-server): runs the regions the game server
// gives it, reached through Redis at REDIS_URL. Start as many as you like,
// on this machine or others sharing the Redis; the game server spreads the
// regions over them and takes them back if one stops (docs/scale.md).

import { RedisBus } from './bus.ts';
import { connectRedis } from './redis.ts';
import { RegionServer } from './region-server.ts';

const url = process.env.REDIS_URL;
if (!url) {
  console.error('A region server needs REDIS_URL, the Redis the game server uses (docs/scale.md).');
  process.exit(1);
}
const redis = await connectRedis(url).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
const bus = new RedisBus(redis);
const server = new RegionServer({ bus });
await server.start();
console.log(`Region server ${server.id} is waiting for regions from the game server.`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    // Saying goodbye lets the game server take the regions back at once.
    await server.stop();
    await bus.close();
    redis.disconnect();
    process.exit(0);
  });
}
