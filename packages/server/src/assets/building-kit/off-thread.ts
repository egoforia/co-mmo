import { Worker } from 'node:worker_threads';

// The kit's heavy arithmetic (reading a painted sheet, drawing a house) runs
// in a worker thread, so the game keeps its pace meanwhile.

/**
 * Runs the worker module at `url` on `data` and resolves with the first
 * message it posts; runs `here` in this thread instead when the worker
 * fails (one needs Node 22.7 or later to read TypeScript).
 */
export async function offThread<T>(url: URL, data: unknown, here: () => Promise<T>): Promise<T> {
  try {
    return await new Promise<T>((ok, fail) => {
      const worker = new Worker(url, {
        workerData: data,
        execArgv: [...process.execArgv, '--experimental-transform-types', '--disable-warning=ExperimentalWarning'],
      });
      worker.once('message', ok);
      worker.once('error', fail);
      worker.once('exit', (code) => fail(new Error(`The worker stopped early (${code}).`)));
    });
  } catch {
    return here();
  }
}
