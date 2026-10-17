import type { ReliefJob } from './relief-worker.ts';

// The normal map the game works out for a picture, made the same way here so
// the Art tab can show it (the game makes its own as it loads each picture).

let worker: Worker | undefined;
let next = 0;
const waiting = new Map<number, (map: ImageBitmap) => void>();

/** The worked-out normal map of the picture at `url`, as an address an <img> can show. */
export async function workedOutNormalMap(url: string): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const picture = await createImageBitmap(img);
  if (!worker) {
    worker = new Worker(new URL('./relief-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ReliefJob>) => {
      waiting.get(event.data.id)?.(event.data.picture);
      waiting.delete(event.data.id);
    };
  }
  const id = next++;
  const map = await new Promise<ImageBitmap>((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ id, picture } satisfies ReliefJob, [picture]);
  });
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  canvas.getContext('2d')!.drawImage(map, 0, 0);
  map.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
  if (!blob) throw new Error('The normal map could not be shown.');
  return URL.createObjectURL(blob);
}
