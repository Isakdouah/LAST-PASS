// Real light near the camera: a map of where light falls, 512 m across round the point you
// look at, 2 m per square. Street lamps (sodium orange) go in one layer, headlights and gun
// flashes (white) in another that is redrawn every couple of frames. Every surface up close
// (walls, roofs, trees, people, cars, the ground) reads it at its own spot, so a person
// walking under a lamp lights up and goes dark again between lamps. The light comes in
// a few hard steps, not a smooth blur: that is the pixel-art way.
import * as THREE from 'three';

export const FIELD = 512; // metres across
const N = 256; // squares across

export const LIGHT_PARS = /* glsl */ `
uniform sampler2D lampTex; uniform sampler2D dynTex; uniform vec4 lightBox; uniform vec3 hazeR;
/** Night haze: what is further than where you look fades into smoky, sodium-lit air.
 *  hazeR = (start metres, span metres, strength). Stepped, like the light. */
vec3 haze(vec3 col, vec3 w) {
  if (hazeR.z <= 0.0) return col;
  float f = clamp((length(w - cameraPosition) - hazeR.x) / hazeR.y, 0.0, 1.0);
  f = floor(f * 6.0 + 0.5) / 6.0;
  return mix(col, vec3(0.115, 0.095, 0.085), f * hazeR.z);
}
/** Light at a world point: sodium lamps (cut by power loss) and white moving lights. */
vec3 fieldLight(vec3 w, float dark) {
  vec2 uv = (w.xz - lightBox.xy) / lightBox.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
  float h = max(0.0, w.y - 1.0);
  float lamp = texture2D(lampTex, uv).r * (1.0 - dark) * (0.3 + 0.7 * exp(-h / 7.0));
  float dyn = texture2D(dynTex, uv).r * exp(-h / 4.0);
  // Hard steps.
  lamp = floor(lamp * 5.0 + 0.35) / 5.0;
  dyn = floor(dyn * 4.0 + 0.35) / 4.0;
  return vec3(1.0, 0.62, 0.30) * lamp * 1.5 + vec3(1.0, 0.95, 0.82) * dyn * 1.6;
}
float inField(vec3 w) {
  vec2 uv = (w.xz - lightBox.xy) / lightBox.zw;
  vec2 e = min(uv, 1.0 - uv);
  return smoothstep(0.0, 0.08, min(e.x, e.y));
}`;

export interface LampAt {
  x: number; // local metres
  z: number;
}
export interface MovingLight {
  x: number;
  z: number;
  /** Heading in local x/z (radians, atan2(z, x)); NaN for a round light. */
  dir: number;
  power: number;
  reach: number;
}

export class LightField {
  readonly lampCanvas = document.createElement('canvas');
  readonly dynCanvas = document.createElement('canvas');
  readonly lampTex: THREE.CanvasTexture;
  readonly dynTex: THREE.CanvasTexture;
  /** x0, z0 of the field and its size (local metres). */
  readonly box = new THREE.Vector4(1e9, 1e9, FIELD, FIELD);
  /** Haze start, span (metres from the camera) and strength; strength 0 = off. */
  readonly hazeR = new THREE.Vector3(0, 1, 0);
  private key = '';

  constructor() {
    for (const c of [this.lampCanvas, this.dynCanvas]) (c.width = N), (c.height = N);
    const mk = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return t;
    };
    this.lampTex = mk(this.lampCanvas);
    this.dynTex = mk(this.dynCanvas);
  }

  uniforms(): Record<string, THREE.IUniform> {
    return { lampTex: { value: this.lampTex }, dynTex: { value: this.dynTex }, lightBox: { value: this.box }, hazeR: { value: this.hazeR } };
  }

  /** Centre the field near (cx, cz); lamps are only redrawn when it moves a step. */
  centre(cx: number, cz: number, lamps: (x0: number, z0: number, x1: number, z1: number) => LampAt[]) {
    const step = 64;
    const x0 = Math.round((cx - FIELD / 2) / step) * step, z0 = Math.round((cz - FIELD / 2) / step) * step;
    const key = x0 + ',' + z0;
    if (key === this.key) return;
    this.key = key;
    this.box.set(x0, z0, FIELD, FIELD);
    const g = this.lampCanvas.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'lighter';
    const s = N / FIELD;
    for (const l of lamps(x0, z0, x0 + FIELD, z0 + FIELD)) {
      const px = (l.x - x0) * s, py = (l.z - z0) * s, r = 15 * s;
      const gr = g.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.75)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.4)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    }
    this.lampTex.needsUpdate = true;
  }

  /** Headlights and flashes, every frame or two. */
  moving(list: MovingLight[]) {
    const g = this.dynCanvas.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'lighter';
    const s = N / FIELD, x0 = this.box.x, z0 = this.box.y;
    for (const l of list) {
      const px = (l.x - x0) * s, py = (l.z - z0) * s;
      if (px < -20 || py < -20 || px > N + 20 || py > N + 20) continue;
      const r = l.reach * s;
      g.save();
      g.translate(px, py);
      if (!Number.isNaN(l.dir)) {
        // A beam: a long oval out in front.
        g.rotate(l.dir);
        g.translate(r * 0.55, 0);
        g.scale(1, 0.42);
      }
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * (Number.isNaN(l.dir) ? 1 : 0.6));
      gr.addColorStop(0, `rgba(255,255,255,${Math.min(1, l.power)})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
    this.dynTex.needsUpdate = true;
  }
}

/** Make a plain (MeshBasic) material react to the light field: dim at night, lit under
 *  lamps and in headlights. Works for instanced and ordinary meshes. */
export function litBasic(mat: THREE.MeshBasicMaterial, shared: Record<string, THREE.IUniform>, ambient = 0.42): THREE.MeshBasicMaterial {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { litAmbient: { value: ambient } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLW;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vec4 lw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  lw = instanceMatrix * lw;
  #endif
  vLW = (modelMatrix * lw).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vLW;
uniform float litAmbient; uniform float thermal;
uniform sampler2D overS; uniform vec2 grid; uniform vec2 cellM;
${LIGHT_PARS}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
    vec2 cp = vec2(vLW.x / cellM.x + grid.x * 0.5, vLW.z / cellM.y + grid.y * 0.5);
    vec4 os = texture2D(overS, cp / grid);
    float dark = smoothstep(0.2, 0.8, os.a);
    float k = inField(vLW);
    vec3 L = vec3(litAmbient) + fieldLight(vLW, dark) + vec3(1.0, 0.4, 0.1) * os.r * os.r * 1.2;
    if (thermal < 0.5) outgoingLight = haze(outgoingLight * mix(vec3(1.0), L, k), vLW);
  }
  #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'litBasic' + ambient;
  return mat;
}
