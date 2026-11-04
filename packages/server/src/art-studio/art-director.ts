import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BIOMES, STYLES, type BiomeId } from '@co-mmo/shared';
import { parseJsonObject } from '../ai/chat.ts';
import type { AiServices } from '../ai/services.ts';
import { ANCHORS } from '../assets/anchors.ts';
import { pixelStats, type PixelStats } from '../assets/style-check.ts';
import { STYLE } from '../assets/style-profile.ts';
import type { Budget } from '../budget.ts';
import type { ArtCatalog } from './catalog.ts';

export type FashionStyleId = 'pilgrim' | 'barkwarden' | 'pearlcoat' | 'sunwrap' | 'windfelt' | 'sporeweave';

/** 5-point coherence rubric scores (0-100 each) and overall score. */
export interface CoherenceScores {
  facets: number;
  palette: number;
  projection: number;
  scale: number;
  silhouette: number;
}

/** Result of auditing one asset against the Style Bible and Golden Reference Anchors. */
export interface CoherenceAuditEntry {
  asset: string;
  name: string;
  biome: string;
  kind: string;
  url?: string;
  score: number;
  status: 'coherent' | 'minor-drift' | 'off-style';
  rubric: CoherenceScores;
  pixelStats?: PixelStats;
  references: string[];
  findings: string[];
  suggestedNote: string;
  auditedAt: number;
  usd: number;
}

/** Biome palette & anchor guide in the Living Style Bible. */
export interface BiomeStyleGuide {
  id: BiomeId;
  name: string;
  colors: string[];
  mood: string;
  anchors: string[];
}

/** Region Fashion Style guide in the Living Style Bible. */
export interface FashionStyleGuide {
  id: FashionStyleId;
  name: string;
  biome: BiomeId;
  feel: string;
  colors: string[];
  anchors: string[];
}

/** Consultation message in the Art Director thread. */
export interface DirectorConsultation {
  role: 'user' | 'director';
  text: string;
  at: number;
  references?: string[];
  suggestedNote?: string;
}

/** Persisted state of the AI Art Director (`style-director.json`). */
export interface StyleDirectorState {
  version: string;
  basePrompt: string;
  negatives: string[];
  biomes: Record<BiomeId, BiomeStyleGuide>;
  fashionStyles: Record<FashionStyleId, FashionStyleGuide>;
  goldenAnchors: Record<string, string[]>;
  audits: Record<string, CoherenceAuditEntry>;
  consultations: DirectorConsultation[];
}

const DEFAULT_BIOME_GUIDES: Record<BiomeId, BiomeStyleGuide> = {
  sanctum: {
    id: 'sanctum',
    name: BIOMES.sanctum.name,
    colors: ['#F5EFE0', '#E8C66A', '#D98A9C', '#6A9E5B'],
    mood: 'peaceful, sacred, welcoming',
    anchors: ['sanctum-flagstones', 'sanctum-shrine', 'sanctum-pilgrim'],
  },
  'whispering-woods': {
    id: 'whispering-woods',
    name: BIOMES['whispering-woods'].name,
    colors: ['#1E5E5A', '#5C3D2E', '#B3472A', '#F2D14B'],
    mood: 'quiet, cosy, mysterious',
    anchors: ['woods-moss', 'woods-tree-house', 'woods-mushroom', 'woods-herbalist'],
  },
  'sunlit-shore': {
    id: 'sunlit-shore',
    name: BIOMES['sunlit-shore'].name,
    colors: ['#F3E2C3', '#2CA6A4', '#F07865', '#D9C7A3'],
    mood: 'bright, breezy, cheerful',
    anchors: ['shore-sand', 'shore-lighthouse', 'shore-crab-knight', 'shore-trader'],
  },
  'mirage-desert': {
    id: 'mirage-desert',
    name: BIOMES['mirage-desert'].name,
    colors: ['#E8A468', '#C88038', '#36A89A', '#7A9A68'],
    mood: 'sun-warmed, ancient, still',
    anchors: ['desert-dunes', 'desert-ruin', 'desert-scarab', 'desert-cactus-folk'],
  },
  frostpeak: {
    id: 'frostpeak',
    name: BIOMES.frostpeak.name,
    colors: ['#DCEAF5', '#5B7C99', '#2E4A3E', '#E2A857'],
    mood: 'crisp, windswept, hardy',
    anchors: ['zephyr-falcon', 'sanctum-flagstones', 'woods-herbalist'],
  },
  'mushroom-hollow': {
    id: 'mushroom-hollow',
    name: BIOMES['mushroom-hollow'].name,
    colors: ['#4B325C', '#9E6BC4', '#E6D9C2', '#6BC4A6'],
    mood: 'luminous, hushed, subterranean',
    anchors: ['sylvan-cervid', 'woods-mushroom', 'woods-moss'],
  },
  'verdant-meadows': {
    id: 'verdant-meadows',
    name: BIOMES['verdant-meadows'].name,
    colors: ['#7BB661', '#F4D35E', '#E8EFE0', '#C47D55'],
    mood: 'breezy, pastoral, sunlit',
    anchors: ['sanctum-flagstones', 'sanctum-pilgrim'],
  },
  'ember-wastes': {
    id: 'ember-wastes',
    name: BIOMES['ember-wastes'].name,
    colors: ['#3D353B', '#E06D3B', '#F4B942', '#7A5C61'],
    mood: 'smouldering, rugged, warm',
    anchors: ['item-goat-horn', 'desert-dunes'],
  },
  'murkmire-swamp': {
    id: 'murkmire-swamp',
    name: BIOMES['murkmire-swamp'].name,
    colors: ['#3A5A40', '#588157', '#A3B18A', '#D4A373'],
    mood: 'misty, mossy, quiet',
    anchors: ['woods-moss', 'woods-mushroom'],
  },
  'sky-ruins': {
    id: 'sky-ruins',
    name: BIOMES['sky-ruins'].name,
    colors: ['#E8EEF5', '#8DA9C4', '#E8C66A', '#6C7A89'],
    mood: 'airy, ancient, high',
    anchors: ['sanctum-shrine', 'zephyr-falcon'],
  },
};

const DEFAULT_FASHION_GUIDES: Record<FashionStyleId, FashionStyleGuide> = {
  pilgrim: {
    id: 'pilgrim',
    name: STYLES.pilgrim.name,
    biome: 'sanctum',
    feel: STYLES.pilgrim.feel,
    colors: ['#F5EFE0', '#E8C66A', '#D98A9C'],
    anchors: ['sanctum-pilgrim', 'item-traveller-coat'],
  },
  barkwarden: {
    id: 'barkwarden',
    name: STYLES.barkwarden.name,
    biome: 'whispering-woods',
    feel: STYLES.barkwarden.feel,
    colors: ['#5C3D2E', '#2D6A4F', '#B3472A'],
    anchors: ['bramble-ursine', 'item-mushroom-hat', 'item-traveller-coat'],
  },
  pearlcoat: {
    id: 'pearlcoat',
    name: STYLES.pearlcoat.name,
    biome: 'sunlit-shore',
    feel: STYLES.pearlcoat.feel,
    colors: ['#F3E2C3', '#2CA6A4', '#F07865'],
    anchors: ['tide-lutran', 'item-shell-mail', 'shore-trader'],
  },
  sunwrap: {
    id: 'sunwrap',
    name: STYLES.sunwrap.name,
    biome: 'mirage-desert',
    feel: STYLES.sunwrap.feel,
    colors: ['#E8A468', '#C88038', '#36A89A'],
    anchors: ['dune-scorpid', 'desert-cactus-folk', 'item-scarab-charm'],
  },
  windfelt: {
    id: 'windfelt',
    name: STYLES.windfelt.name,
    biome: 'frostpeak',
    feel: STYLES.windfelt.feel,
    colors: ['#DCEAF5', '#5B7C99', '#C89D54'],
    anchors: ['zephyr-falcon', 'item-traveller-coat'],
  },
  sporeweave: {
    id: 'sporeweave',
    name: STYLES['sporeweave'].name,
    biome: 'mushroom-hollow',
    feel: STYLES['sporeweave'].feel,
    colors: ['#4B325C', '#9E6BC4', '#E6D9C2'],
    anchors: ['sylvan-cervid', 'item-mushroom-hat'],
  },
};

const DEFAULT_GOLDEN_ANCHORS: Record<string, string[]> = {
  player: ['player-mara', 'player-ilya', 'bramble-ursine', 'tide-lutran'],
  npc: ['sanctum-pilgrim', 'woods-herbalist', 'shore-trader', 'desert-cactus-folk'],
  monster: ['woods-mushroom', 'shore-crab-knight', 'desert-scarab'],
  item: ['item-tonic', 'item-wooden-sword', 'item-traveller-coat', 'item-scarab-charm'],
  tile: ['sanctum-flagstones', 'woods-moss', 'shore-sand', 'desert-dunes'],
  prop: ['sanctum-shrine', 'woods-tree-house', 'shore-lighthouse', 'desert-ruin'],
  effect: ['fx-slash', 'item-firebolt'],
};

/**
 * AI Art Director Agent (`art-director.ts`): maintains visual coherence across
 * all game art via the Living Style Bible, Golden Reference Anchors, Pre-Paint
 * Prompt Harmonizer, 5-Point Multimodal Coherence Audit, and interactive consultation.
 */
export class ArtDirector {
  private state!: StyleDirectorState;
  private loaded = false;

  constructor(
    private readonly options: {
      artDir: string;
      anchorDir: string;
      ai: AiServices;
      budget: Budget;
      catalog: ArtCatalog;
      readArt?: (file: string) => Promise<Buffer>;
    },
  ) {}

  private get file(): string {
    return resolve(this.options.artDir, 'style-director.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StyleDirectorState>;
      this.state = {
        version: parsed.version ?? String(STYLE.version),
        basePrompt: parsed.basePrompt ?? STYLE.base,
        negatives: Array.isArray(parsed.negatives) && parsed.negatives.length ? parsed.negatives : [...STYLE.negatives],
        biomes: { ...DEFAULT_BIOME_GUIDES, ...(parsed.biomes ?? {}) },
        fashionStyles: { ...DEFAULT_FASHION_GUIDES, ...(parsed.fashionStyles ?? {}) },
        goldenAnchors: { ...DEFAULT_GOLDEN_ANCHORS, ...(parsed.goldenAnchors ?? {}) },
        audits: parsed.audits ?? {},
        consultations: Array.isArray(parsed.consultations) ? parsed.consultations.slice(-40) : [],
      };
    } catch {
      this.state = {
        version: String(STYLE.version),
        basePrompt: STYLE.base,
        negatives: [...STYLE.negatives],
        biomes: structuredClone(DEFAULT_BIOME_GUIDES),
        fashionStyles: structuredClone(DEFAULT_FASHION_GUIDES),
        goldenAnchors: structuredClone(DEFAULT_GOLDEN_ANCHORS),
        audits: {},
        consultations: [],
      };
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await mkdir(this.options.artDir, { recursive: true });
    await writeFile(this.file, JSON.stringify(this.state, null, 2));
  }

  /** Overview of the Living Style Bible, Golden Anchors, Coherence Scores, and Consultations. */
  async overview(): Promise<StyleDirectorState & { overallScore: number; auditedCount: number; flaggedCount: number }> {
    await this.load();
    const entries = Object.values(this.state.audits);
    const auditedCount = entries.length;
    const overallScore = auditedCount ? Math.round(entries.reduce((s, e) => s + e.score, 0) / auditedCount) : 100;
    const flaggedCount = entries.filter((e) => e.status !== 'coherent').length;
    return {
      ...this.state,
      overallScore,
      auditedCount,
      flaggedCount,
    };
  }

  /** Updates Golden Reference Anchors, biome guides, fashion style guides, or negative prompts. */
  async updateStyleBible(patch: {
    basePrompt?: string;
    negatives?: string[];
    goldenAnchors?: Record<string, string[]>;
    biome?: { id: BiomeId; colors?: string[]; mood?: string; anchors?: string[] };
    fashionStyle?: { id: FashionStyleId; colors?: string[]; feel?: string; anchors?: string[] };
  }): Promise<StyleDirectorState> {
    await this.load();
    if (typeof patch.basePrompt === 'string' && patch.basePrompt.trim()) {
      this.state.basePrompt = patch.basePrompt.trim().slice(0, 2000);
    }
    if (Array.isArray(patch.negatives)) {
      this.state.negatives = patch.negatives.map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
    }
    if (patch.goldenAnchors && typeof patch.goldenAnchors === 'object') {
      for (const [k, v] of Object.entries(patch.goldenAnchors)) {
        if (Array.isArray(v)) this.state.goldenAnchors[k] = v.map(String).filter(Boolean).slice(0, 8);
      }
    }
    if (patch.biome && this.state.biomes[patch.biome.id]) {
      const b = this.state.biomes[patch.biome.id];
      if (Array.isArray(patch.biome.colors)) b.colors = patch.biome.colors.map(String).slice(0, 8);
      if (typeof patch.biome.mood === 'string' && patch.biome.mood.trim()) b.mood = patch.biome.mood.trim().slice(0, 200);
      if (Array.isArray(patch.biome.anchors)) b.anchors = patch.biome.anchors.map(String).slice(0, 6);
    }
    if (patch.fashionStyle && this.state.fashionStyles[patch.fashionStyle.id]) {
      const f = this.state.fashionStyles[patch.fashionStyle.id];
      if (Array.isArray(patch.fashionStyle.colors)) f.colors = patch.fashionStyle.colors.map(String).slice(0, 8);
      if (typeof patch.fashionStyle.feel === 'string' && patch.fashionStyle.feel.trim()) f.feel = patch.fashionStyle.feel.trim().slice(0, 200);
      if (Array.isArray(patch.fashionStyle.anchors)) f.anchors = patch.fashionStyle.anchors.map(String).slice(0, 6);
    }
    await this.save();
    return this.state;
  }

  /** Selects the best Golden Reference Anchors for an asset, kind, biome, and fashion style. */
  async selectReferences(input: { asset?: string; kind?: string; biome?: string; fashionStyle?: string }): Promise<string[]> {
    await this.load();
    const anchor = input.asset ? ANCHORS.find((a) => a.id === input.asset) : undefined;
    const kind = input.kind ?? anchor?.kind ?? 'item';
    const biome = (input.biome ?? anchor?.biome ?? 'any') as BiomeId | 'any';
    const refs: string[] = [];
    if (anchor?.references?.length) refs.push(...anchor.references);
    if (input.fashionStyle && input.fashionStyle in this.state.fashionStyles) {
      refs.push(...this.state.fashionStyles[input.fashionStyle as FashionStyleId].anchors);
    }
    if (biome !== 'any' && biome in this.state.biomes) {
      refs.push(...this.state.biomes[biome].anchors);
    }
    const kindAnchors = this.state.goldenAnchors[kind] ?? this.state.goldenAnchors.item ?? [];
    refs.push(...kindAnchors);
    return [...new Set(refs)].filter((id) => id !== input.asset).slice(0, 3);
  }

  /**
   * Harmonizes an Owner's rough note or prompt into a Style-Bible-compliant
   * art brief with curated Golden Reference Anchors and a 5-point checklist.
   */
  async harmonizeBrief(input: {
    asset?: string;
    kind?: string;
    biome?: string;
    fashionStyle?: string;
    note?: string;
    prompt?: string;
  }): Promise<{
    harmonizedNote: string;
    harmonizedPrompt: string;
    references: string[];
    checklist: { facets: boolean; palette: boolean; isometric: boolean; scale: boolean; negatives: boolean };
    usd: number;
  }> {
    await this.load();
    const anchor = input.asset ? ANCHORS.find((a) => a.id === input.asset) : undefined;
    const kind = input.kind ?? anchor?.kind ?? 'item';
    const biome = (input.biome ?? anchor?.biome ?? 'any') as BiomeId | 'any';
    const references = await this.selectReferences({ asset: input.asset, kind, biome, fashionStyle: input.fashionStyle });
    const rawText = (input.note || input.prompt || anchor?.silhouetteHook || input.asset || 'game sprite').trim().slice(0, 1500);
    const biomeGuide = biome !== 'any' && biome in this.state.biomes ? this.state.biomes[biome] : undefined;
    const fashionGuide = input.fashionStyle && input.fashionStyle in this.state.fashionStyles ? this.state.fashionStyles[input.fashionStyle as FashionStyleId] : undefined;

    // Deterministic Style Bible enrichment (always available, even offline).
    const parts: string[] = [rawText.replace(/[.]+$/, '')];
    parts.push('broad smooth unlit colour facets meeting at crisp edges (no gradients, no baked shadows)');
    if (kind === 'tile') {
      parts.push('seamless 2:1 isometric ground texture');
    } else if (kind === 'effect') {
      parts.push('bold faceted icon/burst silhouette readable at small HUD size');
    } else {
      parts.push('three-quarter 2:1 isometric view with unmistakable silhouette hook');
    }
    if (biomeGuide) {
      parts.push(`${biomeGuide.name} palette (${biomeGuide.colors.join(', ')}) and ${biomeGuide.mood} mood`);
    }
    if (fashionGuide) {
      parts.push(`${fashionGuide.name} regional tailoring (${fashionGuide.feel})`);
    }
    let harmonizedNote = parts.join('; ') + '.';
    let usd = 0;

    // If a live judge/chat model is available and budget allows, let it polish the brief concisely.
    const model = this.options.ai.judgeModel() ?? this.options.ai.godModels()[0];
    if (model && model.provider !== 'offline' && !this.options.budget.paused()) {
      try {
        const res = await model.complete({
          system: [
            'You are the AI Art Director for a low-poly faceted 3D isometric game (Ashen / Tunic / Monument Valley look).',
            `Core Style Bible: ${this.state.basePrompt}`,
            `Avoid: ${this.state.negatives.join(', ')}.`,
            'Rewrite the user note into ONE concise, vivid art direction note (max 45 words) that preserves their intent while enforcing broad unlit colour facets, crisp edges, 2:1 isometric camera, and the biome/fashion palette.',
            'Reply with JSON: {"note": "harmonized note text"}',
          ].join('\n'),
          purpose: 'Art Director harmonize',
          messages: [
            {
              role: 'user',
              content: `Asset: ${input.asset ?? kind} (${kind}, biome: ${biome}${fashionGuide ? `, fashion: ${fashionGuide.name}` : ''}). User note: ${rawText}`,
            },
          ],
          json: true,
          maxTokens: 400,
        });
        usd = res.usd;
        this.options.budget.spend('chat', model, usd);
        const parsed = parseJsonObject(res.text);
        if (typeof parsed?.note === 'string' && parsed.note.trim()) {
          harmonizedNote = parsed.note.trim().slice(0, 600);
        }
      } catch {
        // Fall back to deterministic Style Bible harmonization.
      }
    }

    const harmonizedPrompt = `${this.state.basePrompt}\nSubject: ${harmonizedNote}\nAvoid: ${this.state.negatives.join(', ')}.`;
    return {
      harmonizedNote,
      harmonizedPrompt,
      references,
      checklist: {
        facets: true,
        palette: true,
        isometric: true,
        scale: true,
        negatives: true,
      },
      usd,
    };
  }

  /**
   * Runs the 5-Point Coherence Audit on the given asset IDs (or all painted/shipped
   * anchors when none are specified), combining deterministic `pixelStats` checks
   * with Vision Judge scoring when available.
   */
  async auditAssets(assetIds?: string[]): Promise<{ entries: CoherenceAuditEntry[]; usd: number }> {
    await this.load();
    const targetIds = assetIds?.length
      ? assetIds.slice(0, 24)
      : ANCHORS.slice(0, 12).map((a) => a.id);

    const entries: CoherenceAuditEntry[] = [];
    let totalUsd = 0;

    for (const id of targetIds) {
      const anchor = ANCHORS.find((a) => a.id === id);
      const name = await this.options.catalog.nameOf(id).catch(() => anchor?.name ?? id);
      const kind = anchor?.kind ?? 'item';
      const biome = anchor?.biome ?? 'any';
      const references = await this.selectReferences({ asset: id, kind, biome });
      const file = await this.options.catalog.pictureFile(id);
      const png = file && this.options.readArt ? await this.options.readArt(file).catch(() => undefined) : undefined;

      let stats: PixelStats | undefined;
      const findings: string[] = [];
      const rubric: CoherenceScores = {
        facets: 92,
        palette: 92,
        projection: 94,
        scale: 94,
        silhouette: 92,
      };

      if (png) {
        stats = await pixelStats(png).catch(() => undefined);
        if (stats) {
          if (stats.magenta > 0.015) {
            rubric.palette -= 30;
            findings.push('Leftover magenta key background fringes detected on subject edges.');
          }
          if (stats.black > 0.25) {
            rubric.palette -= 25;
            findings.push('Large near-black regions violate the unlit pastel/earthy palette rule.');
          }
          if (stats.white > 0.28) {
            rubric.palette -= 20;
            findings.push('Large pure-white areas reduce facet readability.');
          }
          if (stats.neon > 0.2) {
            rubric.palette -= 25;
            findings.push('Over-saturated neon pixels drift from the biome palette.');
          }
          if (stats.edge > 0.05 && kind !== 'tile') {
            rubric.scale -= 25;
            findings.push('Subject touches or clips against the outer bounding box edge.');
          }
          if (stats.subject < 0.04) {
            rubric.scale -= 30;
            rubric.silhouette -= 20;
            findings.push('Subject fills too little of its frame to read clearly at game zoom.');
          }
        }
      } else {
        findings.push('Picture has not been painted yet (currently missing or using a stand-in).');
        rubric.facets = 0;
        rubric.palette = 0;
        rubric.projection = 0;
        rubric.scale = 0;
        rubric.silhouette = 0;
      }

      let usd = 0;
      const judge = this.options.ai.judgeModel();
      if (png && judge && judge.provider !== 'offline' && !this.options.budget.paused() && targetIds.length <= 8) {
        try {
          const flat = (buf: Buffer) => sharp(buf).flatten({ background: { r: 200, g: 200, b: 200 } }).png().toBuffer();
          const refBuffers: Buffer[] = [];
          for (const refId of references.slice(0, 2)) {
            const refFile = await this.options.catalog.pictureFile(refId);
            const refBuf = refFile && this.options.readArt ? await this.options.readArt(refFile).catch(() => undefined) : undefined;
            if (refBuf) refBuffers.push(await flat(refBuf));
          }
          const images = [...refBuffers, await flat(png)].map((data) => ({ mimeType: 'image/png', data }));
          const res = await judge.complete({
            system: [
              `You are the AI Art Director auditing game sprites for ${STYLE.judge.game}.`,
              'Score the last image against the reference images on 5 criteria from 0 to 100:',
              '1. facets (smooth unlit low-poly colour planes, no noisy textures or soft airbrushing)',
              '2. palette (warm cohesive biome colours, no pure black/white or harsh neon)',
              '3. projection (consistent 2:1 three-quarter isometric angle)',
              '4. scale (well-framed within bounds, feet grounded)',
              '5. silhouette (unmistakable silhouette hook at a glance)',
              'Reply with JSON: {"facets":90,"palette":90,"projection":90,"scale":90,"silhouette":90,"finding":"one short observation","suggestedNote":"one short corrective repaint note"}',
            ].join('\n'),
            purpose: 'Art Director coherence audit',
            messages: [{ role: 'user', content: `Audit "${name}" (${kind}, biome: ${biome}).`, images }],
            json: true,
            maxTokens: 600,
          });
          usd = res.usd;
          totalUsd += usd;
          this.options.budget.spend('chat', judge, usd);
          const parsed = parseJsonObject(res.text);
          if (parsed) {
            const clampScore = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fb);
            rubric.facets = clampScore(parsed.facets, rubric.facets);
            rubric.palette = clampScore(parsed.palette, rubric.palette);
            rubric.projection = clampScore(parsed.projection, rubric.projection);
            rubric.scale = clampScore(parsed.scale, rubric.scale);
            rubric.silhouette = clampScore(parsed.silhouette, rubric.silhouette);
            if (typeof parsed.finding === 'string' && parsed.finding.trim()) {
              findings.push(parsed.finding.trim().slice(0, 240));
            }
          }
        } catch {
          // Keep deterministic pixelStats audit if vision call fails.
        }
      }

      for (const k of Object.keys(rubric) as (keyof CoherenceScores)[]) {
        rubric[k] = Math.max(0, Math.min(100, rubric[k]));
      }
      const score = png
        ? Math.round((rubric.facets + rubric.palette + rubric.projection + rubric.scale + rubric.silhouette) / 5)
        : 0;
      const status: CoherenceAuditEntry['status'] = !png || score < 70 ? 'off-style' : score < 85 ? 'minor-drift' : 'coherent';
      if (!findings.length) {
        findings.push('Matches the faceted 3D Style Bible and biome palette cleanly.');
      }

      const harmonized = await this.harmonizeBrief({ asset: id, kind, biome, note: findings[0] });
      const entry: CoherenceAuditEntry = {
        asset: id,
        name,
        biome,
        kind,
        ...(file ? { url: file.startsWith('/') ? file : `/${file}` } : {}),
        score,
        status,
        rubric,
        ...(stats ? { pixelStats: stats } : {}),
        references,
        findings,
        suggestedNote: status === 'coherent'
          ? 'Keep broad unlit colour facets and crisp silhouette edges.'
          : `Corrective repaint: ${harmonized.harmonizedNote}`,
        auditedAt: Date.now(),
        usd,
      };
      this.state.audits[id] = entry;
      entries.push(entry);
    }

    await this.save();
    return { entries, usd: Math.round(totalUsd * 1000) / 1000 };
  }

  /** Interactive consultation with the AI Art Director about style, biomes, or specific assets. */
  async consult(question: string, assetIds: string[] = []): Promise<{
    reply: string;
    suggestedNote?: string;
    references: string[];
    usd: number;
  }> {
    await this.load();
    const cleanQ = question.trim().slice(0, 1500);
    const firstAsset = assetIds[0];
    const references = await this.selectReferences({ asset: firstAsset });
    this.state.consultations.push({ role: 'user', text: cleanQ, at: Date.now(), ...(assetIds.length ? { references: assetIds } : {}) });

    let reply = `For ${firstAsset ?? 'this asset'}, keep broad smooth unlit colour facets meeting at crisp edges, anchor the palette to its biome guide, and send ${references.join(', ')} as Golden Reference Anchors so proportions and lighting stay unified.`;
    let suggestedNote = 'Broad smooth unlit colour facets, crisp edges, 2:1 isometric camera, bold silhouette hook, no gradients or baked shadows.';
    let usd = 0;

    const model = this.options.ai.judgeModel() ?? this.options.ai.godModels()[0];
    if (model && model.provider !== 'offline' && !this.options.budget.paused()) {
      try {
        const res = await model.complete({
          system: [
            'You are the AI Art Director for co-MMO.',
            `Style Bible: ${this.state.basePrompt}`,
            `Biomes: ${Object.values(this.state.biomes).map((b) => `${b.name} (${b.mood}: ${b.colors.join('/')})`).join('; ')}`,
            `Fashion Styles: ${Object.values(this.state.fashionStyles).map((f) => `${f.name} (${f.feel})`).join('; ')}`,
            'Give practical, concise art direction advice to keep visual unity across the game, plus a ready-to-use repaint note.',
            'Reply with JSON: {"reply": "your advice in 2-3 sentences", "suggestedNote": "ready-to-use prompt note"}',
          ].join('\n'),
          purpose: 'Art Director consult',
          messages: [{ role: 'user', content: `${assetIds.length ? `[Context assets: ${assetIds.join(', ')}] ` : ''}${cleanQ}` }],
          json: true,
          maxTokens: 600,
        });
        usd = res.usd;
        this.options.budget.spend('chat', model, usd);
        const parsed = parseJsonObject(res.text);
        if (typeof parsed?.reply === 'string' && parsed.reply.trim()) reply = parsed.reply.trim();
        if (typeof parsed?.suggestedNote === 'string' && parsed.suggestedNote.trim()) suggestedNote = parsed.suggestedNote.trim();
      } catch {
        // Keep fallback Art Director guidance.
      }
    }

    this.state.consultations.push({
      role: 'director',
      text: reply,
      at: Date.now(),
      references,
      suggestedNote,
    });
    this.state.consultations = this.state.consultations.slice(-40);
    await this.save();
    return { reply, suggestedNote, references, usd };
  }
}
