import sharp from 'sharp';
import { REFERENCE_NOTE } from './gemini.ts';
import { ProviderError, type GeneratedImage, type ImageProvider, type ImageRequest } from './provider.ts';
import { MAX_DATA_URL_BYTES, replicateError, type Prediction } from './replicate.ts';

// Pictures painted by any image model on Replicate. Each model names its
// inputs its own way (input_images, image_input, images; aspect_ratio as
// "1:1" or "1024x1024"; resolution "1K" or "1k"), so the model's own input
// schema is read once and the request is fitted to it, rather than keeping a
// table per model. Picked in the bake-off of 2026-11-14 (docs/art-pipeline.md).

const API = 'https://api.replicate.com/v1';

/** The Replicate image model offered first: closest to Gemini 3 Pro Image in the bake-off, at about a third of the price. */
export const DEFAULT_REPLICATE_IMAGE_MODEL = 'openai/gpt-image-2';

/** A Replicate model's name is "owner/name"; any picture model so named is painted through Replicate. */
export const isReplicateModel = (model: string | undefined): boolean => Boolean(model && /^[\w.-]+\/[\w.-]+(:\w+)?$/.test(model.trim()));

/** Input field names that take reference pictures, most specific first. */
const REFERENCE_FIELDS = ['input_images', 'image_input', 'images', 'reference_images', 'input_image', 'image'];

interface FieldSchema {
  type?: string;
  enum?: string[];
  allOf?: { $ref?: string }[];
  $ref?: string;
  maxItems?: number;
}

/** A model's inputs: each field and the values it allows, when it lists them. */
export interface ModelInputs {
  fields: Record<string, { array: boolean; values?: string[]; maxItems?: number }>;
}

interface ModelInfo {
  latest_version?: {
    openapi_schema?: { components?: { schemas?: Record<string, { properties?: Record<string, FieldSchema>; enum?: string[]; type?: string }> } };
  };
}

/** Reads a model's input fields from its OpenAPI schema; enums may sit in their own schema behind a $ref. */
export function readInputs(info: ModelInfo): ModelInputs {
  const schemas = info.latest_version?.openapi_schema?.components?.schemas ?? {};
  const props = schemas.Input?.properties ?? {};
  const fields: ModelInputs['fields'] = {};
  for (const [name, f] of Object.entries(props)) {
    const ref = (f.$ref ?? f.allOf?.[0]?.$ref)?.split('/').pop();
    const values = f.enum ?? (ref ? schemas[ref]?.enum : undefined);
    fields[name] = { array: f.type === 'array', ...(values ? { values: values.map(String) } : {}), ...(f.maxItems ? { maxItems: f.maxItems } : {}) };
  }
  return { fields };
}

/** Width:height of a size such as "1536x1024" or a ratio such as "3:2". */
function ratioOf(value: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*[:x*]\s*(\d+(?:\.\d+)?)$/i.exec(value.trim());
  return m ? Number(m[1]) / Number(m[2]) : undefined;
}

/** The allowed value whose shape is closest to the asked ratio. */
function closestShape(values: string[], wanted: number): string | undefined {
  let best: string | undefined;
  let gap = Infinity;
  for (const v of values) {
    const r = ratioOf(v);
    if (r === undefined) continue;
    const g = Math.abs(Math.log(r / wanted));
    if (g < gap) { gap = g; best = v; }
  }
  return best;
}

/**
 * The input for one picture, fitted to what this model takes. Settings a
 * model does not have are left out, so its own defaults (safety included)
 * apply.
 */
export function fitInput(inputs: ModelInputs, request: ImageRequest, references: string[]): Record<string, unknown> {
  const f = inputs.fields;
  const notes = request.references?.length && !request.edit ? `${REFERENCE_NOTE}\n` : '';
  const input: Record<string, unknown> = { prompt: notes + request.prompt };
  const wanted = ratioOf(request.aspectRatio ?? '1:1') ?? 1;
  for (const name of ['aspect_ratio', 'size']) {
    const field = f[name];
    if (!field?.values) continue;
    const shape = closestShape(field.values, wanted);
    if (shape) input[name] = shape;
  }
  const size = (request.size ?? '1K').toLowerCase();
  for (const name of ['resolution', 'size', 'image_size']) {
    const field = f[name];
    if (!field?.values || input[name] !== undefined) continue;
    const match = field.values.find((v) => v.toLowerCase() === size);
    if (match) input[name] = match;
  }
  // OpenAI's own "auto" picks high (about 3x the price); medium matched Gemini 3 Pro in the bake-off.
  if (f.quality?.values?.includes('medium')) input.quality = 'medium';
  if (f.output_format?.values?.includes('png')) input.output_format = 'png';
  if (references.length) {
    const field = REFERENCE_FIELDS.find((n) => f[n]);
    if (field) {
      const max = f[field]!.array ? f[field]!.maxItems ?? references.length : 1;
      input[field] = f[field]!.array ? references.slice(0, max) : references[0];
    }
  }
  return input;
}

/** Paints with an image model on Replicate, by its "owner/name". */
export class ReplicateImageProvider implements ImageProvider {
  readonly id = 'replicate';
  private inputs?: Promise<ModelInputs>;

  constructor(
    private readonly token: string,
    readonly model = DEFAULT_REPLICATE_IMAGE_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  ) {
    if (!token) throw new Error('REPLICATE_API_TOKEN is not set.');
  }

  async generate(request: ImageRequest): Promise<GeneratedImage> {
    const inputs = await this.schema();
    const references = await Promise.all((request.references ?? []).map((r) => this.picture(r)));
    let prediction = await this.start(fitInput(inputs, request, references));
    // Most pictures come back within the minute the start call waits; give up after five more.
    for (let i = 0; !finished(prediction); i++) {
      if (i >= 150) {
        // Left alone, a job we gave up on keeps running (and may still be charged): stop it.
        await this.fetchImpl(prediction.urls?.cancel ?? `${API}/predictions/${encodeURIComponent(prediction.id!)}/cancel`, { method: 'POST', headers: this.headers() }).catch(() => undefined);
        throw new ProviderError(this.id, 504, 'the picture took too long');
      }
      await this.wait(2_000);
      const poll = await this.fetchImpl(prediction.urls?.get ?? `${API}/predictions/${encodeURIComponent(prediction.id!)}`, { headers: this.headers() });
      // Checking too often is refused too; the picture is already paid for, so keep checking.
      if (poll.status === 429) continue;
      const checked = (await poll.json().catch(() => ({}))) as Prediction;
      if (!poll.ok) throw replicateError(this.id, poll, checked, 'checking on the picture failed');
      prediction = checked;
    }
    if (prediction.status !== 'succeeded') {
      throw new ProviderError(this.id, 422, prediction.error?.trim() || (prediction.status === 'canceled' ? 'the picture was cancelled' : 'the picture failed'));
    }
    const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!url) throw new ProviderError(this.id, 422, 'no picture returned');
    // The file is on Replicate's delivery host, which needs no token: keep the token on api.replicate.com.
    const file = await this.fetchImpl(url);
    if (!file.ok) throw new ProviderError(this.id, file.status, 'downloading the picture failed');
    const type = file.headers.get('content-type') ?? '';
    return { mimeType: type.startsWith('image/') ? type : 'image/png', data: Buffer.from(await file.arrayBuffer()) };
  }

  /** The model's inputs, asked once per provider. */
  private schema(): Promise<ModelInputs> {
    this.inputs ??= (async () => {
      const name = this.model.split(':')[0]!;
      const res = await this.fetchImpl(`${API}/models/${name.split('/').map(encodeURIComponent).join('/')}`, { headers: this.headers() });
      const body = (await res.json().catch(() => ({}))) as ModelInfo & Prediction;
      if (!res.ok) throw replicateError(this.id, res, body, `the model ${name} could not be found`);
      return readInputs(body);
    })();
    // A failed look-up is asked again next time.
    this.inputs.catch(() => { this.inputs = undefined; });
    return this.inputs;
  }

  /** Starts the job and waits up to a minute for it, so most pictures need no polling. */
  private async start(input: Record<string, unknown>): Promise<Prediction> {
    const [name, version] = this.model.split(':');
    const res = version
      ? await this.fetchImpl(`${API}/predictions`, { method: 'POST', headers: { ...this.headers(), prefer: 'wait=60' }, body: JSON.stringify({ version, input }) })
      : await this.fetchImpl(`${API}/models/${name!.split('/').map(encodeURIComponent).join('/')}/predictions`, {
        method: 'POST',
        headers: { ...this.headers(), prefer: 'wait=60' },
        body: JSON.stringify({ input }),
      });
    const body = (await res.json().catch(() => ({}))) as Prediction;
    if (!res.ok || !body.id) throw replicateError(this.id, res, body, 'the picture could not be started');
    return body;
  }

  /**
   * A reference picture, always inline and shrunk to fit. Never a Replicate
   * files address: its urls.get answers with the file's details as JSON, not
   * the picture, and gpt-image-2 waited on one forever (2026-11-16).
   */
  private async picture(original: GeneratedImage): Promise<string> {
    const image = await shrinkReference(original);
    if (image.data.length > MAX_DATA_URL_BYTES) throw new ProviderError(this.id, 422, 'a reference picture is too big to send');
    return `data:${image.mimeType};base64,${image.data.toString('base64')}`;
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.token}` };
  }
}

function finished(p: Prediction): boolean {
  return p.status === 'succeeded' || p.status === 'failed' || p.status === 'canceled';
}

/** Sides tried for a reference picture, largest first: enough to show a style, small enough to send inline. */
const REFERENCE_SIDES = [1024, 768, 512];

/**
 * A reference picture that fits inline: scaled down step by step, as PNG and
 * then WebP (both keep transparency), until it fits. Unchanged when it already
 * fits or cannot be read.
 */
export async function shrinkReference(image: GeneratedImage): Promise<GeneratedImage> {
  if (image.data.length <= MAX_DATA_URL_BYTES) return image;
  try {
    for (const side of REFERENCE_SIDES) {
      const resized = sharp(image.data).resize(side, side, { fit: 'inside', withoutEnlargement: true });
      const png = await resized.clone().png({ compressionLevel: 9 }).toBuffer();
      if (png.length <= MAX_DATA_URL_BYTES) return { mimeType: 'image/png', data: png };
      for (const quality of [90, 75]) {
        const webp = await resized.clone().webp({ quality }).toBuffer();
        if (webp.length <= MAX_DATA_URL_BYTES) return { mimeType: 'image/webp', data: webp };
      }
    }
  } catch {
    // Not a picture sharp can read: send it as it is.
  }
  return image;
}
