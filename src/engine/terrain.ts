// The shape of the ground: real heights for the whole city box (USGS 3DEP via AWS Terrain
// Tiles, built by tools/build_terrain.py, about 40 m apart, in 0.6 m steps). Everything in the
// city is placed as if the ground were flat (y = 0) and lifted onto the real ground when drawn:
// the ground and small things follow it in their shaders, buildings get one lift each so
// they stand straight. Bare earth: the river sits down in its gorge, freeways in their trenches,
// and bridges are ours to build.
import * as THREE from 'three';
import T from '../data/terrain.json';

/** Height (m above sea level) drawn at y = 0: about the average of the city. */
export const REF = 260;
const W = T.w, H = T.h, PER = T.per;
const raw = Uint8Array.from(atob(T.data), (c) => c.charCodeAt(0));
const hm = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) hm[i] = raw[i] * T.step + T.min - REF;

/** Ground height (metres, relative to REF) at map cell (x, y), smoothly between samples. */
export function heightAt(x: number, y: number): number {
  const fx = Math.min(W - 1.001, Math.max(0, x * PER - 0.5)), fy = Math.min(H - 1.001, Math.max(0, y * PER - 0.5));
  const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
  const i = iy * W + ix;
  return hm[i] * (1 - ax) * (1 - ay) + hm[i + 1] * ax * (1 - ay) + hm[i + W] * (1 - ax) * ay + hm[i + W + 1] * ax * ay;
}

/** Real height above sea level (for tests and labels). */
export const elevation = (x: number, y: number) => heightAt(x, y) + REF;

let tex: THREE.DataTexture | null = null;
/** Shader uniforms: the heights as a texture, and where the map sits in local metres. */
export function terrainUniforms(halfW: number, halfH: number): Record<string, THREE.IUniform> {
  if (!tex) {
    tex = new THREE.DataTexture(raw, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
  }
  return {
    terrTex: { value: tex },
    terrBox: { value: new THREE.Vector4(-halfW, -halfH, halfW * 2, halfH * 2) },
    terrK: { value: new THREE.Vector2(255 * T.step, T.min - REF) },
    terrOn: { value: 1 },
  };
}

/** GLSL: terrH(xz) = ground height at a local x/z point (0 when switched off). */
export const TERRAIN_PARS = /* glsl */ `
uniform sampler2D terrTex; uniform vec4 terrBox; uniform vec2 terrK; uniform float terrOn;
float terrH(vec2 xz) {
  vec2 uv = clamp((xz - terrBox.xy) / terrBox.zw, 0.0, 1.0);
  return (texture2D(terrTex, uv).r * terrK.x + terrK.y) * terrOn;
}`;

/** Vertex code that replaces three.js's <project_vertex>: works out the flat world position
 *  (`twFlat`), lifts it onto the ground and projects it. Rigid = the whole object (or each
 *  instance) rises by the height under its origin, so it stands straight; per vertex = every
 *  point follows the ground (merged street furniture, lines). */
export function liftProject(perVertex: boolean): string {
  return `
  vec4 twFlat = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  twFlat = instanceMatrix * twFlat;
  #endif
  twFlat = modelMatrix * twFlat;
  ${
    perVertex
      ? 'vec2 tOrg = twFlat.xz;'
      : `#ifdef USE_INSTANCING
  vec2 tOrg = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  #else
  vec2 tOrg = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  #endif`
  }
  vec4 twLift = twFlat;
  twLift.y += terrH(tOrg);
  vec4 mvPosition = viewMatrix * twLift;
  gl_Position = projectionMatrix * mvPosition;`;
}

/** Lift a plain three.js material (basic, line) onto the ground. */
export function lifted<M extends THREE.Material>(mat: M, shared: Record<string, THREE.IUniform>, perVertex = false): M {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + TERRAIN_PARS).replace('#include <project_vertex>', liftProject(perVertex));
  };
  mat.customProgramCacheKey = () => 'lifted' + perVertex;
  return mat;
}
