import { SOUND_EFFECTS, musicId, type BiomeId, type SoundId, type SoundManifest } from '@co-mmo/shared';

// Plays the game's sounds: short effects when things happen, and each land's
// music on a loop, faded from one land's to the next as you walk. Every
// sound was made by an AI sound service on the server; this only plays them.
// Browsers keep a page silent until the player first clicks or presses a key.

/** How loud effects and music are, 0 to 1, as the player set them. */
export interface Volumes {
  effects: number;
  music: number;
}

const SAVED = 'co-mmo-volume';
const DEFAULT_VOLUMES: Volumes = { effects: 0.8, music: 0.5 };
/** Seconds one land's music takes to give way to the next. */
const FADE = 2;
/** The sound list is asked for again at most this often, so newly made music is heard without a reload. */
const REFRESH_MS = 60_000;

/** The game's sound player. */
export class GameSound {
  private ctx?: AudioContext;
  private effectsGain?: GainNode;
  private musicGain?: GainNode;
  private manifest: SoundManifest = {};
  private fetchedAt = 0;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** The music playing now. */
  private playing?: { id: string; source: AudioBufferSourceNode; gain: GainNode };
  /** The music the player's land wants, started once sound is allowed. */
  private wanted?: string;
  volumes: Volumes = loadVolumes();

  constructor() {
    const unlock = () => {
      this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** Learns which sounds exist; again at most once a minute. */
  async refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.fetchedAt < REFRESH_MS) return;
    this.fetchedAt = Date.now();
    const next = await fetch('/api/sounds').then((r) => (r.ok ? (r.json() as Promise<SoundManifest>) : null)).catch(() => null);
    if (!next) return;
    // A sound made again is fetched afresh.
    for (const [id, entry] of Object.entries(next)) if (this.manifest[id]?.file !== entry.file) this.buffers.delete(id);
    this.manifest = next;
    if (this.wanted && this.playing?.id !== this.wanted) this.startMusic(this.wanted);
  }

  /** Plays a short effect, if it has been made. */
  play(id: SoundId): void {
    if (!this.ctx || !this.effectsGain || this.volumes.effects <= 0 || !this.manifest[id]) return;
    const ctx = this.ctx;
    const out = this.effectsGain;
    void this.buffer(id).then((buffer) => {
      if (!buffer) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = SOUND_EFFECTS[id].volume;
      source.buffer = buffer;
      source.connect(gain).connect(out);
      source.start();
    });
  }

  /** Plays a land's music, fading out whatever played before. */
  music(biome: string): void {
    this.wanted = musicId(biome as BiomeId);
    void this.refresh();
    this.startMusic(this.wanted);
  }

  /** Sets how loud effects or music are, and remembers it. */
  setVolume(kind: keyof Volumes, value: number): void {
    this.volumes = { ...this.volumes, [kind]: Math.min(1, Math.max(0, value)) };
    try {
      localStorage.setItem(SAVED, JSON.stringify(this.volumes));
    } catch {
      // Private windows may not keep it; the setting still holds until reload.
    }
    const now = this.ctx?.currentTime ?? 0;
    this.effectsGain?.gain.setTargetAtTime(this.volumes.effects, now, 0.05);
    this.musicGain?.gain.setTargetAtTime(this.volumes.music, now, 0.05);
    if (kind === 'music' && this.wanted && !this.playing) this.startMusic(this.wanted);
  }

  private unlock(): void {
    if (this.ctx) return;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    this.ctx = new Context();
    this.effectsGain = this.ctx.createGain();
    this.effectsGain.gain.value = this.volumes.effects;
    this.effectsGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.volumes.music;
    this.musicGain.connect(this.ctx.destination);
    void this.ctx.resume();
    if (this.wanted) this.startMusic(this.wanted);
  }

  private startMusic(id: string): void {
    if (!this.ctx || !this.musicGain || this.playing?.id === id) return;
    const ctx = this.ctx;
    const out = this.musicGain;
    this.fadeOut();
    if (!this.manifest[id] || this.volumes.music <= 0) return;
    void this.buffer(id).then((buffer) => {
      // The player may have walked on while it loaded.
      if (!buffer || this.wanted !== id || this.playing?.id === id) return;
      this.fadeOut();
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE);
      source.connect(gain).connect(out);
      source.start();
      this.playing = { id, source, gain };
    });
  }

  private fadeOut(): void {
    const old = this.playing;
    if (!old || !this.ctx) return;
    this.playing = undefined;
    const now = this.ctx.currentTime;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setValueAtTime(old.gain.gain.value, now);
    old.gain.gain.linearRampToValueAtTime(0, now + FADE);
    old.source.stop(now + FADE);
  }

  private buffer(id: string): Promise<AudioBuffer | null> {
    let buffer = this.buffers.get(id);
    const entry = this.manifest[id];
    if (!buffer && entry && this.ctx) {
      const ctx = this.ctx;
      buffer = fetch(entry.file.startsWith('/') ? entry.file : `/${entry.file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(id, buffer);
    }
    return buffer ?? Promise.resolve(null);
  }
}

/** The HUD's Sound button: two sliders, for effects and for music. */
export function soundControls(sound: GameSound): void {
  const button = document.getElementById('sound-button') as HTMLButtonElement;
  const panel = document.getElementById('sound-panel') as HTMLFormElement;
  for (const kind of ['effects', 'music'] as const) {
    const slider = panel.elements.namedItem(kind) as HTMLInputElement;
    slider.value = String(sound.volumes[kind]);
    slider.addEventListener('input', () => sound.setVolume(kind, Number(slider.value)));
  }
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
}

function loadVolumes(): Volumes {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null') as Partial<Volumes> | null;
    return { ...DEFAULT_VOLUMES, ...(saved ?? {}) };
  } catch {
    return { ...DEFAULT_VOLUMES };
  }
}
