import { parentPort, workerData } from 'node:worker_threads';
import { drawHouse, type HouseJob } from './house-build.ts';

// Draws one kit house away from the game's own thread: a few seconds of
// arithmetic that players should not feel.

parentPort!.postMessage(await drawHouse(workerData as HouseJob));
