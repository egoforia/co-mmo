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
  /**
   * When the Owner had this painted again from God's View. Such art wins
   * over the art shipped with the game; other painted art never does.
   */
  redone?: number;
  /**
   * Painted for the isometric camera: seen from its corner, its base filling
   * the diamond of the tiles it stands on, so the game stands it on them at
   * the footprint's width.
   */
  view?: 'isometric';
}

export type ArtManifest = Record<string, ArtEntry>;
