import { parentPort, workerData } from 'node:worker_threads';
import { readImg } from './pixels.ts';
import { checkSheet } from './sheet-checks.ts';
import type { SheetLayout } from './sheet.ts';

// Checks one painted sheet away from the game's own thread: reading a sheet
// takes seconds of arithmetic, and players should not feel it.

const { file, layout } = workerData as { file: string; layout: SheetLayout };
const checked = await checkSheet(await readImg(file), layout);
parentPort!.postMessage(checked, [...new Set(Object.values(checked.textures).map((t) => t.d.buffer as ArrayBuffer))]);
