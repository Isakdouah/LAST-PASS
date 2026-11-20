// Minneapolis in 3D, in local metres (x east, y up, z south; origin at the map centre).
// Far away: one big ground picture with every building footprint, road and lake, plus
// the crowd as dots computed on the graphics card from the city numbers.
// Close up: sharper ground tiles and real extruded buildings near the camera only,
// the simulated people as little figures, bullets as tracers, blood, fire and smoke.
import * as THREE from 'three';
import { det, GW, GH, CELL_X, CELL_Y, Session, places } from '../game/session';
import { query, Shapes, TILE } from '../map/detail';
import { Kind, Role, Street } from '../sim/street';

const HALF_W = (GW * CELL_X) / 2;
const HALF_H = (GH * CELL_Y) / 2;
export const cellToLocal = (x: number, y: number, out = new THREE.Vector3(), up = 0) =>
  out.set(x * CELL_X - HALF_W, up, y * CELL_Y - HALF_H);
export const localToCell = (v: THREE.Vector3) => ({ x: (v.x + HALF_W) / CELL_X, y: (v.z + HALF_H) / CELL_Y });

const LOG_V = /* glsl */ `#include <common>
#include <logdepthbuf_pars_vertex>`;
const LOG_F = /* glsl */ `#include <common>
#include <logdepthbuf_pars_fragment>`;
const HASH = /* glsl */ `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

// ---------- the ground ----------
const GROUND_V = /* glsl */ `${LOG_V}
varying vec2 vUv; varying vec3 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
const GROUND_F = /* glsl */ `${LOG_F}
uniform sampler2D map; uniform sampler2D over; uniform sampler2D overS;
uniform vec2 grid; uniform vec2 cellM; uniform float time; uniform float alpha; uniform float dots; uniform float thermal;
uniform float edgeFade;
varying vec2 vUv; varying vec3 vW;
${HASH}
void main() {
  #include <logdepthbuf_fragment>
  vec2 cp = vec2(vW.x / cellM.x + grid.x * 0.5, vW.z / cellM.y + grid.y * 0.5);
  vec4 o = texture2D(over, (floor(cp) + 0.5) / grid);
  vec4 os = texture2D(overS, cp / grid);
  vec3 col = texture2D(map, vUv).rgb;
  float dark = smoothstep(0.2, 0.8, os.a);
  // Power out: the sodium light is gone, only starlight.
  float warm = max(0.0, col.r - col.b);
  vec3 off = col - vec3(warm * 0.85, warm * 0.55, 0.0);
  col = mix(col, off * vec3(0.7, 0.75, 1.0), dark);
  // Fire light on the ground.
  float f = os.r;
  float flick = 0.8 + 0.2 * sin(time * 9.0 + cp.x * 3.0) * sin(time * 6.1 + cp.y * 2.0);
  col += vec3(0.9, 0.32, 0.06) * f * f * flick * 0.6;
  // The crowd as dots (where people are not simulated one by one).
  if (dots > 0.01) {
    vec2 sp = cp * 7.0;
    vec2 si = floor(sp);
    float h = h21(si), h2 = h21(si + 17.3);
    vec2 jit = vec2(sin(time * (1.0 + h * 2.0) + h * 30.0), cos(time * (1.3 + h2) + h2 * 30.0)) * 0.18;
    float r = length(fract(sp) - 0.5 - jit);
    float inDot = step(r, 0.2);
    float pDead = clamp(o.g * 2.2, 0.0, 0.9);
    float pLive = clamp(o.b * 1.6, 0.0, 0.9);
    vec3 dc = vec3(0.0); float a = 0.0;
    if (h < pDead) { dc = vec3(0.44, 0.86, 0.31); a = 1.0; }
    else if (h2 < pLive) { dc = vec3(0.88, 0.88, 0.84); a = 1.0; }
    col = mix(col, dc, inDot * a * dots);
  }
  if (thermal > 0.5) {
    col = vec3(0.06) + vec3(0.25) * f;
  }
  // Fade out at the map edge so the city melts into the globe.
  float e = min(min(cp.x, grid.x - cp.x), min(cp.y, grid.y - cp.y));
  float fade = mix(1.0, smoothstep(0.0, 14.0, e), edgeFade);
  gl_FragColor = vec4(col, alpha * fade);
}`;

// ---------- buildings ----------
const BLD_V = /* glsl */ `${LOG_V}
attribute float aU; attribute float aSeed; attribute float aH;
varying vec3 vW; varying vec3 vN; varying float vU; varying float vSeed; varying float vH;
void main() {
  vU = aU; vSeed = aSeed; vH = aH; vN = normal;
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
const BLD_F = /* glsl */ `${LOG_F}
uniform sampler2D over; uniform sampler2D overS; uniform vec2 grid; uniform vec2 cellM; uniform float time; uniform float thermal;
varying vec3 vW; varying vec3 vN; varying float vU; varying float vSeed; varying float vH;
${HASH}
void main() {
  #include <logdepthbuf_fragment>
  vec2 cp = vec2(vW.x / cellM.x + grid.x * 0.5, vW.z / cellM.y + grid.y * 0.5);
  vec4 o = texture2D(over, (floor(cp) + 0.5) / grid);
  vec4 os = texture2D(overS, cp / grid);
  float dark = smoothstep(0.2, 0.8, os.a), fire = o.r, glow = os.r;
  float flick = 0.7 + 0.3 * sin(time * 11.0 + vSeed * 50.0) * sin(time * 7.3 + vW.y);
  // Building colours: brick, concrete, painted wood, by building.
  float k = fract(vSeed * 7.13);
  vec3 base = k < 0.33 ? vec3(0.42, 0.26, 0.20) : k < 0.66 ? vec3(0.46, 0.45, 0.43) : vec3(0.52, 0.47, 0.38);
  base *= 0.75 + 0.5 * fract(vSeed * 13.7);
  vec3 col;
  bool roof = vN.y > 0.5;
  if (roof) {
    col = base * (0.9 + 0.2 * h21(floor(vW.xz * 0.5)));
    col *= 0.34 + 0.08 * (1.0 - dark);
  } else {
    // Light: dark-blue sky, sodium street light from below, a little side shading.
    // Faint skylight from the north-west so each face of a building reads differently.
    float side = 0.55 + 0.45 * max(0.0, dot(vN, normalize(vec3(-0.6, 0.0, -0.8))));
    float street = exp(-vW.y / 9.0) * (1.0 - dark);
    col = base * (0.30 * side + 0.8 * street * vec3(1.0, 0.68, 0.38));
    // Windows on a grid: floors every 3.2 m (houses 2.9), columns every 2.8 m.
    float fh = vH < 9.0 ? 2.9 : 3.2;
    float cw = vH < 9.0 ? 3.6 : 2.8;
    float fl = floor(vW.y / fh), cl = floor(vU / cw);
    vec2 f = vec2(fract(vU / cw), fract(vW.y / fh));
    float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.35, f.y) * step(f.y, 0.82) * step(1.0, vW.y) * step(vW.y, vH - 0.7);
    float r = h21(vec2(fl * 7.0 + vSeed * 91.0, cl));
    float lit = step(r, 0.42 * (1.0 - dark));
    vec3 glass = vec3(0.05, 0.06, 0.10);
    vec3 lamp = mix(vec3(1.0, 0.78, 0.42), vec3(0.75, 0.85, 1.0), step(0.85, h21(vec2(cl, fl + vSeed))));
    vec3 wc = mix(glass, lamp * (0.7 + 0.3 * r), lit);
    // Burning: windows glow and flicker orange.
    wc = mix(wc, vec3(1.0, 0.45, 0.1) * flick * 1.3, step(0.5, fire) * step(r, 0.8));
    col = mix(col, wc, win);
  }
  col += vec3(0.9, 0.3, 0.05) * glow * flick * (roof ? 0.4 : 0.5) * exp(-vW.y / 30.0);
  if (thermal > 0.5) col = vec3(0.08 + 0.05 * float(roof)) + vec3(0.6) * fire;
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------- soft round points (smoke, flames, flashes) ----------
const PTS_V = /* glsl */ `${LOG_V}
attribute float aSize; attribute vec4 aCol;
varying vec4 vCol; uniform float scale;
void main() {
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * scale / -mv.z, 1.0, 96.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const PTS_F = /* glsl */ `${LOG_F}
varying vec4 vCol;
float bayer2(vec2 p) { vec2 q = mod(floor(p), 2.0); return (q.x * 2.0 + abs(q.y * 3.0 - q.x * 2.0)) / 4.0; }
void main() {
  #include <logdepthbuf_fragment>
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = vCol.a * (1.0 - smoothstep(0.6, 1.0, r));
  if (a < 0.02) discard;
  gl_FragColor = vec4(vCol.rgb, a);
}`;

function hash(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Tallest building per cell (metres), for flames on roofs. */
const cellHeight = (() => {
  const h = new Float32Array(GW * GH);
  const s = det.buildings;
  for (let k = 0; k < s.count; k++) {
    const cx = Math.floor((s.box[k * 4] + s.box[k * 4 + 2]) / 2), cy = Math.floor((s.box[k * 4 + 1] + s.box[k * 4 + 3]) / 2);
    if (cx >= 0 && cy >= 0 && cx < GW && cy < GH) h[cy * GW + cx] = Math.max(h[cy * GW + cx], s.meta[k]);
  }
  return h;
})();

interface Tile {
  key: number;
  ground: THREE.Mesh;
  bld: THREE.Mesh | null;
  used: number;
}

/** Thermal camera: the living glow, the dead are as cold as the street. */
const THERM = { warm: new THREE.Color(1, 1, 0.95), cold: new THREE.Color(0.1, 0.12, 0.2), cool: new THREE.Color(0.3, 0.3, 0.32) };
const COL = {
  living: new THREE.Color(0.88, 0.88, 0.84),
  scared: new THREE.Color(1.0, 0.72, 0.4),
  armed: new THREE.Color(0.38, 0.62, 1.0),
  police: new THREE.Color(0.2, 0.38, 0.95),
  dead: new THREE.Color(0.44, 0.86, 0.31),
  fallen: new THREE.Color(0.45, 0.08, 0.08),
};

export class CityLayer {
  scene = new THREE.Scene();
  overTex: THREE.DataTexture;
  private overSmooth: THREE.DataTexture;
  private over: Uint8Array;
  private shared: Record<string, THREE.IUniform>;
  private base: THREE.Mesh;
  private baseMat: THREE.ShaderMaterial;
  private bldMat: THREE.ShaderMaterial;
  private tiles = new Map<number, Tile>();
  private frameNo = 0;
  private agents: THREE.InstancedMesh;
  private blood: THREE.InstancedMesh;
  private tracers: THREE.LineSegments;
  private pts: THREE.Points;
  private ptsMat: THREE.ShaderMaterial;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  /** Fade for the whole city (0 = invisible, high above). */
  alpha = 1;

  constructor() {
    this.over = new Uint8Array(GW * GH * 4);
    this.overTex = new THREE.DataTexture(this.over, GW, GH, THREE.RGBAFormat);
    this.overTex.magFilter = THREE.NearestFilter;
    this.overTex.minFilter = THREE.NearestFilter;
    this.overTex.flipY = false;
    this.overTex.needsUpdate = true;
    // The same numbers, smoothly blended between cells: for fire glow and power cuts.
    this.overSmooth = new THREE.DataTexture(this.over, GW, GH, THREE.RGBAFormat);
    this.overSmooth.magFilter = THREE.LinearFilter;
    this.overSmooth.minFilter = THREE.LinearFilter;
    this.overSmooth.flipY = false;
    this.overSmooth.needsUpdate = true;
    this.shared = {
      over: { value: this.overTex },
      overS: { value: this.overSmooth },
      grid: { value: new THREE.Vector2(GW, GH) },
      cellM: { value: new THREE.Vector2(CELL_X, CELL_Y) },
      time: { value: 0 },
      thermal: { value: 0 },
    };
    // Whole-city ground picture, about 10 m per pixel.
    const c = document.createElement('canvas');
    c.width = GW * 8;
    c.height = GH * 8;
    drawGround(c.getContext('2d')!, 0, 0, GW, GH, 8);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    this.baseMat = this.groundMat(tex, 1);
    const g = new THREE.PlaneGeometry(GW * CELL_X, GH * CELL_Y);
    g.rotateX(-Math.PI / 2); // lie flat; uv v=1 is north (top of the picture)
    this.base = new THREE.Mesh(g, this.baseMat);
    this.base.renderOrder = -10;
    this.scene.add(this.base);
    // Everything in the city is in the 'transparent' list so draw order is just renderOrder:
    // ground first (no depth), then buildings, people, tracers, smoke.
    this.bldMat = new THREE.ShaderMaterial({ vertexShader: BLD_V, fragmentShader: BLD_F, uniforms: this.shared, transparent: true });
    // People: a little figure (body + head), lit from above by vertex shading.
    const fig = figureGeometry();
    this.agents = new THREE.InstancedMesh(fig, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }), 2600);
    this.agents.renderOrder = 1;
    this.agents.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.agents.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2600 * 3), 3);
    this.agents.frustumCulled = false;
    this.agents.count = 0;
    this.scene.add(this.agents);
    const bg = new THREE.CircleGeometry(1, 6);
    bg.rotateX(-Math.PI / 2);
    this.blood = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: 0x5a0e10, depthWrite: false, depthTest: false }), 4000);
    this.blood.renderOrder = -5;
    this.blood.frustumCulled = false;
    this.blood.count = 0;
    this.scene.add(this.blood);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4000 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(4000 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true }));
    this.tracers.renderOrder = 2;
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);
    const pg = new THREE.BufferGeometry();
    const NP = 6000;
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(NP), 1).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(NP * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.ptsMat = new THREE.ShaderMaterial({
      vertexShader: PTS_V,
      fragmentShader: PTS_F,
      uniforms: { scale: { value: 300 } },
      transparent: true,
      depthWrite: false,
    });
    this.pts = new THREE.Points(pg, this.ptsMat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 5;
    this.scene.add(this.pts);
    const amb = places; // keep places import used for labels elsewhere
    void amb;
  }

  private groundMat(map: THREE.Texture, edgeFade: number) {
    return new THREE.ShaderMaterial({
      vertexShader: GROUND_V,
      fragmentShader: GROUND_F,
      uniforms: {
        ...this.shared,
        map: { value: map },
        alpha: { value: 1 },
        dots: { value: 0 },
        edgeFade: { value: edgeFade },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Copy the city numbers into the overlay picture (fire, dead, living, power). */
  updateOverlay(s: Session) {
    const w = s.world, f = s.fires.fire, o = this.over;
    for (let i = 0; i < GW * GH; i++) {
      const j = i * 4;
      o[j] = Math.min(255, f[i] * 255);
      o[j + 1] = Math.min(255, w.infected[i] * 2);
      o[j + 2] = Math.min(255, w.healthy[i] * 1.2);
      o[j + 3] = s.isDark(i) ? 255 : 0;
    }
    this.overTex.needsUpdate = true;
    this.overSmooth.needsUpdate = true;
  }

  /**
   * Per frame. `camLocal` = camera position in local metres, `look` = ground point (cells)
   * the camera looks at, `d` = camera distance (km).
   */
  update(s: Session, camLocal: THREE.Vector3, look: { x: number; y: number }, d: number, time: number, screenH: number, fovDeg: number) {
    this.frameNo++;
    this.shared.time.value = time;
    this.baseMat.uniforms.alpha.value = this.alpha;
    const dots = THREE.MathUtils.clamp((6 - d) / 4, 0, 1);
    this.baseMat.uniforms.dots.value = dots;
    // Near tiles: sharper ground and real buildings within a radius that grows with height.
    const near = d < 7;
    const want = new Set<number>();
    const wantGround = new Set<number>();
    if (near) {
      const radiusM = THREE.MathUtils.clamp(d * 1000 * 1.6, 700, 4200);
      const tw = TILE * CELL_X, th = TILE * CELL_Y;
      // Centre between camera and look point, biased toward where we look.
      const cxm = look.x * CELL_X - HALF_W, czm = look.y * CELL_Y - HALF_H;
      const t0x = Math.floor((cxm - radiusM + HALF_W) / tw), t1x = Math.floor((cxm + radiusM + HALF_W) / tw);
      const t0y = Math.floor((czm - radiusM + HALF_H) / th), t1y = Math.floor((czm + radiusM + HALF_H) / th);
      const list: [number, number][] = [];
      for (let ty = Math.max(0, t0y); ty <= Math.min(Math.ceil(GH / TILE) - 1, t1y); ty++)
        for (let tx = Math.max(0, t0x); tx <= Math.min(Math.ceil(GW / TILE) - 1, t1x); tx++) {
          const mx = (tx + 0.5) * tw - HALF_W, mz = (ty + 0.5) * th - HALF_H;
          const dist = Math.hypot(mx - cxm, mz - czm);
          if (dist < radiusM + tw) list.push([ty * 1000 + tx, dist]);
        }
      list.sort((a, b) => a[1] - b[1]);
      let built = 0;
      const groundR = THREE.MathUtils.clamp(d * 1000 * 0.9, 500, 1600);
      for (const [key, dist] of list) {
        want.add(key);
        if (dist < groundR + tw) wantGround.add(key);
        let tile = this.tiles.get(key);
        if (!tile && built < 2) {
          tile = this.buildTile(key);
          built++;
        }
        if (tile) tile.used = this.frameNo;
      }
    }
    for (const [key, tile] of this.tiles) {
      const vis = want.has(key);
      tile.ground.visible = wantGround.has(key);
      if (tile.bld) tile.bld.visible = vis;
      (tile.ground.material as THREE.ShaderMaterial).uniforms.dots.value = dots;
      (tile.ground.material as THREE.ShaderMaterial).uniforms.alpha.value = this.alpha;
      if (!vis && this.frameNo - tile.used > 600) this.dropTile(tile);
    }
    this.updateStreet(s.street, time);
    this.updatePoints(s, look, d, time);
    this.ptsMat.uniforms.scale.value = screenH / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    void camLocal;
  }

  private buildTile(key: number): Tile {
    const tx = key % 1000, ty = Math.floor(key / 1000);
    const x0 = tx * TILE, y0 = ty * TILE;
    const PPC = 80; // pixels per cell: about 1 m per pixel
    const c = document.createElement('canvas');
    c.width = c.height = TILE * PPC;
    drawGround(c.getContext('2d')!, x0, y0, TILE, TILE, PPC);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    tex.magFilter = THREE.NearestFilter; // crisp texels up close: pixel art, not blur
    const g = new THREE.PlaneGeometry(TILE * CELL_X, TILE * CELL_Y);
    g.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(g, this.groundMat(tex, 1));
    cellToLocal(x0 + TILE / 2, y0 + TILE / 2, ground.position);
    ground.renderOrder = -9;
    this.scene.add(ground);
    const bg = buildingGeometry(det.buildings, x0, y0);
    let bld: THREE.Mesh | null = null;
    if (bg) {
      bld = new THREE.Mesh(bg, this.bldMat);
      bld.renderOrder = 0;
      this.scene.add(bld);
    }
    const tile = { key, ground, bld, used: this.frameNo };
    this.tiles.set(key, tile);
    return tile;
  }

  private dropTile(t: Tile) {
    this.scene.remove(t.ground);
    t.ground.geometry.dispose();
    const m = t.ground.material as THREE.ShaderMaterial;
    m.uniforms.map.value.dispose();
    m.dispose();
    if (t.bld) {
      this.scene.remove(t.bld);
      t.bld.geometry.dispose();
    }
    this.tiles.delete(t.key);
  }

  private updateStreet(st: Street | null, time: number) {
    const A = this.agents;
    if (!st) {
      A.count = 0;
      this.blood.count = 0;
      (this.tracers.geometry as THREE.BufferGeometry).setDrawRange(0, 0);
      return;
    }
    const FIG = 2.0; // people drawn bigger than life, so you can read them
    let n = 0;
    const m = this.tmpM, q = this.tmpQ, p = this.tmpV, sc = this.tmpS;
    const yAxis = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0);
    for (let k = 0; k < st.agents.length && n < 2600; k++) {
      const a = st.agents[k];
      cellToLocal(a.x, a.y, p);
      let c = COL.living;
      if (a.kind === Kind.Fallen) {
        q.setFromAxisAngle(yAxis, a.face);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, Math.PI / 2));
        p.y = 0.25;
        c = COL.fallen;
      } else {
        // Face where they are going (sim angles: x east, y south, same as our x and z).
        q.setFromAxisAngle(yAxis, -a.face + Math.PI / 2);
        const moving = Math.hypot(a.vx, a.vy) > 0.0001;
        p.y = moving ? Math.abs(Math.sin(time * 14 + k)) * 0.25 : 0;
        if (a.kind === Kind.Dead) c = COL.dead;
        else if (a.role === Role.Police) c = COL.police;
        else if (a.armed && a.ammo > 0) c = COL.armed;
        else if (a.fear > 0.5) c = COL.scared;
      }
      if (this.thermal) c = a.kind === Kind.Living ? THERM.warm : a.kind === Kind.Dead ? THERM.cold : THERM.cool;
      sc.set(FIG, FIG, FIG);
      m.compose(p, q, sc);
      A.setMatrixAt(n, m);
      A.setColorAt(n, c);
      n++;
    }
    A.count = n;
    A.instanceMatrix.needsUpdate = true;
    if (A.instanceColor) A.instanceColor.needsUpdate = true;
    // Blood on the ground.
    const B = this.blood;
    const nb = Math.min(4000, st.blood.length);
    for (let k = 0; k < nb; k++) {
      const b = st.blood[st.blood.length - nb + k];
      cellToLocal(b.x, b.y, p);
      p.y = 0.05;
      const r = 0.8 + hash(k * 7 + 3) * 1.2;
      sc.set(r, 1, r * (0.6 + hash(k) * 0.6));
      q.setFromAxisAngle(yAxis, hash(k * 13) * 6.28);
      m.compose(p, q, sc);
      B.setMatrixAt(k, m);
    }
    B.count = nb;
    B.instanceMatrix.needsUpdate = true;
    // Tracers: from where the bullet was to where it is, a bit longer so you see it.
    const tg = this.tracers.geometry as THREE.BufferGeometry;
    const pos = tg.attributes.position as THREE.BufferAttribute;
    const col = tg.attributes.color as THREE.BufferAttribute;
    let nt = 0;
    for (const b of st.bullets) {
      if (nt >= 4000) break;
      const ax = b.x - (b.x - b.px) * 2.5, ay = b.y - (b.y - b.py) * 2.5;
      cellToLocal(ax, ay, p);
      pos.setXYZ(nt * 2, p.x, 1.4 * FIG * 0.8, p.z);
      cellToLocal(b.x, b.y, p);
      pos.setXYZ(nt * 2 + 1, p.x, 1.4 * FIG * 0.8, p.z);
      col.setXYZ(nt * 2, 0.6, 0.4, 0.1);
      col.setXYZ(nt * 2 + 1, 1.0, 0.95, 0.6);
      nt++;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    tg.setDrawRange(0, nt * 2);
  }

  /** Smoke, flames, muzzle flashes and bullet puffs as soft points. */
  private updatePoints(s: Session, look: { x: number; y: number }, d: number, time: number) {
    const g = this.pts.geometry as THREE.BufferGeometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const size = g.attributes.aSize as THREE.BufferAttribute;
    const col = g.attributes.aCol as THREE.BufferAttribute;
    const max = pos.count;
    let n = 0;
    const p = this.tmpV;
    const add = (x: number, y: number, z: number, sz: number, r: number, gg: number, b: number, a: number) => {
      if (n >= max) return;
      pos.setXYZ(n, x, y, z);
      size.setX(n, sz);
      col.setXYZ(n, r, gg, b);
      col.setW(n, a);
      n++;
    };
    if (this.alpha > 0.05) {
      // Smoke plumes from the sim (near the camera).
      for (const sm of s.smoke) {
        cellToLocal(sm.x, sm.y, p);
        const life = sm.age / sm.life;
        const fade = Math.min(1, sm.age / 4) * (1 - life);
        const shade = 0.22 + 0.14 * hash(Math.floor(sm.x * 1000));
        const lit = Math.max(0, 1 - sm.alt / 120); // fire light from below on young smoke
        add(p.x, sm.alt, p.z, 22 + sm.age * 1.6, shade * 1.1 + lit * 0.35, shade + lit * 0.12, shade * 0.92, 0.6 * fade * this.alpha);
      }
      // Flames on burning roofs near where we look.
      const R = Math.ceil(THREE.MathUtils.clamp(d * 14, 6, 40));
      const f = s.fires.fire;
      for (let y = Math.max(0, Math.floor(look.y) - R); y < Math.min(GH, look.y + R); y++)
        for (let x = Math.max(0, Math.floor(look.x) - R); x < Math.min(GW, look.x + R); x++) {
          const i = y * GW + x;
          if (f[i] < 0.2) continue;
          const nf = Math.ceil(f[i] * 14);
          const top = Math.max(4, cellHeight[i]);
          for (let k = 0; k < nf; k++) {
            const h1 = hash(i * 31 + k), h2 = hash(i * 17 + k * 5), h3 = hash(i * 7 + k * 11);
            const ph = (time * (0.9 + h1 * 1.4) + h2) % 1;
            cellToLocal(x + 0.15 + h1 * 0.7, y + 0.15 + h2 * 0.7, p);
            const hot = 1 - ph;
            // Flame tongues: yellow at the base, red, then dark at the tip.
            add(p.x + (h3 - 0.5) * 4 * ph, top * (0.6 + 0.4 * h3) + ph * (6 + 10 * f[i]), p.z, (3 + 6 * f[i]) * (1 - ph * 0.5),
              1.0, 0.25 + 0.6 * hot * hot, 0.05 + 0.2 * hot * hot * hot, hot * 0.9 * this.alpha);
          }
        }
    }
    const st = s.street;
    if (st) {
      for (const a of st.agents)
        if (a.flash > 0) {
          cellToLocal(a.x, a.y, p);
          add(p.x, 1.8, p.z, 4, 1.0, 0.95, 0.7, 1);
        }
      for (const pf of st.puffs) {
        cellToLocal(pf.x, pf.y, p);
        add(p.x, 0.8, p.z, 2.5, 0.75, 0.7, 0.6, Math.min(1, pf.t * 3));
      }
    }
    pos.needsUpdate = size.needsUpdate = col.needsUpdate = true;
    g.setDrawRange(0, n);
  }

  private thermal = false;
  setThermal(on: boolean) {
    this.thermal = on;
    this.shared.thermal.value = on ? 1 : 0;
  }
  /** Height of the tallest building in a cell (metres). */
  heightAt(x: number, y: number) {
    const i = Math.floor(y) * GW + Math.floor(x);
    return i >= 0 && i < cellHeight.length ? cellHeight[i] : 0;
  }
}

// ---------- drawing the ground pictures ----------
function path(g: CanvasRenderingContext2D, s: Shapes, k: number, x0: number, y0: number, ppc: number) {
  const o = s.off[k];
  const n = s.off[k + 1] - o;
  g.beginPath();
  for (let j = 0; j < n; j++) g.lineTo((s.xy[(o + j) * 2] - x0) * ppc, (s.xy[(o + j) * 2 + 1] - y0) * ppc);
}

/** Night ground: dark earth, parks, lakes and the river, asphalt with sodium light pools,
 *  lane paint on big roads, and dark building footprints (roofs are drawn in 3D up close). */
export function drawGround(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, ppc: number) {
  const x1 = x0 + w, y1 = y0 + h;
  const mpp = CELL_X / ppc; // metres per pixel
  g.fillStyle = '#16171d';
  g.fillRect(0, 0, w * ppc, h * ppc);
  // Grain, so big areas are not flat.
  if (ppc >= 32) {
    for (let k = 0; k < w * h * 40; k++) {
      const v = 18 + Math.floor(hash(k * 7 + x0 * 131 + y0 * 977) * 10);
      g.fillStyle = `rgb(${v},${v + 1},${v + 6})`;
      g.fillRect(hash(k * 3 + x0) * w * ppc, hash(k * 5 + y0) * h * ppc, 2, 2);
    }
  }
  g.fillStyle = '#16251b';
  for (const k of query(det.parks, x0, y0, x1, y1)) if (!det.parks.meta[k]) (path(g, det.parks, k, x0, y0, ppc), g.fill());
  const water = query(det.water, x0, y0, x1, y1);
  g.fillStyle = '#0b1a33';
  for (const k of water) if (!det.water.meta[k]) (path(g, det.water, k, x0, y0, ppc), g.fill());
  g.fillStyle = '#16171d';
  for (const k of water) if (det.water.meta[k]) (path(g, det.water, k, x0, y0, ppc), g.fill());
  const roads = query(det.roads, x0, y0, x1, y1).sort((a, b) => det.roads.meta[a] - det.roads.meta[b]);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Sidewalk edge, then asphalt.
  for (const k of roads) {
    const wm = det.roads.meta[k];
    g.strokeStyle = '#2e2d32';
    g.lineWidth = Math.max(1, (wm + 4) / mpp);
    path(g, det.roads, k, x0, y0, ppc);
    g.stroke();
  }
  for (const k of roads) {
    const wm = det.roads.meta[k];
    g.strokeStyle = wm >= 15 ? '#2a2a31' : '#25252c';
    g.lineWidth = Math.max(1, wm / mpp);
    path(g, det.roads, k, x0, y0, ppc);
    g.stroke();
  }
  if (ppc >= 32) {
    // Lane paint on big roads: dashed, faded.
    g.setLineDash([3 / mpp, 6 / mpp]);
    g.strokeStyle = 'rgba(190,170,110,0.35)';
    g.lineWidth = Math.max(1, 0.25 / mpp);
    for (const k of roads)
      if (det.roads.meta[k] >= 11) {
        path(g, det.roads, k, x0, y0, ppc);
        g.stroke();
      }
    g.setLineDash([]);
  }
  // Street lights: sodium pools about every 40 m along roads.
  g.globalCompositeOperation = 'lighter';
  const s = det.roads;
  const rad = 16 / mpp;
  for (const k of roads) {
    const o = s.off[k];
    const n = s.off[k + 1] - o;
    let carry = hash(k) * 40;
    for (let j = 0; j + 1 < n; j++) {
      const ax = s.xy[(o + j) * 2], ay = s.xy[(o + j) * 2 + 1];
      const bx = s.xy[(o + j + 1) * 2], by = s.xy[(o + j + 1) * 2 + 1];
      const len = Math.hypot((bx - ax) * CELL_X, (by - ay) * CELL_Y);
      while (carry < len) {
        const f = carry / len;
        const px = (ax + (bx - ax) * f - x0) * ppc, py = (ay + (by - ay) * f - y0) * ppc;
        if (ppc >= 32) {
          const gr = g.createRadialGradient(px, py, 0, px, py, rad);
          gr.addColorStop(0, 'rgba(120,70,22,0.42)');
          gr.addColorStop(1, 'rgba(120,70,22,0)');
          g.fillStyle = gr;
          g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
        } else {
          g.fillStyle = 'rgba(110,64,20,0.5)';
          g.fillRect(px - 1, py - 1, 2, 2);
        }
        carry += 40;
      }
      carry -= len;
    }
  }
  g.globalCompositeOperation = 'source-over';
  // Building footprints: dark (in 3D the roof sits on top); seen from high up they read
  // as the city's texture, roofs a little lighter than streets.
  const b = det.buildings;
  for (const k of query(b, x0, y0, x1, y1)) {
    const v = 30 + Math.floor(hash(k) * 14);
    g.fillStyle = ppc >= 32 ? '#0e0f13' : `rgb(${v + 6},${v + 2},${v})`;
    path(g, b, k, x0, y0, ppc);
    g.fill();
  }
}

/** Extruded buildings whose centre is in tile (x0,y0): walls with an along-wall coordinate
 *  for windows, and a flat roof. Returns null when the tile has none. */
function buildingGeometry(s: Shapes, x0: number, y0: number): THREE.BufferGeometry | null {
  const P: number[] = [], N: number[] = [], U: number[] = [], S: number[] = [], H: number[] = [];
  const I: number[] = [];
  const v = new THREE.Vector3();
  for (const k of query(s, x0, y0, x0 + TILE, y0 + TILE)) {
    const cx = (s.box[k * 4] + s.box[k * 4 + 2]) / 2, cy = (s.box[k * 4 + 1] + s.box[k * 4 + 3]) / 2;
    if (cx < x0 || cy < y0 || cx >= x0 + TILE || cy >= y0 + TILE) continue;
    const o = s.off[k];
    let n = s.off[k + 1] - o;
    if (n < 3) continue;
    const xs = (j: number) => s.xy[(o + j) * 2], ys = (j: number) => s.xy[(o + j) * 2 + 1];
    if (xs(0) === xs(n - 1) && ys(0) === ys(n - 1)) n--;
    if (n < 3) continue;
    const h = Math.max(3, s.meta[k]);
    const seed = hash(k + 1);
    // Ring in local metres; orientation from signed area.
    const ring: THREE.Vector2[] = [];
    let area = 0;
    for (let j = 0; j < n; j++) {
      cellToLocal(xs(j), ys(j), v);
      ring.push(new THREE.Vector2(v.x, v.z));
    }
    for (let j = 0; j < n; j++) {
      const a = ring[j], b = ring[(j + 1) % n];
      area += a.x * b.y - b.x * a.y;
    }
    const sign = area > 0 ? 1 : -1;
    let u = 0;
    for (let j = 0; j < n; j++) {
      const a = ring[j], b = ring[(j + 1) % n];
      const len = a.distanceTo(b);
      if (len < 0.05) continue;
      // Outward normal in x/z.
      const nx = ((b.y - a.y) / len) * -sign, nz = ((a.x - b.x) / len) * -sign;
      const base = P.length / 3;
      P.push(a.x, 0, a.y, b.x, 0, b.y, b.x, h, b.y, a.x, h, a.y);
      for (let q = 0; q < 4; q++) N.push(nx, 0, nz), S.push(seed), H.push(h);
      U.push(u, u + len, u + len, u);
      u += len;
      // Wind each wall so its front faces outward (back faces are skipped when drawing).
      if (sign > 0) I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else I.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const tris = THREE.ShapeUtils.triangulateShape(ring, []);
    const base = P.length / 3;
    for (const r of ring) {
      P.push(r.x, h, r.y);
      N.push(0, 1, 0);
      U.push(0);
      S.push(seed);
      H.push(h);
    }
    for (const t of tris) {
      // Roof triangles face up: (p1 - p0) x (p2 - p0) must point to +y.
      const a = ring[t[0]], b = ring[t[1]], c = ring[t[2]];
      const up = (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
      if (up > 0) I.push(base + t[0], base + t[1], base + t[2]);
      else I.push(base + t[0], base + t[2], base + t[1]);
    }
  }
  if (!P.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(U, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(S, 1));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(H, 1));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

/** A blocky person, 1.8 m: legs, body, head; vertex colours give simple top light. */
function figureGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, y: number, x = 0) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(x, y, 0);
    parts.push(b);
  };
  box(0.24, 0.8, 0.26, 0.4, -0.15); // legs
  box(0.24, 0.8, 0.26, 0.4, 0.15);
  box(0.62, 0.68, 0.36, 1.12); // body
  box(0.34, 0.32, 0.34, 1.62); // head
  const merged = mergeGeoms(parts);
  const n = merged.attributes.normal as THREE.BufferAttribute;
  const p = merged.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const shade = n.getY(i) > 0.5 ? 1.0 : n.getY(i) < -0.5 ? 0.4 : 0.62 + 0.12 * n.getX(i);
    const legs = p.getY(i) < 0.8 ? 0.7 : 1;
    c.set([shade * legs, shade * legs, shade * legs], i * 3);
  }
  merged.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return merged;
}

function mergeGeoms(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const P: number[] = [], N: number[] = [], I: number[] = [];
  for (const g of list) {
    const base = P.length / 3;
    const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) P.push(p.getX(i), p.getY(i), p.getZ(i)), N.push(n.getX(i), n.getY(i), n.getZ(i));
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) I.push(base + idx.getX(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setIndex(I);
  return out;
}
