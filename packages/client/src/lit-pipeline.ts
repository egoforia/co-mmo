import Phaser from 'phaser';
import { RIM_LIGHT, type Sun } from '@co-mmo/shared';

// The shader every world picture is drawn with: Phaser's Light2D, plus the
// sun or moon shining from one side and a rim light on characters. Each
// pixel is its painted colour times the sky's colour (all round, and more on
// the side facing the sun), plus lamps nearby, plus the rim on outlines. The
// same sum is `lightOn` in @co-mmo/shared, which God's View previews with.

/** The pipeline for scenery, ground and buildings. */
export const LIT = 'Lit';
/** The pipeline for characters, creatures and what they hold: the same, with a rim light. */
export const LIT_FIGURE = 'LitFigure';

const FRAG = `
#define SHADER_NAME CO_MMO_LIT_FS
precision mediump float;

struct Light { vec2 position; vec3 color; float intensity; float radius; };
const int kMaxLights = %LIGHT_COUNT%;

uniform vec4 uCamera;
uniform vec2 uResolution;
uniform sampler2D uMainSampler;
uniform sampler2D uNormSampler;
uniform vec3 uAmbientLightColor;
uniform Light uLights[kMaxLights];
uniform mat3 uInverseRotationMatrix;
uniform int uLightCount;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uFill;
uniform vec3 uRim;
uniform float uFlipX;

varying vec2 outTexCoord;
varying float outTexId;
varying float outTintEffect;
varying vec4 outTint;

void main ()
{
    vec4 texel = vec4(outTint.bgr * outTint.a, outTint.a);
    vec4 texture = texture2D(uMainSampler, outTexCoord);
    vec4 color = texture * texel;
    if (outTintEffect == 1.0) color.rgb = mix(texture.rgb, outTint.bgr * outTint.a, texture.a);
    else if (outTintEffect == 2.0) color = texel;

    vec3 facing = texture2D(uNormSampler, outTexCoord).rgb * 2.0 - 1.0;
    facing.x *= uFlipX;
    vec3 normal = normalize(uInverseRotationMatrix * facing);
    vec2 res = vec2(min(uResolution.x, uResolution.y)) * uCamera.w;

    // The sky all round, and the sun or moon on the side facing it.
    vec3 light = uAmbientLightColor * (uFill + uSunColor * max(dot(normal, uSunDir), 0.0));

    // Lamps nearby.
    for (int index = 0; index < kMaxLights; ++index)
    {
        if (index < uLightCount)
        {
            Light lamp = uLights[index];
            vec3 lampDir = vec3((lamp.position.xy / res) - (gl_FragCoord.xy / res), 0.1);
            float distToSurf = length(lampDir) * uCamera.w;
            float radius = (lamp.radius / res.x * uCamera.w) * uCamera.w;
            float attenuation = clamp(1.0 - distToSurf * distToSurf / (radius * radius), 0.0, 1.0);
            light += lamp.color * max(dot(normal, normalize(lampDir)), 0.0) * attenuation * lamp.intensity;
        }
    }

    // The rim: outlines, where the surface turns away from us.
    float edge = 1.0 - clamp(normal.z, 0.0, 1.0);
    light += uRim * edge * edge;

    // Room for a glow map next: painted flames and windows that shine on
    // their own would be added here, after the light, so night cannot dim them.
    gl_FragColor = color * vec4(light, 1.0);
}
`;

/** The sun or moon and how much the sky lights all round, shared by every lit pipeline. */
const sky = { sun: { dir: [0, 0, 1], color: [0, 0, 0] } as Sun, fill: 1 };

/** Sets the sun or moon and the sky's all-round share for this frame. */
export function setSun(sun: Sun, fill: number): void {
  sky.sun = sun;
  sky.fill = fill;
}

/** Light2D with the sun, the sky's fill and, for characters, a rim light. */
export class LitPipeline extends Phaser.Renderer.WebGL.Pipelines.LightPipeline {
  protected rim: [number, number, number] = [0, 0, 0];
  /** -1 while drawing a picture shown mirrored, whose normal map must face the other way too. */
  private flip = 1;

  constructor(game: Phaser.Game, name = LIT) {
    super({ game, name, fragShader: FRAG } as Phaser.Types.Renderer.WebGL.WebGLPipelineConfig);
  }

  onRender(scene: Phaser.Scene, camera: Phaser.Cameras.Scene2D.Camera): void {
    super.onRender(scene, camera);
    if (!this.lightsActive) return;
    const { dir, color } = sky.sun;
    this.set3f('uSunDir', dir[0], dir[1], dir[2]);
    this.set3f('uSunColor', color[0], color[1], color[2]);
    this.set1f('uFill', sky.fill);
    this.set3f('uRim', this.rim[0], this.rim[1], this.rim[2]);
    this.set1f('uFlipX', this.flip);
  }

  // Light2D turns normal maps with their picture but does not mirror them, so
  // a picture shown flipped would be lit from the wrong side.
  setGameObject(gameObject: Phaser.GameObjects.GameObject, frame?: Phaser.Textures.Frame): number {
    const unit = super.setGameObject(gameObject, frame);
    const flip = (gameObject as Phaser.GameObjects.Image).flipX ? -1 : 1;
    if (flip !== this.flip) {
      if (this.vertexCount > 0) this.flush();
      this.flip = flip;
      this.set1f('uFlipX', flip);
    }
    return unit;
  }
}

/** The same, with the rim light that keeps characters readable. */
export class LitFigurePipeline extends LitPipeline {
  constructor(game: Phaser.Game) {
    super(game, LIT_FIGURE);
    this.rim = RIM_LIGHT;
  }
}
