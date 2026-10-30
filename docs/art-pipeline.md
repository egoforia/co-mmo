# Character & Creature Art Pipeline

This document defines the model- and API-agnostic architecture, visual standards, prompting formulas, and post-processing pipeline for generating, animating, and importing characters and creatures into co-MMO.

---

## 1. Visual Style, Height Tiers & Canonical Standards

All characters and creatures in co-MMO adhere to strict visual conventions (`FLAT_ISOMETRIC` in `packages/server/src/assets/style-profile.ts`) so that assets remain visually coherent regardless of which AI model or API generated the raw image or video:

- **Style:** Stylised low-poly isometric fantasy game art, light-neutral (`FLAT_ISOMETRIC`, Style Bible v3).
- **Geometry:** Flat faceted shapes built from large flat geometric planes with crisp hard edges (vector / cut-paper aesthetic).
- **Lighting:** **Unlit flat shading (NO LIGHTING).** Every material facet uses a single flat base color with no specular highlights, no cast shadows, no gradients, and no ambient glow. Facets are delineated only by subtle seam boundaries.
- **Palette:** Soft, muted warm pastels (sand, terracotta, dusty rose, sage green, teal, cream, brass).
- **Camera:** Orthographic isometric 3/4 turntable projection (`ISOMETRIC`).
- **Background:** Solid pure flat magenta (`#FF00FF`) for lossless chroma-keying (characters/creatures ONLY; environmental & architectural wall/floor textures must be 100% full-bleed seamless tiles without magenta backgrounds, see `docs/buildings-and-walls.md`).

### Canonical Height Standards (Players vs. Creature Size Tiers)
- **Players & Humanoids:** Always normalized to **`CHARACTER_HEIGHT = 168px`** (`1.0×`).
- **Creatures:** Normalized to one of **five canonical height tiers** relative to player height:
  | Size Tier | Canonical Height | Scale vs. Player (`168px`) | Typical Examples |
  | :--- | :---: | :---: | :--- |
  | **`tiny`** | `64px` | `~0.38×` | Small critters, scarabs, lantern moths |
  | **`small`** | `112px` | `~0.67×` | Walking mushrooms, hermit crabs, gull raiders |
  | **`medium`** | `168px` | `1.00×` | Humanoids, beastfolk, thorn wolves, deckhands |
  | **`high`** | `224px` | `~1.33×` | Large guardians, bark golems, mounted foes |
  | **`colossal`** | `320px` | `~1.90×` | World bosses, ancient wyrms, towering colossi |

### The Four Canonical Isometric Facings
Characters never use 2D horizontal mirroring. Every character is modeled/painted across all four distinct isometric directions:
1. **`front-left` (`FL`):** Facing down-left (nose, chest, and toes point towards lower-left).
2. **`front-right` (`FR`):** Facing down-right (nose, chest, and toes point towards lower-right).
3. **`back-left` (`BL`):** Facing up-left (turned away from viewer, face hidden, showing back).
4. **`back-right` (`BR`):** Facing up-right (turned away from viewer, face hidden, showing back).

---

## 2. Animation Types & Cadence

| Animation | Cycle Frames | Playback FPS | Duration | Canonical Standard |
| :--- | :---: | :---: | :---: | :--- |
| **Walk Cycle** | 12 frames | 15 fps | 0.80s | `WALK_FRAMES = 12`, `WALK_CYCLE_SECONDS = 0.8` |
| **Run Cycle** | 10 frames | 15 fps | 0.67s | Faster forward-leaning stride |
| **Basic Attack** | 12 frames | 15 fps | 0.80s | Single-hand strike matching `attackCooldown` (0.8s) |

---

## 3. Basic Attack Animation Architecture

### Core Design Rules
1. **Universal Dominant Hand:** All characters standardize on their **anatomical RIGHT arm** (or claw, paw, wing, pincer) as the primary combat strike limb.
2. **Strict Single-Handed Mechanics:** Exactly **one limb** strikes forward. The opposite arm remains held firmly against the torso in defensive guard throughout the windup, impact, and recoil.
3. **Anatomical Consistency Across Facings:**
   - In `front-left`: The character executes a **Rear Right Cross Punch** that originates from *behind* the chest and drives across the torso toward the lower-left.
   - In `front-right`: The character executes a **Lead Right Straight Punch** extending toward the lower-right.
   - In `back-left`: The character (seen from behind) punches with their right arm forward into the distance toward the upper-left.
   - In `back-right`: The character (seen from behind) punches with their right arm forward into the distance toward the upper-right.
4. **Natural Idle Loop Closure:** The attack starts at neutral idle, winds up, extends to peak reach, and organically recovers back to neutral resting guard. Frame 12 transitions seamlessly into Frame 1 (average per-pixel delta $\le 2\%$).

---

## 4. Master Sheet Composition & Canvas Geometry

To prevent video diffusion models from cutting off extended limbs at canvas boundaries:

### Turnaround Sheet Column Mapping (Clockwise Turntable Order)
Diffusion turntable generators order the 4 figures in clockwise rotational turntable sequence:
- **Col 0:** `front-left` ($-135^\circ$, facing lower-left)
- **Col 1:** `front-right` ($-45^\circ$, facing lower-right)
- **Col 2:** `back-right` ($+45^\circ$, facing upper-right)
- **Col 3:** `back-left` ($+135^\circ$, facing upper-left)

> [!CAUTION]
> Always crop `back-left` from **Col 3** and `back-right` from **Col 2**.
> Inverting them causes the video generation model to receive an initial image facing the opposite direction (e.g. starting facing back-right while attempting to attack back-left).

### Single-Facing Isolated Generation (Recommended)
- **Aspect Ratio:** `1:1` square (`720×720` or `960×960`).
- **Figure Scaling:** Target figure height $\approx 500\text{px}$ in $720\text{px}$ height ($520\text{px}$ in $960\text{px}$).
- **Horizontal Margins:** Center the figure horizontally, leaving $\ge 230\text{px}$ of pure magenta padding on both the left and right borders.
- **Vertical Margins:** Place baseline near bottom, leaving $\ge 140\text{px}$ on top and $\ge 80\text{px}$ on bottom.
- **Why:** During peak forward punch reach, limbs extend by $80\text{px}\text{–}120\text{px}$. The $230\text{px}+$ runway guarantees zero boundary clipping.

---

## 5. Model- & API-Agnostic Video Generation Contract

The animation pipeline is **AI model and API agnostic**. Whether a video clip is generated in-game via the `VideoProvider` interface (`packages/server/src/assets/video.ts`, chosen in `ai/services.ts`) or through an offline batch adapter (e.g., Google Veo, Alibaba Wan, or any future video diffusion API), the pipeline guarantees coherent results by enforcing strict input invariants before generation and deterministic normalization after generation:

### Required Provider & Request Invariants
1. **Reference Image Input:** A master `1:1` square (`720×720` or `960×960`) or turnaround frame pre-padded on pure `#FF00FF` magenta so extending limbs never clip the canvas border.
2. **Fixed Camera & Background:** The prompt and provider settings must lock the camera (zero pan, zoom, or tilt) and preserve the flat `#FF00FF` background throughout all frames.
3. **Disable Automatic Prompt Rewriting / Expansion:** If the underlying video API has an internal LLM prompt rewriter (such as `enable_prompt_expansion` on Wan/Replicate or prompt enhancement flags on other providers), it **must be disabled (`false`)**. Prompt expansion causes models to hallucinate two-handed gestures, spellcasting auras, or weapons.
4. **Negative Constraints:** When supported by the provider, pass the negative prompt template below (otherwise append as an explicit `Avoid:` clause in the prompt).

```ts
// Example provider-agnostic request shape:
const request = {
  image: dataUriOrBuffer,          // 1:1 padded master image on #FF00FF
  prompt: viewSpecificPrompt,      // Base style prefix + facing choreography (Section 6)
  negativePrompt: NEGATIVE_PROMPT, // Strict negative constraints
  durationSeconds: 5,              // Enough frames to sample a clean 10–12 frame cycle
  resolution: '720p',
  aspectRatio: '1:1',
  promptExpansion: false,          // MUST BE FALSE whenever the API offers prompt rewriting
};
```

> [!IMPORTANT]
> Always disable provider-side prompt expansion/rewriting so the choreography and single-handed strike rules in Section 6 are followed word for word.

### Negative Prompt Template:
```text
spellcasting, magic, aura, glow, two hands, two arms punching, dual strike, waving, raising off-hand, left arm punch, turning body, rotating, changing facing direction, moving feet, walking, running, jumping, weapons, swords, bows, camera movement, zoom, pan, tilt, lighting changes, shadows, shading, textures, outlines, realistic
```

---

## 6. Prompting Formulas by Facing

### Base Style Prefix (Prepend to all prompts):
```text
Stylised low-poly isometric fantasy game art, light-neutral.
Flat faceted shapes built from large flat geometric planes with crisp hard edges, clean vector/cut-paper aesthetic.
NO LIGHTING AT ALL: every material is one single flat base colour across all its facets, unlit flat shading, no lit side, no shadow side, no highlights, no gradients, no glow.
Solid pure flat magenta (#FF00FF) background throughout the entire video. Camera strictly fixed orthographic isometric view. Zero camera motion, zero zoom, zero panning.
A single static {CHARACTER_DESCRIPTION}.
```

### View 1: `front-left` (Facing Lower-Left)
```text
Standing in 3/4 front view facing LOWER-LEFT.
STRICT COMBAT CHOREOGRAPHY — REAR RIGHT CROSS PUNCH:
1. Windup: The character coils their torso slightly back.
2. The Strike: The character delivers a single swift, powerful cross punch strictly using their rear RIGHT arm. The striking RIGHT arm originates from behind the chest and drives forward across the torso toward the lower-left corner in a straight punch with closed fist, holds at peak extension, and then retracts smoothly back behind the torso.
3. Recovery: Returns smoothly to neutral standing guard.
STRICT ANATOMICAL CONSTRAINTS:
- REAR RIGHT ARM ONLY: The strike is executed exclusively by the anatomical right arm.
- OFF-HAND LOCKED: The forward LEFT arm remains held tightly against the chest in a static defensive guard throughout the entire motion. The left arm NEVER punches, NEVER raises, and NEVER moves outward.
- Zero spellcasting, zero magic, zero two-handed somatic gestures.
- Feet remain planted firmly on the ground baseline. Clean seamless loop returning to the exact starting standing idle pose.
```

### View 2: `front-right` (Facing Lower-Right)
```text
Standing in 3/4 front view facing LOWER-RIGHT.
STRICT COMBAT CHOREOGRAPHY — LEAD RIGHT PUNCH:
1. Windup: The character draws the right fist slightly back to the ribcage.
2. The Strike: The character delivers a single swift, powerful straight punch strictly using their forward RIGHT arm toward the lower-right corner, holds at peak extension, and then retracts smoothly back to resting guard.
3. Recovery: Returns smoothly to neutral standing guard.
STRICT ANATOMICAL CONSTRAINTS:
- FORWARD RIGHT ARM ONLY: The strike is executed exclusively by the forward right arm.
- OFF-HAND LOCKED: The rear LEFT arm remains held tightly against the chest in a static defensive guard throughout the entire motion. The left arm NEVER punches, NEVER raises, and NEVER gestures.
- Zero spellcasting, zero magic, zero two-handed somatic gestures.
- Feet remain planted firmly on the ground baseline. Clean seamless loop returning to the exact starting standing idle pose.
```

### View 3: `back-left` (Facing Upper-Left, Seen From Behind)
```text
Standing in 3/4 back view facing UPPER-LEFT. Turned away from viewer, face hidden, showing back and left shoulder nearer to viewer.
STRICT COMBAT CHOREOGRAPHY — RIGHT ARM FORWARD PUNCH:
1. Windup: The character draws the right shoulder slightly back.
2. The Strike: The character drives a single swift, powerful punch forward into the distance toward the upper-left corner strictly using their anatomical RIGHT arm (on viewer right).
3. Recovery: The right arm retracts smoothly back to the side.
STRICT ANATOMICAL CONSTRAINTS:
- RIGHT ARM ONLY: The punch is executed strictly by the anatomical right arm.
- LEFT ARM LOCKED: The left arm remains held in front of the chest, motionless and hidden.
- Zero body turning, zero rotating stance. Feet remain planted firmly on the ground baseline throughout. Clean seamless loop returning to the exact starting standing idle pose facing upper-left.
```

### View 4: `back-right` (Facing Upper-Right, Seen From Behind)
```text
Standing in 3/4 back view facing UPPER-RIGHT. Turned away from viewer, face hidden, showing back and right shoulder nearer to viewer.
STRICT COMBAT CHOREOGRAPHY — RIGHT ARM FORWARD PUNCH:
1. Windup: The character draws the right shoulder slightly back.
2. The Strike: The character drives a single swift, powerful punch forward into the distance toward the upper-right corner strictly using their anatomical RIGHT arm (on viewer right).
3. Recovery: The right arm retracts smoothly back to the side.
STRICT ANATOMICAL CONSTRAINTS:
- RIGHT ARM ONLY: The punch is executed strictly by the anatomical right arm.
- LEFT ARM LOCKED: The left arm remains held in front of the chest, motionless and hidden.
- Zero body turning, zero rotating stance. Feet remain planted firmly on the ground baseline throughout. Clean seamless loop returning to the exact starting standing idle pose facing upper-right.
```

---

## 7. Slicing, Keying, and Normalization Pipeline

The import tool (`scripts/import-all-beastfolk-attacks.ts`) executes the following operations:

1. **Frame Selection (12 Frames @ 15 fps):**
   - Samples 12 calibrated frames capturing the full cycle: Idle (1) $\rightarrow$ Windup (2–4) $\rightarrow$ Peak Impact (5–7) $\rightarrow$ Recoil (8–9) $\rightarrow$ Recovery to Idle (10–12).
2. **Lossless Chroma-Keying:**
   - Calls `removeKeyBackground(crop, 80, { holes: true })` from `packages/server/src/assets/postprocess.ts` to convert `#FF00FF` to full transparency (`alpha = 0`).
   - Calls `removeKeySpill(png)` to eliminate edge magenta reflection on character rim pixels.
3. **Island Segmentation (Safe Component Filter):**
   - Keeps the largest connected component (the character).
   - Rejects small disconnected background specks ($<15\%$ of main body).
   - **Never use hardcoded coordinate border pruning** (e.g. `x < 8`), as it clips extending fingertips or claws.
4. **Standard Height Normalization:**
   - Calls `normalizeWalk(directionsFrames, { bodyHeight })` from `packages/server/src/assets/walk-frames.ts`.
   - For players and humanoids, `bodyHeight = CHARACTER_HEIGHT` (`168px` from `@co-mmo/shared`).
   - For creatures, `bodyHeight` is set to the creature's canonical size tier height (`tiny` = `64px`, `small` = `112px`, `medium` = `168px`, `high` = `224px`, `colossal` = `320px`).
   - Scales the median figure height across all 4 facings to the target `bodyHeight` and centers feet on the ground baseline, ensuring visual coherence independent of the source video model's framing.
5. **Asset Output:**
   - Strips written to `packages/client/public/art/${charId}-attack-${way}.png`.
   - Manifest entry written to `packages/client/public/art/manifest.json`:
     ```json
     "${charId}-attack-${way}": {
       "file": "art/${charId}-attack-${way}.png",
       "kind": "walk",
       "width": 3000,
       "height": 249,
       "frames": 12,
       "cycleSeconds": 0.8
     }
     ```

## 8. Held Items

Character looks have empty hands. Weapons and off-hand items are separate
pictures that the hand finder places on the found hand and grip. Each of the
fourteen weapon families and four off-hand families also has a plain picture
of its own (`held-<family>`, in `packages/server/src/assets/held-anchors.ts`).
A wished weapon shows its family's picture in the hand until its own picture
is painted, and sends the family picture as its first reference when it is
painted (`heldArts` in `packages/shared/src/held.ts`).
