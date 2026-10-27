// Combat visual feedback: damage numbers, lunges, slash arcs, Firebolt
// projectiles with dynamic point lights, and defeated creature fade-outs.

import Phaser from 'phaser';
import {
  ABILITIES,
  ITEMS,
  WEAPON_FAMILIES,
  isWalkDirection,
  type HitMessage,
} from '@co-mmo/shared';
import { dropLight, litFigure, makeLight, placeLight } from '../lights.ts';
import { PROJECTION } from '../projection.ts';
import {
  type Avatar,
  BOLT_LIGHT,
  LABEL_DEPTH,
  type Remote,
  T,
  wayOnScreen,
} from './types.ts';

/** A strike landed: number, flash and recoil, or a defeat. */
export function showHit(
  scene: Phaser.Scene,
  hit: HitMessage,
  myId: string,
  me: Avatar,
  remotes: Map<string, Remote>,
  creatures: Map<string, Remote>,
  darkness: () => number,
): void {
  const target = hit.target === myId ? me : remotes.get(hit.target) ?? creatures.get(hit.target);
  const attacker = hit.by === myId ? me : remotes.get(hit.by) ?? creatures.get(hit.by);
  // Firebolt, and plain attacks of wands, staves and bells, fly as a painted spark.
  const isBolt = (hit.ability && ABILITIES[hit.ability]?.effect === 'bolt') || (hit.ranged && hit.damage === 'arcane');
  if (attacker && target && isBolt) fireBolt(scene, attacker, target, darkness);
  else if (attacker && attacker !== me && target) lunge(scene, attacker, toward(attacker, target));
  if (!target) return;
  const hurtMe = target === me;
  const number = scene.add
    .text(target.body.x + (Math.random() - 0.5) * T * 0.3, target.body.y - target.body.displayHeight * 0.8, `${hit.amount}`, {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontStyle: 'bold',
      fontSize: `${Math.round(T * 0.46)}px`,
      color: hurtMe ? '#f6757a' : '#ffffff',
      stroke: '#181425',
      strokeThickness: Math.round(T / 20),
    })
    .setOrigin(0.5)
    .setDepth(LABEL_DEPTH + 1);
  scene.tweens.add({ targets: number, y: number.y - T * 0.6, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => number.destroy() });
  target.body.setTintFill(0xffffff);
  scene.time.delayedCall(80, () => target.body.active && target.body.clearTint());
  if (hurtMe) scene.cameras.main.shake(120, 0.004);
  if (hit.defeated && target !== me) fadeOut(scene, target);
}

/** Our own strike: a lunge and a slash, whether or not it lands (no slash for bows, wands and other ranged weapons). */
export function swingSlash(scene: Phaser.Scene, me: Avatar, facingSign: number): void {
  // Along the isometric way we face, or left or right as we last walked.
  const aim = isWalkDirection(me.facing) ? { x: facingSign, y: 0 } : wayOnScreen(me.facing);
  lunge(scene, me, aim);
  const family = me.held ? ITEMS[me.held.item]?.weapon : undefined;
  if (!scene.textures.exists('fx-slash') || (family && WEAPON_FAMILIES[family].ranged)) return;
  // The painted slash curves like a C; mirror it so it bulges the way we face, tilted along the way.
  const right = aim.x > 0;
  const slash = scene.add.image(me.body.x + aim.x * T * 0.45, me.body.y - me.body.displayHeight * 0.45 + aim.y * T * 0.45, 'fx-slash');
  slash.setDisplaySize(T * 0.9, T * 0.9).setFlipX(right).setRotation(right ? Math.atan2(aim.y, aim.x) : Math.atan2(-aim.y, -aim.x)).setDepth(me.body.depth + 1);
  scene.tweens.add({ targets: slash, alpha: 0, duration: 220, onComplete: () => slash.destroy() });
}

/**
 * Which way an attacker lunges at whom it strikes, as a step on screen:
 * along the isometric way nearest them, which it turns to face.
 */
export function toward(a: Avatar, target: Avatar): { x: number; y: number } {
  if (isWalkDirection(a.facing) || !a.at || !target.at) return { x: Math.sign(target.body.x - a.body.x || 1), y: 0 };
  a.facing = PROJECTION.face(target.at.x - a.at.x, target.at.y - a.at.y, a.facing);
  return wayOnScreen(a.facing);
}

/** The painted Firebolt spark flies from the caster to the target. */
export function fireBolt(scene: Phaser.Scene, from: Avatar, to: Avatar, darkness: () => number): void {
  if (!scene.textures.exists('item-firebolt')) return;
  const y = (a: Avatar) => a.body.y - a.body.displayHeight * 0.5;
  const angle = Math.atan2(y(to) - y(from), to.body.x - from.body.x);
  const spark = scene.add.image(from.body.x, y(from), 'item-firebolt').setDisplaySize(T * 0.6, T * 0.6).setRotation(angle).setDepth(LABEL_DEPTH);
  // The flame lights the ground it flies over.
  const lit = makeLight(scene, BOLT_LIGHT);
  const follow = () => lit && placeLight(lit, spark.x, spark.y, scene.time.now, spark.alpha > 0.2, darkness());
  follow();
  scene.tweens.add({
    targets: spark, x: to.body.x, y: y(to), duration: 180, ease: 'Quad.easeIn', onUpdate: follow,
    onComplete: () => scene.tweens.add({
      targets: spark, scale: spark.scale * 1.8, alpha: 0, duration: 160, onUpdate: follow,
      onComplete: () => { spark.destroy(); dropLight(scene, lit); },
    }),
  });
}

/** A short jab and back along `aim`, a step on screen one long. */
export function lunge(scene: Phaser.Scene, a: Avatar, aim: { x: number; y: number }): void {
  scene.tweens.add({ targets: a.nudge, x: aim.x * T * 0.18, y: aim.y * T * 0.18, duration: 70, yoyo: true, ease: 'Quad.easeOut' });
}

/** A defeated creature sinks away; the real sprite is removed by the next snapshot. */
export function fadeOut(scene: Phaser.Scene, a: Avatar): void {
  const ghost = litFigure(scene, scene.add.image(a.body.x, a.body.y, a.body.texture.key).setOrigin(0.5, 0.97));
  ghost.setScale(a.body.scaleX, a.body.scaleY).setFlipX(a.body.flipX).setDepth(a.body.depth);
  a.body.setVisible(false);
  scene.tweens.add({ targets: ghost, alpha: 0, scaleY: 0.1, duration: 450, ease: 'Quad.easeIn', onComplete: () => ghost.destroy() });
}
