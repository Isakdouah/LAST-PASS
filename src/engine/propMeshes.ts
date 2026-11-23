// 3D models for trees and street lamps: built from blocks (like the vehicles), drawn as
// instances per map tile, lit by the night (moonlight, the nearest street lamp, fire).
// Treetops dissolve in a pixel pattern where people are underneath, so trees never hide
// what is happening on the ground; the thermal camera sees through leaves.
import * as THREE from 'three';
import { LIGHT_PARS } from './lightfield';
import { hash, Lamp, Tree, TreeKind } from './props';

const V = 1.1; // block size in metres for crowns

interface Part {
  P: number[];
  C: number[];
  canopy: number[];
  glow: number[];
}
const newPart = (): Part => ({ P: [], C: [], canopy: [], glow: [] });

/** Add an axis-aligned box (centre, size) with simple face shading. */
function box(p: Part, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: [number, number, number], canopy: number, glow = 0, faces = 63) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  const quads: [number[], number, number][] = [
    [[x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0], 1.0, 1], // top
    [[x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], 0.45, 2], // bottom
    [[x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1], 0.78, 4], // +x
    [[x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], 0.62, 8], // -x
    [[x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], 0.7, 16], // +z
    [[x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0], 0.86, 32], // -z
  ];
  for (const [q, shade, bit] of quads) {
    if (!(faces & bit)) continue;
    const v = [0, 1, 2, 0, 2, 3];
    for (const i of v) {
      p.P.push(q[i * 3], q[i * 3 + 1], q[i * 3 + 2]);
      p.C.push(col[0] * shade, col[1] * shade, col[2] * shade);
      p.canopy.push(canopy);
      p.glow.push(glow);
    }
  }
}

function toGeometry(p: Part): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(p.C, 3));
  g.setAttribute('aCanopy', new THREE.Float32BufferAttribute(p.canopy, 1));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(p.glow, 1));
  g.computeBoundingSphere();
  return g;
}

/** Leaf colours by kind (before night light): maple orange, gold, red-brown oak, green,
 *  spruce, bare. */
const LEAF: [number, number, number][] = [
  [0.86, 0.4, 0.1],
  [0.86, 0.64, 0.16],
  [0.58, 0.2, 0.1],
  [0.3, 0.44, 0.18],
  [0.12, 0.26, 0.16],
  [0.34, 0.27, 0.22],
];
const BARK: [number, number, number] = [0.26, 0.2, 0.16];

/** One tree model per kind: a trunk and a crown of blocks (only outside faces kept). */
export function treeGeometry(kind: TreeKind): THREE.BufferGeometry {
  const p = newPart();
  const seed = kind * 101 + 7;
  if (kind === 4) {
    // Spruce: a trunk and stacked layers getting smaller to a point.
    box(p, 0, 1.0, 0, 0.5, 2, 0.5, BARK, 0);
    const layers = 6;
    for (let l = 0; l < layers; l++) {
      const r = (layers - l) * 0.55 + 0.4;
      const j = 0.9 + 0.2 * hash(seed + l);
      box(p, 0, 1.6 + l * 1.25, 0, r * 2, 1.25, r * 2, [LEAF[4][0] * j, LEAF[4][1] * j, LEAF[4][2] * j], 1);
    }
    return toGeometry(p);
  }
  const trunkH = kind === 5 ? 6 : 3.4;
  box(p, 0, trunkH / 2, 0, 0.55, trunkH, 0.55, BARK, 0);
  if (kind === 5) {
    // Bare: a few thick branches.
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2 + hash(seed + b);
      const len = 1.6 + hash(seed + b * 3) * 1.4;
      const y = 3.2 + hash(seed + b * 5) * 2.6;
      box(p, Math.cos(a) * len * 0.5, y, Math.sin(a) * len * 0.5, Math.abs(Math.cos(a)) * len + 0.3, 0.3, Math.abs(Math.sin(a)) * len + 0.3, BARK, 1);
    }
    return toGeometry(p);
  }
  // Leafy crown: blocks inside a lumpy ball; only faces with no neighbour are drawn.
  const R = 3; // in blocks
  const cells = new Set<string>();
  const key = (i: number, j: number, k: number) => `${i},${j},${k}`;
  for (let i = -R; i <= R; i++)
    for (let j = 0; j <= 2 * R; j++)
      for (let k = -R; k <= R; k++) {
        const dy = (j - R) / (R * 0.85);
        const d = Math.hypot(i / R, dy, k / R);
        if (d < 0.95 - 0.28 * hash(seed + i * 31 + j * 7 + k * 131)) cells.add(key(i, j, k));
      }
  const y0 = trunkH - 0.4;
  for (const c of cells) {
    const [i, j, k] = c.split(',').map(Number);
    let faces = 0;
    if (!cells.has(key(i, j + 1, k))) faces |= 1;
    if (!cells.has(key(i, j - 1, k))) faces |= 2;
    if (!cells.has(key(i + 1, j, k))) faces |= 4;
    if (!cells.has(key(i - 1, j, k))) faces |= 8;
    if (!cells.has(key(i, j, k + 1))) faces |= 16;
    if (!cells.has(key(i, j, k - 1))) faces |= 32;
    if (!faces) continue;
    // Each block a slightly different shade; a few blocks in the next colour (mixed leaves).
    const h = hash(seed + i * 13 + j * 17 + k * 19);
    const base = h < 0.12 ? LEAF[(kind + 1) % 4] : LEAF[kind];
    const s = 0.82 + 0.3 * hash(seed + i * 3 + j * 5 + k * 7) + (j / (2 * R)) * 0.12;
    box(p, i * V, y0 + j * V, k * V, V, V, V, [base[0] * s, base[1] * s, base[2] * s], 1, 0, faces);
  }
  return toGeometry(p);
}

/** A street lamp, 7.5 m: pole, arm out over the road (+z), the lamp head glowing. */
export function lampGeometry(): THREE.BufferGeometry {
  const p = newPart();
  const steel: [number, number, number] = [0.3, 0.31, 0.33];
  box(p, 0, 3.75, 0, 0.22, 7.5, 0.22, steel, 0);
  box(p, 0, 7.4, 1.1, 0.14, 0.14, 2.3, steel, 0);
  box(p, 0, 7.3, 2.25, 0.5, 0.22, 0.8, steel, 0, 0, 1 | 4 | 8 | 16 | 32);
  box(p, 0, 7.19, 2.25, 0.42, 0.02, 0.7, [1, 1, 1], 0, 1, 2); // the light, facing down
  return toGeometry(p);
}

const PROP_V = /* glsl */ `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aCanopy; attribute float aGlow; attribute float aFade; attribute float aWarm;
varying vec3 vC; varying float vFade; varying float vWarm; varying float vGlow; varying vec3 vW; varying float vY; varying float vCan;
void main() {
  vec3 c = color;
  #ifdef USE_INSTANCING_COLOR
  c *= instanceColor;
  #endif
  vC = c; vFade = aFade * aCanopy; vCan = aCanopy; vWarm = aWarm; vGlow = aGlow; vY = position.y;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
const PROP_F = /* glsl */ `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D overS; uniform vec2 grid; uniform vec2 cellM; uniform float time; uniform float thermal; uniform float alpha;
varying vec3 vC; varying float vFade; varying float vWarm; varying float vGlow; varying vec3 vW; varying float vY; varying float vCan;
${LIGHT_PARS}
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  // 4x4 ordered pattern, as a lookup by arithmetic.
  float a = mod(q.x, 2.0), b = mod(q.y, 2.0), c = floor(q.x / 2.0), d = floor(q.y / 2.0);
  return (8.0 * mod(a + b, 2.0) + 4.0 * b + 2.0 * mod(c + d, 2.0) + d + 0.5) / 16.0;
}
void main() {
  #include <logdepthbuf_fragment>
  float fade = vFade;
  if (thermal > 0.5) fade = max(fade, 0.8 * vCan);
  if (fade > 0.0 && bayer4(gl_FragCoord.xy) < fade) discard;
  vec2 cp = vec2(vW.x / cellM.x + grid.x * 0.5, vW.z / cellM.y + grid.y * 0.5);
  vec4 os = texture2D(overS, cp / grid);
  float dark = smoothstep(0.2, 0.8, os.a);
  // Night: a little cold moonlight, sodium light from the nearest lamp (strongest low
  // down), and fire glow when the block burns. Power cuts kill the lamps.
  vec3 moon = vec3(0.2, 0.23, 0.3);
  float lamp = vWarm * (1.0 - dark) * (0.35 + 0.65 * exp(-max(0.0, vY - 2.0) / 7.0));
  float flick = 0.8 + 0.2 * sin(time * 9.0 + cp.x * 3.0);
  vec3 near = mix(vec3(1.0, 0.66, 0.34) * lamp * 1.1, fieldLight(vW, dark), inField(vW));
  vec3 light = moon + near + vec3(1.0, 0.4, 0.1) * os.r * os.r * flick * 1.4;
  vec3 col = vC * light;
  if (vGlow > 0.5) col = mix(vec3(1.0, 0.78, 0.42), vec3(0.08, 0.08, 0.09), dark);
  if (thermal > 0.5) col = vec3(0.1, 0.1, 0.12) + vec3(0.1) * vGlow * (1.0 - dark);
  gl_FragColor = vec4(col, alpha);
}`;

export function propMaterial(shared: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: PROP_V,
    fragmentShader: PROP_F,
    uniforms: { ...shared, alpha: { value: 1 } },
    vertexColors: true,
    transparent: true,
  });
}

export interface TileTrees {
  meshes: THREE.InstancedMesh[];
  /** For each tree: which mesh, which instance, where (cells), and its fade. */
  list: { m: number; i: number; x: number; y: number; fade: number }[];
  /** Some treetop is (or was just) dissolved: keep updating this tile. */
  faded: boolean;
}

const treeGeo = new Map<number, THREE.BufferGeometry>();
let lampGeo: THREE.BufferGeometry | null = null;

/** Instanced meshes for a tile's trees, one per kind. */
export function buildTrees(trees: Tree[], mat: THREE.ShaderMaterial, toLocal: (x: number, y: number, out: THREE.Vector3) => THREE.Vector3): TileTrees {
  const byKind = new Map<number, Tree[]>();
  for (const t of trees) {
    let l = byKind.get(t.kind);
    if (!l) byKind.set(t.kind, (l = []));
    l.push(t);
  }
  const meshes: THREE.InstancedMesh[] = [];
  const list: TileTrees['list'] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), y = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  for (const [kind, ts] of byKind) {
    if (!treeGeo.has(kind)) treeGeo.set(kind, treeGeometry(kind as TreeKind));
    const g = treeGeo.get(kind)!.clone();
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(ts.length), 1);
    fade.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFade', fade);
    g.setAttribute('aWarm', new THREE.InstancedBufferAttribute(new Float32Array(ts.map((t) => t.warm)), 1));
    const im = new THREE.InstancedMesh(g, mat, ts.length);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ts.length * 3), 3);
    ts.forEach((t, i) => {
      toLocal(t.x, t.y, p);
      q.setFromAxisAngle(y, Math.floor(hash(t.seed * 3.1) * 4) * (Math.PI / 2));
      m.compose(p, q, s.setScalar(t.size));
      im.setMatrixAt(i, m);
      const v = 0.85 + hash(t.seed * 5.3) * 0.3;
      im.setColorAt(i, c.setRGB(v, v, v));
      list.push({ m: meshes.length, i, x: t.x, y: t.y, fade: 0 });
    });
    im.renderOrder = 0.4;
    im.frustumCulled = false;
    meshes.push(im);
  }
  return { meshes, list, faded: false };
}

/** Instanced street lamps for a tile. */
export function buildLamps(lamps: Lamp[], mat: THREE.ShaderMaterial, toLocal: (x: number, y: number, out: THREE.Vector3) => THREE.Vector3): THREE.InstancedMesh | null {
  if (!lamps.length) return null;
  lampGeo ??= lampGeometry();
  const g = lampGeo.clone();
  g.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(lamps.length), 1));
  g.setAttribute('aWarm', new THREE.InstancedBufferAttribute(new Float32Array(lamps.length).fill(1), 1));
  const im = new THREE.InstancedMesh(g, mat, lamps.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), y = new THREE.Vector3(0, 1, 0);
  lamps.forEach((l, i) => {
    toLocal(l.x, l.y, p);
    // Model's arm points +z; turn it to point along `arm` (x east, y south).
    q.setFromAxisAngle(y, Math.PI / 2 - l.arm);
    m.compose(p, q, one);
    im.setMatrixAt(i, m);
  });
  im.renderOrder = 0.4;
  im.frustumCulled = false;
  return im;
}
