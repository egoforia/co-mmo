import { argv } from 'node:process';
import { register } from 'tsx/esm/api';

// Starts a TypeScript worker module (off-thread.ts) through tsx, so a worker
// runs on every Node the game supports: Node 20 can read TypeScript only
// through tsx, and does not pass tsx on to the threads it starts.

register();
await import(argv[2]);
