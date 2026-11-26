import { FLAME_LIGHT, PREVIEW_HOURS, lampOn, lightGlow, lightOn, skyFill, skyTint, sunAt } from '@co-mmo/shared';

// How a picture looks in the game's light, for the Art tab: lit at dawn,
// midday, dusk and night, and by a lantern at night, from its normal map,
// with the same sums the game's shader uses (lighting.ts). Pictures are
// painted light-neutral, so this is where their light can be judged.

/** Previews are drawn this wide at most, so they come quickly. */
const PREVIEW_WIDTH = 220;

/** A picture's pixels at preview size. */
async function pixels(url: string, width?: number, height?: number): Promise<ImageData> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const w = width ?? Math.min(PREVIEW_WIDTH, img.naturalWidth);
  const h = height ?? Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

const channels = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** One picture lit at `hour` (and by a lantern when asked), from its normal map: the sums the game's shader uses. */
export function litPixels(picture: ImageData, normals: ImageData, hour: number, lantern: boolean, figure: boolean): ImageData {
  const { width: w, height: h } = picture;
  const lamp = channels(Number.parseInt(FLAME_LIGHT.color.slice(1), 16));
  const phase = hour / 24;
  const sky = channels(skyTint(0xffffff, phase, 'clear'));
  const sun = sunAt(phase);
  const fill = skyFill();
  const lit = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const n: [number, number, number] = [normals.data[o]! / 127.5 - 1, normals.data[o + 1]! / 127.5 - 1, normals.data[o + 2]! / 127.5 - 1];
      const light = lightOn(n, sky, sun, fill, figure);
      // The lantern stands at the picture's lower left, a little in front.
      if (lantern) {
        const add = lampOn(n, -0.1 * w - x, y - h * 0.8, w * 1.4, lamp, lightGlow(1));
        for (let c = 0; c < 3; c++) light[c] += add[c]!;
      }
      for (let c = 0; c < 3; c++) lit.data[o + c] = picture.data[o + c]! * light[c]!;
      lit.data[o + 3] = picture.data[o + 3]!;
    }
  }
  return lit;
}

/** The light falling on flat ground at `hour`, as a colour to multiply by. */
export function groundLight(hour: number): string {
  const phase = hour / 24;
  const light = lightOn([0, 0, 1], channels(skyTint(0xffffff, phase, 'clear')), sunAt(phase), skyFill(), false);
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${c(light[0])}, ${c(light[1])}, ${c(light[2])})`;
}

/** A picture at its full size, lit at `hour`, as a canvas to draw from. */
export async function litPicture(url: string, normalUrl: string, hour: number, figure: boolean): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const picture = await pixels(url, img.naturalWidth, img.naturalHeight);
  const normals = await pixels(normalUrl, picture.width, picture.height);
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height;
  canvas.getContext('2d')!.putImageData(litPixels(picture, normals, hour, false, figure), 0, 0);
  return canvas;
}

/**
 * The picture at `url` lit at each preview hour and by a lantern at night,
 * using the normal map at `normalUrl`; `figure` adds the characters' rim
 * light. Each comes back as an address an <img> can show.
 */
export async function lightPreviews(url: string, normalUrl: string, figure: boolean): Promise<{ label: string; src: string }[]> {
  const picture = await pixels(url);
  const normals = await pixels(normalUrl, picture.width, picture.height);
  const scenes = [
    ...PREVIEW_HOURS.map(({ label, hour }) => ({ label, hour, lantern: false })),
    { label: 'Night, by a lantern', hour: 23, lantern: true },
  ];
  return scenes.map((scene) => {
    const canvas = document.createElement('canvas');
    canvas.width = picture.width;
    canvas.height = picture.height;
    canvas.getContext('2d')!.putImageData(litPixels(picture, normals, scene.hour, scene.lantern, figure), 0, 0);
    return { label: scene.label, src: canvas.toDataURL('image/png') };
  });
}
