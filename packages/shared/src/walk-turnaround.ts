import { ISO_WAYS, type IsoWay, TURNTABLE_WAYS } from './walk.ts';

export const ISO_WAY_LABELS: Record<IsoWay, string> = {
  'front-left': 'towards us, left',
  'front-right': 'towards us, right',
  'back-left': 'away, left',
  'back-right': 'away, right',
};

export const ISO_WAY_CORNERS: Record<IsoWay, string> = {
  'front-left': 'lower-left corner',
  'front-right': 'lower-right corner',
  'back-left': 'upper-left corner',
  'back-right': 'upper-right corner',
};

const SEEN_BIPED: Record<IsoWay, string> = {
  'front-left': "in a three-quarter view from the front, facing the LOWER-LEFT corner of the picture: the nose, chest and toes point towards the viewer's left, exactly halfway between facing the viewer and a profile facing the left edge of the picture; their LEFT shoulder is nearer to us and their right shoulder further away",
  'front-right': "in a three-quarter view from the front, facing the LOWER-RIGHT corner of the picture: the nose, chest and toes point towards the viewer's right, exactly halfway between facing the viewer and a profile facing the right edge of the picture; their RIGHT shoulder is nearer to us and their left shoulder further away",
  'back-left': "in a three-quarter view from behind, facing the UPPER-LEFT corner of the picture: turned away from us and towards the viewer's left, exactly halfway between seen from behind and a profile facing the left edge of the picture; we see their back and the back of the head, the face hidden; their LEFT shoulder is nearer to us",
  'back-right': "in a three-quarter view from behind, facing the UPPER-RIGHT corner of the picture: turned away from us and towards the viewer's right, exactly halfway between seen from behind and a profile facing the right edge of the picture; we see their back and the back of the head, the face hidden; their RIGHT shoulder is nearer to us",
};

const SEEN_QUADRUPED: Record<IsoWay, string> = {
  'front-left': "in a three-quarter view from the front, facing diagonally toward the LOWER-LEFT corner of the picture: the muzzle, chest and four hooves point towards the viewer's left, exactly halfway between facing the viewer and a profile facing the left edge of the picture; their LEFT flank and front-left leg are nearer to us and their right flank further away",
  'front-right': "in a three-quarter view from the front, facing diagonally toward the LOWER-RIGHT corner of the picture: the muzzle, chest and four hooves point towards the viewer's right, exactly halfway between facing the viewer and a profile facing the left edge of the picture; their RIGHT flank and front-right leg are nearer to us and their left flank further away",
  'back-left': "in a three-quarter view from behind, facing diagonally toward the UPPER-LEFT corner of the picture: turned away from us and towards the viewer's left, exactly halfway between seen from behind and a profile facing the left edge of the picture; we see their back, rump, and the back of the head, the muzzle hidden; their LEFT flank is nearer to us",
  'back-right': "in a three-quarter view from behind, facing diagonally toward the UPPER-RIGHT corner of the picture: turned away from us and towards the viewer's right, exactly halfway between seen from behind and a profile facing the right edge of the picture; we see their back, rump, and the back of the head, the muzzle hidden; their RIGHT flank is nearer to us",
};

const WRONG_CORNER: Record<IsoWay, string> = {
  'front-left': 'facing the lower-right corner',
  'front-right': 'facing the lower-left corner',
  'back-left': 'facing the upper-right corner',
  'back-right': 'facing the upper-left corner',
};

export type AngleReferenceType = 'standing' | 'clip';
export type AngleTargetType = 'standing' | 'clip';

export interface AngleTurnaroundOptions {
  name: string;
  sourceDirection: IsoWay;
  targetDirection: IsoWay;
  referenceType: AngleReferenceType;
  targetType: AngleTargetType;
  body?: string;
  kind?: string;
}

export interface AngleTurnaroundResult {
  prompt: string;
  rotationSummary: string;
  sourceLabel: string;
  targetLabel: string;
  sourceCorner: string;
  targetCorner: string;
  deltaDegrees: number;
}

/**
 * Calculates rotation step and angle around the isometric turntable:
 * TURNTABLE_WAYS: front-left (0), front-right (1), back-right (2), back-left (3).
 */
export function calculateIsometricRotation(source: IsoWay, target: IsoWay): {
  deltaDegrees: number;
  rotationSummary: string;
  rotationInstruction: string;
} {
  const sIdx = TURNTABLE_WAYS.indexOf(source);
  const tIdx = TURNTABLE_WAYS.indexOf(target);
  const step = (tIdx - sIdx + 4) % 4;
  const sLabel = ISO_WAY_LABELS[source];
  const tLabel = ISO_WAY_LABELS[target];
  const sCorner = ISO_WAY_CORNERS[source];
  const tCorner = ISO_WAY_CORNERS[target];

  if (step === 1) {
    return {
      deltaDegrees: 90,
      rotationSummary: `Rotated 90° clockwise: ${sLabel} (${sCorner}) → ${tLabel} (${tCorner})`,
      rotationInstruction: `Rotate 90 degrees clockwise on the isometric turntable: from facing ${sLabel} (${sCorner}) to facing ${tLabel} (${tCorner}).`,
    };
  }
  if (step === 3) {
    return {
      deltaDegrees: -90,
      rotationSummary: `Rotated 90° counter-clockwise: ${sLabel} (${sCorner}) → ${tLabel} (${tCorner})`,
      rotationInstruction: `Rotate 90 degrees counter-clockwise on the isometric turntable: from facing ${sLabel} (${sCorner}) to facing ${tLabel} (${tCorner}).`,
    };
  }
  return {
    deltaDegrees: 180,
    rotationSummary: `Rotated 180° to opposite diagonal: ${sLabel} (${sCorner}) → ${tLabel} (${tCorner})`,
    rotationInstruction: `Rotate 180 degrees to the opposite diagonal on the isometric turntable: from facing ${sLabel} (${sCorner}) to facing ${tLabel} (${tCorner}).`,
  };
}

/**
 * Generates an exact prompt to copy a single standing image or walking clip as reference,
 * changing the viewing angle to one of the other 3 isometric angles while preserving
 * character identity, anatomy, colors, and art style.
 */
export function generateAngleTurnaroundPrompt(options: AngleTurnaroundOptions): AngleTurnaroundResult {
  const { name, sourceDirection, targetDirection, referenceType, targetType, body, kind } = options;

  const isQuadruped = body === 'four-legged' || body?.includes('four-legged') || kind === 'creature' || kind === 'monster';
  const seenTable = isQuadruped ? SEEN_QUADRUPED : SEEN_BIPED;
  const targetSeen = seenTable[targetDirection];
  const sourceLabel = ISO_WAY_LABELS[sourceDirection];
  const targetLabel = ISO_WAY_LABELS[targetDirection];
  const sourceCorner = ISO_WAY_CORNERS[sourceDirection];
  const targetCorner = ISO_WAY_CORNERS[targetDirection];

  const { deltaDegrees, rotationSummary, rotationInstruction } = calculateIsometricRotation(sourceDirection, targetDirection);

  const subject = isQuadruped ? 'creature' : 'character';
  const referenceDesc = referenceType === 'clip'
    ? `the single attached walking animation clip (showing ${name} walking ${sourceLabel})`
    : `the single attached standing image (showing ${name} standing, facing ${sourceLabel})`;

  if (targetType === 'standing') {
    const prompt = [
      'Stylised low-poly isometric fantasy game art, light-neutral.',
      'Flat faceted shapes built from a few large flat planes with crisp hard edges, like cut paper or a clean vector illustration.',
      'NO LIGHTING AT ALL: every material is one single flat base colour on all its facets, with no lit side, no shadow side, no highlights, no gradients and no glow; facets are shown only by a very thin, slightly darker seam where two planes meet. No outlines, no texture, no noise.',
      'A small harmonious palette of soft, muted warm pastels. No writing anywhere.',
      '',
      `Paint ${name} using ${referenceDesc} as the single ground-truth reference, full body, standing in a relaxed pose, ${targetSeen}.`,
      '',
      'ROTATION & ANGLE TURNAROUND:',
      `- ${rotationInstruction}`,
      '- Camera angle: Classic 2:1 dimetric isometric view looking down at about 30 degrees from the corner.',
      '- Do NOT mirror or invert asymmetric features incorrectly; maintain true 3D spatial rotation of the subject.',
      '',
      'EXACT IDENTITY & SUBJECT PRESERVATION:',
      `- Copy ${name} from the reference with 100% fidelity: exact head, face, horns, fleece/coat, clothing, gear, proportions, silhouette, and colours.`,
      '- Do NOT invent new features, do NOT alter colours, and do NOT change design elements.',
      '- Treat this as rotating the exact same 3D character model to a different isometric viewing angle.',
      '',
      'FRAMING & BACKGROUND:',
      '- Exactly one figure, centred, with wide empty margin all around.',
      '- Background: one flat solid pure magenta (#FF00FF) filling everything behind the subject, with no floor, scenery, gradient, glow, vignette or shadow on it. No magenta anywhere in the subject.',
      '',
      `AVOID: second figure, turnaround sheet, grid lines, cast shadow, ground plane, photographic textures, shiny specular gloss, realistic fur, face looking directly at camera, flat 2D side profile, ${WRONG_CORNER[targetDirection]}.`,
    ].join('\n');

    return {
      prompt,
      rotationSummary,
      sourceLabel,
      targetLabel,
      sourceCorner,
      targetCorner,
      deltaDegrees,
    };
  }

  // targetType === 'clip'
  const gait = isQuadruped
    ? 'a steady four-legged quadruped walk with legs stepping in alternating pairs'
    : body === 'six-legged'
      ? 'a steady scuttle with legs stepping in clear alternating sets'
      : 'a brisk, cheerful walk with clear alternating steps and arms swinging';

  const walkLocomotion = isQuadruped
    ? `walks in place along the isometric diagonal ${targetSeen}: ${gait}.`
    : `walks in place ${targetSeen}, like on a treadmill: ${gait}.`;

  const prompt = [
    'Stylised low-poly isometric game character animation: flat faceted shapes in flat unlit colours that stay the same the whole time.',
    '',
    `The ${subject} from ${referenceDesc} ${walkLocomotion}`,
    '',
    'ROTATION & MOTION:',
    `- ${rotationInstruction}`,
    '- The body strictly keeps exactly this three-quarter isometric diagonal turn the whole time, never turning square to the camera or rotating into a side profile or flank view.',
    '- Ground contact: Every foot/hoof that touches the ground stays planted firmly where it lands until it lifts again, with no sliding, gliding, or ice-skating.',
    '- Seamless cycle: Steady, synchronized walk cycle that loops cleanly back to the starting pose.',
    '',
    'CHARACTER CONSISTENCY:',
    `- Copy the exact ${subject} from the reference: identical anatomy, head, horns, fur/fleece, clothing, gear, colours, proportions, and low-poly faceted game art style.`,
    '- Everything carried stays in the appropriate hand and on the appropriate side of the body as the figure rotates.',
    '',
    'CAMERA & BACKGROUND:',
    `- The camera is completely still: no zoom, no pan, no tracking, no camera rotation. The ${subject} stays in the centre of the picture at the same size and never turns.`,
    `- The background MUST stay one flat, even, solid pure magenta colour (#FF00FF) in every single frame the entire time, with no floor, shadow, scenery, darkening, fading to black, or lighting change. The character is keyed against magenta; never change or fade the background color. Only this one ${subject}, no one else. No text.`,
  ].join('\n');

  return {
    prompt,
    rotationSummary,
    sourceLabel,
    targetLabel,
    sourceCorner,
    targetCorner,
    deltaDegrees,
  };
}
