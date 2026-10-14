/** One drawable asset produced from an approved reference image. */
export interface ArtEntry {
  /** Path the client loads, relative to the site root. */
  file: string;
  kind: string;
  width: number;
  height: number;
}

export type ArtManifest = Record<string, ArtEntry>;
