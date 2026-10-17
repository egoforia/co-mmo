import { normalMapOf } from './relief.ts';

// Works out normal maps away from the game's own thread, so a big picture
// never makes the game stutter. Takes a picture, hands back its map.

/** A picture to work out, and the map handed back for it. */
export interface ReliefJob {
  id: number;
  picture: ImageBitmap;
}

self.onmessage = (event: MessageEvent<ReliefJob>) => {
  const { id, picture } = event.data;
  const { width: w, height: h } = picture;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(picture, 0, 0);
  picture.close();
  ctx.putImageData(new ImageData(normalMapOf(ctx.getImageData(0, 0, w, h).data, w, h), w, h), 0, 0);
  const map = canvas.transferToImageBitmap();
  (self as unknown as Worker).postMessage({ id, picture: map } satisfies ReliefJob, [map]);
};
