import sharp from 'sharp';
import type { ImageRequest } from './assets/provider.ts';
import { STYLE } from './assets/style-profile.ts';

// Painted normal maps. The game works one out for every picture by itself
// (packages/client/src/normal-maps.ts); from the Art tab the Owner can have
// the image model paint one instead, for pictures where the worked-out map
// is not good enough. It is kept beside the picture as `<picture>-normal`,
// which the game uses in place of its own.

/** The id a picture's painted normal map is kept under. */
export function normalMapId(asset: string): string {
  return `${asset}-normal`;
}

/** Shapes the image model can paint, as width over height. */
const SHAPES = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

/** The painting shape nearest a picture's. */
function shapeOf(width: number, height: number): string {
  const ratio = (s: string) => { const [w, h] = s.split(':').map(Number); return w! / h!; };
  const want = Math.log(width / height);
  return SHAPES.reduce((best, s) => (Math.abs(Math.log(ratio(s)) - want) < Math.abs(Math.log(ratio(best)) - want) ? s : best));
}

/** The words sent to paint `name`'s normal map, unless the Owner wrote their own. */
export function normalPrompt(name: string): string {
  return `${STYLE.normalMap}\nThe picture shows: ${name}.`;
}

/** What is sent to paint a picture's normal map: the words and the picture itself. */
export async function normalRequest(picture: Buffer, name: string, prompt?: string): Promise<ImageRequest> {
  const png = await sharp(picture).png().toBuffer();
  const { width = 1, height = 1 } = await sharp(png).metadata();
  return {
    prompt: prompt ?? normalPrompt(name),
    references: [{ mimeType: 'image/png', data: png }],
    labels: [name],
    edit: true,
    aspectRatio: shapeOf(width, height),
    size: Math.max(width, height) > 1024 ? '2K' : '1K',
  };
}

/** A painted normal map sized exactly over its picture, so each pixel of the map lies on its pixel. */
export async function fitNormalMap(painted: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(painted).resize(width, height, { fit: 'fill' }).removeAlpha().png().toBuffer();
}
