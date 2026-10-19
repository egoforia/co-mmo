import Phaser from 'phaser';
import type { ReliefJob } from './relief-worker.ts';

// Normal maps tell the light which way each pixel of a picture faces, so a
// lantern lights the near side of a face, a roof or a tree. Players never see
// them. Every painted picture gets one worked out from its own outline and
// shading (the Owner chose this, with painted maps from the Art tab replacing
// them): edges round away like a soft relief, light and dark paint adds the
// small bumps. Each walk frame and direction is its own painted picture, so
// each gets its own map.

/** Biggest picture worked out (pixels); bigger ones stay flat. */
const MAX_PIXELS = 3000 * 3000;
/** Pictures being worked out at once. */
const AT_ONCE = 2;

/**
 * Stand-ins to work maps out from, by picture: for pictures whose see-through
 * edges are not outlines (the diamond ground tiles), the same paint running
 * on past those edges, so the map has no rim.
 */
const standIns = new WeakMap<object, HTMLCanvasElement>();

/** Works `picture`'s normal map out from `standIn`, the same paint without its see-through edges. */
export function reliefFrom(picture: HTMLCanvasElement, standIn: HTMLCanvasElement): void {
  standIns.set(picture, standIn);
}

/** True for textures that are pictures of the world rather than Phaser's own. */
function isPicture(key: string): boolean {
  return !key.startsWith('__') && !key.endsWith('-normal');
}

/** Hands `map` to the light as `texture`'s normal map, in place of any it had. */
function setNormalMap(texture: Phaser.Textures.Texture, map: HTMLImageElement | HTMLCanvasElement | ImageBitmap): void {
  for (const old of texture.dataSource) old.destroy();
  texture.dataSource.length = 0;
  texture.setDataSource(map as HTMLImageElement);
}

/**
 * Gives every picture in `scene` a normal map, now and whenever one is added
 * or repainted, worked out in a worker a few at a time. Painted maps named
 * `<key>-normal` win.
 */
export function shadePictures(scene: Phaser.Scene): void {
  const worker = new Worker(new URL('./relief-worker.ts', import.meta.url), { type: 'module' });
  const queue = new Set(scene.textures.getTextureKeys().filter(isPicture));
  const working = new Map<number, { key: string; source: unknown }>();
  let next = 0;
  let closed = false;

  const pump = () => {
    for (const key of queue) {
      if (working.size >= AT_ONCE) return;
      queue.delete(key);
      if (!scene.textures.exists(key)) continue;
      const texture = scene.textures.get(key);
      const painted = `${key}-normal`;
      // A normal map painted in the Art tab wins over one worked out here.
      if (scene.textures.exists(painted)) {
        setNormalMap(texture, scene.textures.get(painted).getSourceImage() as HTMLImageElement);
        continue;
      }
      const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const shape = standIns.get(source) ?? source;
      if (!shape.width || !shape.height || shape.width * shape.height > MAX_PIXELS) continue;
      const id = next++;
      working.set(id, { key, source });
      void createImageBitmap(shape).then(
        (picture) => worker.postMessage({ id, picture } satisfies ReliefJob, [picture]),
        () => { working.delete(id); pump(); },
      );
    }
  };
  worker.onmessage = (event: MessageEvent<ReliefJob>) => {
    const { id, picture } = event.data;
    const job = working.get(id);
    working.delete(id);
    // Skip a map for a picture that was repainted or dropped meanwhile.
    if (!closed && job && scene.textures.exists(job.key) && scene.textures.get(job.key).getSourceImage() === job.source) {
      setNormalMap(scene.textures.get(job.key), picture);
    } else picture.close();
    if (!closed) pump();
  };
  const onAdd = (key: string) => {
    if (isPicture(key)) queue.add(key);
    // A painted map arriving after its picture replaces the worked-out one.
    else if (key.endsWith('-normal')) queue.add(key.slice(0, -'-normal'.length));
    pump();
  };
  scene.textures.on(Phaser.Textures.Events.ADD, onAdd);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    closed = true;
    scene.textures.off(Phaser.Textures.Events.ADD, onAdd);
    worker.terminate();
  });
  pump();
}
