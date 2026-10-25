import { Worker } from 'node:worker_threads';

// The kit's heavy arithmetic (reading a painted sheet, drawing a house) runs
// in a worker thread, so the game keeps its pace meanwhile. Run in the game's
// own thread instead, it holds up every request and the game for many
// seconds at a time, so a worker that cannot start is said out loud.

/** Loads the worker module through tsx: Node 20 cannot read TypeScript on its own, nor pass tsx on to a worker. */
const START = new URL('./ts-worker.mjs', import.meta.url);

let warned = false;

/**
 * Runs the worker module at `url` on `data` and resolves with the first
 * message it posts; runs `here` in this thread instead when the worker
 * fails, and says once why the game may stall meanwhile.
 */
export async function offThread<T>(url: URL, data: unknown, here: () => Promise<T>): Promise<T> {
  try {
    return await new Promise<T>((ok, fail) => {
      const worker = new Worker(START, { argv: [url.href], execArgv: [], workerData: data });
      worker.once('message', ok);
      worker.once('error', fail);
      worker.once('exit', (code) => fail(new Error(`The worker stopped early (${code}).`)));
    });
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(`Building work could not start in a worker thread (${(err as Error).message}), so it runs in the game's own thread: the game and God's View may stall while building sheets are checked and houses drawn.`);
    }
    return here();
  }
}
