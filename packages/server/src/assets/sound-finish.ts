import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

// What every made sound goes through before players hear it, with ffmpeg
// (already needed for walks): silence trimmed off, levels evened out so no
// sound is much louder than another, and music made to loop without a seam.
// This only edits the service's recording; nothing is synthesized.

const run = promisify(execFile);

/** A finished sound: an MP3 and its length. */
export interface FinishedSound {
  data: Buffer;
  seconds: number;
}

/** Seconds of the end of a track blended over its start, so it loops smoothly. */
const LOOP_BLEND = 2;

/** Trims an effect's silence and levels it. */
export function finishEffect(raw: Buffer): Promise<FinishedSound> {
  return inTemp(raw, async (dir, input) => {
    const trimmed = await trim(dir, input, true);
    const out = join(dir, 'out.mp3');
    await ffmpeg(['-i', trimmed, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '4', out]);
    return { data: await readFile(out), seconds: await duration(out) };
  });
}

/**
 * Trims a track's trailing silence, levels it quieter than effects, then
 * blends its last seconds over its first: played on a loop, the end runs on
 * into the start with no jump.
 */
export function finishMusic(raw: Buffer): Promise<FinishedSound> {
  return inTemp(raw, async (dir, input) => {
    const trimmed = await trim(dir, input, false);
    const levelled = join(dir, 'levelled.wav');
    await ffmpeg(['-i', trimmed, '-af', 'loudnorm=I=-20:TP=-2:LRA=11', '-ar', '44100', levelled]);
    const length = await duration(levelled);
    const out = join(dir, 'out.mp3');
    if (length < LOOP_BLEND * 4) {
      await ffmpeg(['-i', levelled, '-c:a', 'libmp3lame', '-q:a', '4', out]);
    } else {
      // The track read twice: its body fading in, and its last seconds fading out over that.
      const end = (length - LOOP_BLEND).toFixed(3);
      await ffmpeg(['-i', levelled, '-i', levelled, '-filter_complex', [
        `[0]atrim=0:${end},asetpts=PTS-STARTPTS,afade=t=in:d=${LOOP_BLEND}[body]`,
        `[1]atrim=start=${end},asetpts=PTS-STARTPTS,afade=t=out:d=${LOOP_BLEND}[tail]`,
        `[body][tail]amix=inputs=2:duration=longest:normalize=0[out]`,
      ].join(';'), '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '4', out]);
    }
    return { data: await readFile(out), seconds: await duration(out) };
  });
}

/** Cuts quiet from the start of a sound. */
const TRIM_START = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';

/**
 * Cuts the quiet off the end of a sound, and off its start too when `start`
 * is set, into a WAV. A pass of its own: ffmpeg 6 stalls when loudnorm
 * follows areverse in the same filter chain.
 */
async function trim(dir: string, input: string, start: boolean): Promise<string> {
  const out = join(dir, 'trimmed.wav');
  await ffmpeg(['-i', input, '-af', `${start ? `${TRIM_START},` : ''}areverse,${TRIM_START},areverse`, out]);
  return out;
}

async function inTemp<T>(raw: Buffer, work: (dir: string, input: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'sound-'));
  try {
    const input = join(dir, 'in.mp3');
    await writeFile(input, raw);
    return await work(dir, input);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ffmpeg(args: string[]): Promise<void> {
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...args]).catch((err: NodeJS.ErrnoException) => {
    throw new Error(err.code === 'ENOENT' ? 'ffmpeg is not installed, so sounds cannot be finished.' : `ffmpeg could not finish the sound: ${err.message}`);
  });
}

async function duration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Math.round(Number.parseFloat(stdout) * 1000) / 1000;
}
