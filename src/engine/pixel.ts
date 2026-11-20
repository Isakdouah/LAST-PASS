// The pixel look: every layer renders into one small picture (about 360 px tall),
// which is then snapped to the fixed palette with ordered (Bayer) dithering and
// blown up with hard square pixels. Text is drawn separately, sharp, by the HUD.
import * as THREE from 'three';

/** Palette ramps (dark to light). The bleak night: blue-black space, sodium orange,
 *  ash grey, smoke brown, fire red; plus the Earth's day colours and the green dead. */
const RAMPS: [number, number, number][][] = [
  [[4, 5, 9], [10, 12, 22], [18, 22, 38], [30, 36, 58], [48, 56, 84], [74, 84, 116]], // space / night blue
  [[8, 18, 40], [14, 32, 66], [24, 54, 98], [40, 82, 130], [70, 120, 166]], // ocean
  [[26, 26, 30], [44, 43, 48], [66, 64, 68], [94, 92, 94], [128, 126, 124], [170, 168, 162], [214, 212, 204], [244, 242, 234]], // ash grey to white
  [[34, 24, 18], [56, 40, 28], [84, 62, 42], [118, 90, 62], [156, 126, 90], [196, 168, 126]], // smoke brown / desert
  [[20, 30, 20], [32, 50, 30], [50, 72, 40], [76, 98, 54], [110, 128, 72]], // land green
  [[60, 30, 12], [110, 58, 18], [168, 92, 28], [218, 138, 46], [250, 196, 96], [255, 232, 168]], // sodium light
  [[60, 10, 12], [110, 18, 18], [170, 34, 24], [226, 58, 30], [255, 120, 40]], // blood and fire red
  [[34, 70, 30], [70, 140, 52], [112, 220, 80], [180, 250, 140]], // the dead
  [[40, 60, 120], [70, 110, 200], [120, 170, 255]], // police / armed blue
  [[60, 50, 70], [96, 84, 104]], // dusk violet
];
export const PALETTE: [number, number, number][] = RAMPS.flat();

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const POST_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec2 res;
uniform vec3 pal[${PALETTE.length}];
uniform float usePalette;
uniform float spread;
uniform float thermal;
varying vec2 vUv;
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  float m[16];
  m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
  m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
  for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
  return 0.5;
}
void main() {
  vec2 px = floor(vUv * res);
  vec3 c = texture2D(tScene, (px + 0.5) / res).rgb;
  if (thermal > 0.5) {
    // Thermal camera: heat lives in the blue channel the scene writes when thermal is on.
    float l = dot(c, vec3(0.3, 0.5, 0.2));
    c = mix(vec3(0.04, 0.03, 0.10), vec3(1.0, 0.96, 0.86), smoothstep(0.05, 0.9, l));
  }
  if (usePalette < 0.5) { gl_FragColor = vec4(c, 1.0); return; }
  vec3 d = c + (bayer(px) - 0.5) * spread;
  float best = 1e9; vec3 o = vec3(0.0);
  for (int k = 0; k < ${PALETTE.length}; k++) {
    vec3 e = d - pal[k];
    // weight green a little more (the eye is most sensitive to it)
    float dist = dot(e * e, vec3(0.3, 0.45, 0.25));
    if (dist < best) { best = dist; o = pal[k]; }
  }
  gl_FragColor = vec4(o, 1.0);
}`;

export class Pixel {
  renderer: THREE.WebGLRenderer;
  target: THREE.WebGLRenderTarget;
  private post: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Internal picture size (low resolution). */
  w = 640;
  h = 360;
  scale = 1;

  constructor(public canvas: HTMLCanvasElement, public lowHeight = 360) {
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.target = new THREE.WebGLRenderTarget(this.w, this.h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      type: THREE.UnsignedByteType,
    });
    const mat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tScene: { value: this.target.texture },
        res: { value: new THREE.Vector2(this.w, this.h) },
        pal: { value: PALETTE.map((c) => new THREE.Vector3(c[0] / 255, c[1] / 255, c[2] / 255)) },
        usePalette: { value: 1 },
        spread: { value: 0.09 },
        thermal: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.post.frustumCulled = false;
    this.postScene.add(this.post);
    this.resize();
  }

  get uniforms() {
    return this.post.material.uniforms;
  }

  resize() {
    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setSize(W, H, true);
    // Whole-number pixel blow-up when it fits, so every square pixel is the same size.
    const s = Math.max(1, Math.round(H / this.lowHeight));
    this.scale = s;
    this.h = Math.ceil(H / s);
    this.w = Math.ceil(W / s);
    this.target.setSize(this.w, this.h);
    this.uniforms.res.value.set(this.w, this.h);
  }

  begin(clear = 0x04050a) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.setClearColor(clear, 1);
    r.clear(true, true, true);
  }
  layer(scene: THREE.Scene, cam: THREE.Camera) {
    this.renderer.clearDepth();
    this.renderer.render(scene, cam);
  }
  end() {
    const r = this.renderer;
    r.setRenderTarget(null);
    r.clear(true, true, true);
    r.render(this.postScene, this.postCam);
  }
}
