/** One drawable asset produced from an approved reference image. */
export interface ArtEntry {
  /** Path the client loads, relative to the site root. */
  file: string;
  kind: string;
  width: number;
  height: number;
  /** A walk strip's frames, side by side. */
  frames?: number;
  /** Seconds a walk strip's cycle takes at the player's walking speed. */
  cycleSeconds?: number;
}

export type ArtManifest = Record<string, ArtEntry>;
