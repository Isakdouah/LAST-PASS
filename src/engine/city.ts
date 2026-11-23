// Minneapolis in 3D, in local metres (x east, y up, z south; origin at the map centre).
// Far away: one big ground picture with every building footprint, road and lake, plus
// the crowd as dots computed on the graphics card from the city numbers.
// Close up: sharper ground tiles and real extruded buildings near the camera only,
// the simulated people as little figures, bullets as tracers, blood, fire and smoke.
import * as THREE from 'three';
import { det, GW, GH, CELL_X, CELL_Y, Session, places, blocked, roadNet, setSolidProps } from '../game/session';
import { lampSpots, nearOtherRoad, paved, treeSpots } from './props';
import { buildLamps, buildTrees, propMaterial, TileTrees } from './propMeshes';
import { nearestRoad, pointAt } from '../sim/roadnet';
import { CAR_COLOURS, CAR_STYLES, carLightsGeometry, SIZE, VEHICLE_SCALE, vehicleGeometry, VKind } from './vehicles';
import { HEROES } from '../game/heroes';
import { dressingGeometry, dressingSpots } from './dressing';
import { bridgeGeometry, deckAt } from './bridges';
import { Rig } from './rig';
import { LightField, LIGHT_PARS, litBasic, MovingLight } from './lightfield';
import { heightAt, lifted, terrainUniforms, TERRAIN_PARS } from './terrain';
import { addHouse, box as hbox, Buf, fitHouse, K as HK } from './houses';
import { query, Shapes, TILE } from '../map/detail';
import { Kind, Role, Street } from '../sim/street';
import { asleepShare } from '../sim/outbreak';
import { drizzle } from '../game/weather';

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
varying vec2 vUv; varying vec3 vW; varying float vTy;
${TERRAIN_PARS}
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  vTy = terrH(w.xz);
  w.y += vTy;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
const GROUND_F = /* glsl */ `${LOG_F}
uniform sampler2D map; uniform sampler2D over; uniform sampler2D overS;
uniform vec2 grid; uniform vec2 cellM; uniform float time; uniform float alpha; uniform float dots; uniform float thermal;
uniform float edgeFade;
varying vec2 vUv; varying vec3 vW; varying float vTy;
${TERRAIN_PARS}
${HASH}
${LIGHT_PARS}
void main() {
  #include <logdepthbuf_fragment>
  vec2 cp = vec2(vW.x / cellM.x + grid.x * 0.5, vW.z / cellM.y + grid.y * 0.5);
  vec4 o = texture2D(over, (floor(cp) + 0.5) / grid);
  vec4 os = texture2D(overS, cp / grid);
  vec3 col = texture2D(map, vUv).rgb;
  // Hill shading: moonlight from the north-west on the real slopes, in hard steps.
  {
    float e = 14.0;
    float hx = terrH(vW.xz + vec2(e, 0.0)) - terrH(vW.xz - vec2(e, 0.0));
    float hz = terrH(vW.xz + vec2(0.0, e)) - terrH(vW.xz - vec2(0.0, e));
    vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));
    float lit = dot(n, normalize(vec3(-0.6, 0.55, -0.6))) - 0.55 * 0.9;
    float sh = clamp(1.0 + lit * 2.2, 0.55, 1.35);
    sh = floor(sh * 8.0 + 0.5) / 8.0;
    if (terrOn > 0.5) col *= sh;
  }
  float dark = smoothstep(0.2, 0.8, os.a);
  // Water: a sky sheen toward the horizon and city light broken into ripples, the reflection
  // of lamps pulled toward you in long streaks.
  {
    vec3 tex0 = col;
    float water = step(0.09, tex0.b) * step(tex0.r * 1.9, tex0.b) * step(tex0.g * 1.3, tex0.b);
    if (water > 0.5 && thermal < 0.5) {
      vec3 vd = normalize(cameraPosition - vec3(vW.x, vTy, vW.z));
      float fres = pow(1.0 - clamp(vd.y, 0.0, 1.0), 3.0);
      col = mix(col, vec3(0.09, 0.11, 0.19), fres * 0.8);
      // A lamp's reflection is a streak running from it toward the viewer.
      vec2 dir = normalize(vd.xz + 1e-4);
      float lamp = 0.0;
      for (int k = 0; k < 6; k++) {
        vec2 luv = (vW.xz - dir * (6.0 + float(k) * 9.0) - lightBox.xy) / lightBox.zw;
        if (luv.x > 0.0 && luv.y > 0.0 && luv.x < 1.0 && luv.y < 1.0) lamp = max(lamp, texture2D(lampTex, luv).r * (1.0 - float(k) * 0.12));
      }
      lamp = lamp * lamp * (1.0 - dark) * 1.4;
      // Ripples: short bright dashes across the streak, drifting with the current.
      vec2 side = vec2(-dir.y, dir.x);
      float across = dot(vW.xz, side), along = dot(vW.xz, dir);
      float rip = step(0.55, h21(vec2(floor(along * 0.8 + time * 0.7), floor(across * 0.35))));
      col += vec3(1.0, 0.62, 0.30) * lamp * (0.25 + 0.9 * rip);
      col += vec3(0.5, 0.55, 0.7) * step(0.985, h21(floor(vW.xz * 0.7) + floor(time * 2.0))) * 0.08;
    }
  }
  // Power out: the sodium light is gone, only starlight.
  float warm = max(0.0, col.r - col.b);
  vec3 off = col - vec3(warm * 0.85, warm * 0.55, 0.0);
  col = mix(col, off * vec3(0.7, 0.75, 1.0), dark);
  // Fire light on the ground.
  float f = os.r;
  float flick = 0.8 + 0.2 * sin(time * 9.0 + cp.x * 3.0) * sin(time * 6.1 + cp.y * 2.0);
  col += vec3(0.9, 0.32, 0.06) * f * f * flick * 0.6;
  // Headlights and flashes on the ground (the lamp pools are painted in already).
  {
    vec2 luv = (vW.xz - lightBox.xy) / lightBox.zw;
    if (luv.x > 0.0 && luv.y > 0.0 && luv.x < 1.0 && luv.y < 1.0) {
      float dyn = floor(texture2D(dynTex, luv).r * 4.0 + 0.35) / 4.0;
      col += vec3(1.0, 0.95, 0.82) * dyn * (0.12 + col * 2.5);
    }
  }
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
  if (thermal < 0.5) col = haze(col, vW);
  gl_FragColor = vec4(col, alpha * fade);
}`;

// ---------- buildings ----------
const BLD_V = /* glsl */ `${LOG_V}
attribute float aU; attribute float aSeed; attribute float aH; attribute float aK; attribute float aLift;
varying vec3 vW; varying vec3 vN; varying float vU; varying float vSeed; varying float vH; varying float vK;
uniform float terrOn;
void main() {
  vU = aU; vSeed = aSeed; vH = aH; vN = normal; vK = aK;
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  // One lift per building (its lowest corner), walls carried 4 m into the ground on slopes.
  w.y += (aLift - (position.y < 0.01 ? 4.0 : 0.0)) * terrOn;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
const BLD_F = /* glsl */ `${LOG_F}
uniform sampler2D over; uniform sampler2D overS; uniform vec2 grid; uniform vec2 cellM; uniform float time; uniform float thermal;
varying vec3 vW; varying vec3 vN; varying float vU; varying float vSeed; varying float vH; varying float vK;
${HASH}
${LIGHT_PARS}
void main() {
  #include <logdepthbuf_fragment>
  // The building's number, snapped so every pixel of a wall gets exactly the same value
  // (tiny interpolation errors, blown up by the hash, made windows sparkle).
  float seed = floor(vSeed * 1024.0 + 0.5) / 1024.0;
  vec2 cp = vec2(vW.x / cellM.x + grid.x * 0.5, vW.z / cellM.y + grid.y * 0.5);
  vec4 o = texture2D(over, (floor(cp) + 0.5) / grid);
  vec4 os = texture2D(overS, cp / grid);
  float dark = smoothstep(0.2, 0.8, os.a), fire = o.r, glow = os.r;
  float flick = 0.7 + 0.3 * sin(time * 11.0 + seed * 50.0) * sin(time * 7.3 + vW.y);
  // Building colours: brick, concrete, painted wood, by building.
  float k = fract(seed * 7.13);
  vec3 base = k < 0.33 ? vec3(0.42, 0.26, 0.20) : k < 0.66 ? vec3(0.46, 0.45, 0.43) : vec3(0.52, 0.47, 0.38);
  base *= 0.75 + 0.5 * fract(seed * 13.7);
  int kind = int(vK + 0.5);
  bool house = kind == 6;
  if (house || kind == 1 || kind == 2 || kind == 4) {
    // Houses: painted wood siding in Minneapolis colours, some brick.
    float j = fract(seed * 5.31);
    base = j < 0.18 ? vec3(0.46, 0.27, 0.20) : j < 0.34 ? vec3(0.80, 0.78, 0.72) : j < 0.46 ? vec3(0.80, 0.72, 0.50)
      : j < 0.58 ? vec3(0.56, 0.63, 0.70) : j < 0.70 ? vec3(0.55, 0.60, 0.48) : j < 0.80 ? vec3(0.64, 0.55, 0.43)
      : j < 0.90 ? vec3(0.32, 0.40, 0.33) : vec3(0.60, 0.60, 0.58);
  }
  vec3 col;
  bool roof = vN.y > 0.5 && kind != 2 && kind != 3 && kind != 4 && kind != 5;
  float side = 0.55 + 0.45 * max(0.0, dot(vN, normalize(vec3(-0.6, 0.0, -0.8))));
  float street = exp(-vW.y / 9.0) * (1.0 - dark);
  // Lamps, headlights: the light field up close; the old height-only glow further out.
  vec3 lightW = 0.26 * side + mix(0.8 * street * vec3(1.0, 0.68, 0.38), fieldLight(vW, dark) * 0.9, inField(vW));
  if (kind == 1) {
    // Shingles: rows every 30 cm, each a slightly different shade.
    float j = fract(seed * 9.17);
    vec3 sh = j < 0.3 ? vec3(0.30, 0.30, 0.32) : j < 0.55 ? vec3(0.36, 0.26, 0.20) : j < 0.8 ? vec3(0.27, 0.32, 0.28) : vec3(0.20, 0.20, 0.22);
    float row = floor(vW.y / 0.3);
    float tab = h21(vec2(row, floor((vW.x + vW.z) / 0.9 + row * 0.5)));
    col = sh * (0.8 + 0.25 * tab) * (step(0.12, fract(vW.y / 0.3)) * 0.25 + 0.75);
    col *= 0.45 + 0.12 * (1.0 - dark) + 0.35 * max(0.0, dot(vN, normalize(vec3(-0.6, 0.7, -0.8))));
  } else if (kind == 2) {
    col = vec3(0.78, 0.76, 0.70) * lightW; // white painted porch
  } else if (kind == 3) {
    col = vec3(0.40, 0.22, 0.17) * (0.8 + 0.2 * step(0.15, fract(vW.y / 0.25))) * (vN.y < -0.5 ? 0.25 : 1.0) * lightW;
  } else if (kind == 4) {
    float j = fract(seed * 3.7);
    col = (j < 0.3 ? vec3(0.45, 0.12, 0.10) : j < 0.55 ? vec3(0.12, 0.22, 0.16) : j < 0.75 ? vec3(0.12, 0.15, 0.28) : vec3(0.30, 0.20, 0.12)) * lightW * 1.3;
  } else if (kind == 5) {
    float awake = o.a < 0.19 ? o.a / 0.177 : 0.0;
    col = mix(vec3(0.15, 0.14, 0.12), vec3(1.0, 0.82, 0.5) * 1.4, step(h21(vec2(seed * 31.0, 1.0)), 0.25 + 0.6 * awake) * (1.0 - dark));
  } else if (roof) {
    // Flat roofs: grey gravel and tar seams, a little lit by the street glow.
    vec3 rb = mix(vec3(0.36, 0.35, 0.34), base, 0.35);
    float grit = h21(floor(vW.xz * 2.0));
    vec2 sm = abs(fract(vW.xz / 7.0) - 0.5);
    col = rb * (0.85 + 0.25 * grit) * (min(sm.x, sm.y) < 0.03 ? 0.7 : 1.0);
    col *= 0.36 + 0.08 * (1.0 - dark) + 0.25 * inField(vW) * dot(fieldLight(vW, dark), vec3(0.33));
  } else {
    // Light: dark-blue sky, sodium street light from below, a little side shading.
    // Faint skylight from the north-west so each face of a building reads differently.
    col = base * lightW;
    if (house) {
      // Lap siding (light lines every 25 cm) and a concrete foundation.
      col *= 0.86 + 0.14 * step(0.18, fract(vW.y / 0.25));
      if (vW.y < 0.55) col = vec3(0.36, 0.35, 0.33) * lightW;
    }
    // Windows on a grid: floors every 3.2 m (houses 2.9), columns every 2.8 m.
    float fh = vH < 9.0 ? 2.9 : 3.2;
    float cw = vH < 9.0 ? 3.6 : 2.8;
    float fl = floor(vW.y / fh), cl = floor(vU / cw);
    vec2 f = vec2(fract(vU / cw), fract(vW.y / fh));
    float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.35, f.y) * step(f.y, 0.82) * step(1.0, vW.y) * step(vW.y, vH - 0.7);
    bool shop = false;
    if (!house && vH > 0.5) {
      // Bigger buildings: brick courses or concrete panels, a band at every floor, a
      // cornice at the top; about half have shop fronts on the ground floor.
      if (k < 0.33) col *= 0.88 + 0.12 * step(0.2, fract(vW.y / 0.3 + step(0.5, fract(vU / 0.9)) * 0.5));
      else col *= 0.92 + 0.08 * step(0.04, fract(vU / 3.0));
      if (fract(vW.y / fh) < 0.06 && vW.y > 2.0) col *= 0.75;
      if (vW.y > vH - 0.6) col = col * 1.3 + 0.02;
      shop = fract(seed * 3.31) < 0.5 && vH < 20.0;
      if (shop && vW.y < 3.6) {
        float sc = fract(vU / 4.2);
        win = step(0.08, sc) * step(sc, 0.92) * step(0.45, vW.y) * step(vW.y, 2.9);
        float door = step(0.9, h21(vec2(floor(vU / 4.2), seed)));
        if (door > 0.5) win *= step(sc, 0.4) + step(0.65, sc);
        if (vW.y > 2.9 && vW.y < 3.5) col = mix(vec3(0.5, 0.1, 0.08), vec3(0.1, 0.25, 0.4), step(0.5, fract(seed * 7.7))) * lightW * 1.4; // awning / sign band
      }
    }
    float r = h21(vec2(fl * 7.0 + seed * 91.0, cl));
    // Lit windows follow who is awake: houses wake up one by one as the news spreads.
    float awake = o.a < 0.19 ? o.a / 0.177 : 0.0;
    float lit = step(r, (0.06 + 0.5 * awake) * (1.0 - dark));
    if (shop && vW.y < 3.0) lit = step(0.35, h21(vec2(floor(vU / 4.2), seed * 3.0))) * (1.0 - dark); // shops leave lights on
    vec3 glass = vec3(0.05, 0.06, 0.10);
    vec3 lamp = mix(vec3(1.0, 0.78, 0.42), vec3(0.75, 0.85, 1.0), step(0.85, h21(vec2(cl, fl + seed))));
    vec3 wc = mix(glass, lamp * (0.7 + 0.3 * r), lit);
    // Burning: windows glow and flicker orange.
    wc = mix(wc, vec3(1.0, 0.45, 0.1) * flick * 1.3, step(0.5, fire) * step(r, 0.8));
    if (house) {
      // White trim round each window.
      float trim = step(0.22, f.x) * step(f.x, 0.78) * step(0.29, f.y) * step(f.y, 0.88) * step(1.0, vW.y) * step(vW.y, vH - 0.6);
      col = mix(col, vec3(0.80, 0.78, 0.72) * lightW, trim * (1.0 - win));
    }
    col = mix(col, wc, win);
  }
  col += vec3(0.9, 0.3, 0.05) * glow * flick * (roof ? 0.4 : 0.5) * exp(-vW.y / 30.0);
  if (thermal > 0.5) col = vec3(0.08 + 0.05 * float(roof)) + vec3(0.6) * fire;
  if (thermal < 0.5) col = haze(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------- soft round points (smoke, flames, flashes) ----------
const PTS_V = /* glsl */ `${LOG_V}
attribute float aSize; attribute vec4 aCol;
varying vec4 vCol; uniform float scale;
${TERRAIN_PARS}
void main() {
  vCol = aCol;
  vec4 pw = modelMatrix * vec4(position, 1.0);
  pw.y += terrH(pw.xz);
  vec4 mv = viewMatrix * pw;
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
  cars: THREE.Mesh | null;
  /** Bridge decks and piers (shown whenever the tile's buildings are). */
  bridges: THREE.Mesh | null;
  lamps: THREE.InstancedMesh | null;
  /** Built a moment after the tile (they take a few hundredths of a second). */
  trees: TileTrees | null;
  used: number;
}
const vehicleMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true });
const parkedMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true });
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false });

export interface CarSpot {
  x: number; // map cells
  y: number;
  angle: number; // radians about the up axis (model faces +z)
  /** Body style (see CAR_STYLES). */
  style: number;
  kind: VKind;
  colour: number;
}
/** Where parked cars stand along the kerbs of ordinary streets in a tile (not on freeways).
 *  A car is only placed if its whole footprint is clear of buildings (see vehicles.test.ts). */
export function parkedCarSpots(x0: number, y0: number): CarSpot[] {
  const s = det.roads;
  const out: CarSpot[] = [];
  for (const k of query(s, x0, y0, x0 + TILE, y0 + TILE)) {
    const wm = s.meta[k];
    if (wm < 7 || wm >= 15 || det.bridgeRoads.has(k)) continue;
    const o = s.off[k], n = s.off[k + 1] - o;
    for (let j = 0; j + 1 < n; j++) {
      const ax = s.xy[(o + j) * 2], ay = s.xy[(o + j) * 2 + 1];
      const bx = s.xy[(o + j + 1) * 2], by = s.xy[(o + j + 1) * 2 + 1];
      const lx = (bx - ax) * CELL_X, ly = (by - ay) * CELL_Y;
      const len = Math.hypot(lx, ly);
      if (len < 10) continue;
      const ux = lx / len, uy = ly / len;
      for (let d = 6; d < len - 6; d += 8.5) {
        for (const side of [-1, 1]) {
          const h = hash(k * 131 + j * 17 + Math.floor(d) * 7 + (side > 0 ? 3 : 0));
          if (h > 0.32) continue;
          const off = (wm / 2 - 1.3) * side;
          const cx = ax + (ux * d - uy * off) / CELL_X, cy = ay + (uy * d + ux * off) / CELL_Y;
          if (cx < x0 || cy < y0 || cx >= x0 + TILE || cy >= y0 + TILE) continue;
          const kind: VKind = h < 0.05 ? 'pickup' : 'car';
          const hl = (SIZE[kind].l * VEHICLE_SCALE) / 2, hw = (SIZE[kind].w * VEHICLE_SCALE) / 2;
          let clear = true;
          for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [0, 0]])
            if (blocked(cx + (ux * a - uy * b) / CELL_X, cy + (uy * a + ux * b) / CELL_Y)) clear = false;
          if (!clear) continue;
          // Not in a junction or on a crosswalk: keep clear of every other street.
          if (nearOtherRoad(k, cx, cy, 8.5)) continue;
          out.push({ x: cx, y: cy, angle: Math.atan2(ux, uy) + (h < 0.16 ? Math.PI : 0), kind, style: Math.floor(hash(k * 7 + j * 13 + d * 3) * CAR_STYLES), colour: CAR_COLOURS[Math.floor(hash(k * 3 + j * 11 + d) * CAR_COLOURS.length)] });
        }
      }
    }
  }
  return out;
}

// Parked cars are solid to people and bullets: a 10 m bucket map of their footprints, filled
// one map tile (and its neighbours) at a time on first use.
const parkedDone = new Set<number>();
const parkedB = new Map<number, { x: number; y: number; ux: number; uy: number; hl: number; hw: number }[]>();
const PB = 8; // buckets per cell (about 10 m)
export function parkedAt(x: number, y: number): boolean {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const key = (ty + j) * 10000 + tx + i;
      if (parkedDone.has(key)) continue;
      parkedDone.add(key);
      for (const c of parkedCarSpots((tx + i) * TILE, (ty + j) * TILE)) {
        const sp = { x: c.x, y: c.y, ux: Math.sin(c.angle), uy: Math.cos(c.angle), hl: (SIZE[c.kind].l * VEHICLE_SCALE) / 2, hw: (SIZE[c.kind].w * VEHICLE_SCALE) / 2 };
        const r = (sp.hl + 0.5) / CELL_X;
        for (let by = Math.floor((c.y - r) * PB); by <= Math.floor((c.y + r) * PB); by++)
          for (let bx = Math.floor((c.x - r) * PB); bx <= Math.floor((c.x + r) * PB); bx++) {
            const k = by * 100000 + bx;
            (parkedB.get(k) ?? parkedB.set(k, []).get(k)!).push(sp);
          }
      }
    }
  const list = parkedB.get(Math.floor(y * PB) * 100000 + Math.floor(x * PB));
  if (!list) return false;
  for (const c of list) {
    const dx = (x - c.x) * CELL_X, dy = (y - c.y) * CELL_Y;
    if (Math.abs(dx * c.ux + dy * c.uy) < c.hl && Math.abs(-dx * c.uy + dy * c.ux) < c.hw) return true;
  }
  return false;
}
setSolidProps(parkedAt);

const carCache = new Map<string, THREE.BufferGeometry>();
/** Parked cars for a tile, merged into one mesh with their shadows. */
function parkedCars(x0: number, y0: number): THREE.BufferGeometry | null {
  const spots = parkedCarSpots(x0, y0);
  const list: THREE.BufferGeometry[] = dressingGeometry(dressingSpots(x0, y0), (x, y, o) => cellToLocal(x, y, o));
  if (!spots.length && !list.length) return null;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
  const y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const shadow = new THREE.PlaneGeometry(SIZE.car.w * VEHICLE_SCALE * 1.15, SIZE.car.l * VEHICLE_SCALE * 1.05);
  shadow.rotateX(-Math.PI / 2);
  shadow.deleteAttribute('uv');
  shadow.deleteAttribute('normal');
  shadow.setAttribute('color', new THREE.BufferAttribute(new Float32Array(shadow.attributes.position.count * 3).fill(0.02), 3));
  for (const c of spots) {
    q.setFromAxisAngle(y, c.angle);
    cellToLocal(c.x, c.y, p);
    const sh = shadow.clone();
    m.compose(new THREE.Vector3(p.x + 0.6, 0.04, p.z + 0.6), q, one);
    sh.applyMatrix4(m);
    list.unshift(sh);
    const key = c.kind + c.colour + '/' + c.style;
    if (!carCache.has(key)) carCache.set(key, vehicleGeometry(c.kind, c.colour, c.style));
    const g = carCache.get(key)!.clone();
    m.compose(p, q, sc);
    g.applyMatrix4(m);
    list.push(g);
  }
  return mergeColoured(list);
}

function mergeColoured(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const g of list) (nv += g.attributes.position.count), (ni += g.index ? g.index.count : g.attributes.position.count);
  const P = new Float32Array(nv * 3), C = new Float32Array(nv * 3), I = new Uint32Array(ni);
  let v = 0, i = 0;
  for (const g of list) {
    const p = g.attributes.position as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      P.set([p.getX(k), p.getY(k), p.getZ(k)], (v + k) * 3);
      C.set([c.getX(k), c.getY(k), c.getZ(k)], (v + k) * 3);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) I[i++] = v + g.index.getX(k);
    else for (let k = 0; k < p.count; k++) I[i++] = v + k;
    v += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  return out;
}

/** Thermal camera: the living glow, the dead are as cold as the street. */
const THERM = { warm: new THREE.Color(1, 1, 0.95), cold: new THREE.Color(0.1, 0.12, 0.2), cool: new THREE.Color(0.3, 0.3, 0.32) };
const COL = {
  living: new THREE.Color(0.88, 0.88, 0.84),
  scared: new THREE.Color(1.0, 0.72, 0.4),
  armed: new THREE.Color(0.38, 0.62, 1.0),
  police: new THREE.Color(0.2, 0.38, 0.95),
  dead: new THREE.Color(0.44, 0.86, 0.31),
  downed: new THREE.Color(0.3, 0.6, 0.22),
  sick: new THREE.Color(0.78, 0.86, 0.7), // bitten, hiding it: grey-green, shaking
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
  private propMat: THREE.ShaderMaterial;
  /** Trees and lamps (1 = all; the auto quality may lower it). */
  treeDensity = 1;
  private tiles = new Map<number, Tile>();
  /** Sharper ground (about 3 px a metre) in a 3 x 3 cell patch round where we look, up close. */
  private nearGround: THREE.Mesh | null = null;
  private nearKey = '';
  private frameNo = 0;
  private agents: THREE.InstancedMesh;
  private rig: Rig | null = null;
  readonly light: LightField;
  /** Set each frame from the session: how far between street steps. */
  streetAlpha = 1;
  private litFrame = 0;
  private agentsB: THREE.InstancedMesh;
  private shadows: THREE.InstancedMesh;
  /** Cars people are driving away in (street level). */
  private cars: THREE.InstancedMesh[];
  /** Lit head- and taillights of cars on the move. */
  private carLights: THREE.InstancedMesh;
  private heroVeh = new Map<string, THREE.Mesh>();
  private heroFig = new Map<string, THREE.Mesh>();
  private selBox: THREE.LineSegments;
  /** The hero whose ID card is open (gets a thin box round them). */
  selected = '';
  private blood: THREE.InstancedMesh;
  private tracers: THREE.LineSegments;
  /** Patched heroes: where they are going (dashes on the ground). */
  private routeLine: THREE.LineSegments;
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
    this.light = new LightField();
    this.shared = {
      ...this.light.uniforms(),
      over: { value: this.overTex },
      overS: { value: this.overSmooth },
      grid: { value: new THREE.Vector2(GW, GH) },
      cellM: { value: new THREE.Vector2(CELL_X, CELL_Y) },
      time: { value: 0 },
      thermal: { value: 0 },
      ...terrainUniforms(HALF_W, HALF_H),
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
    const g = new THREE.PlaneGeometry(GW * CELL_X, GH * CELL_Y, GW, GH); // a vertex every cell, lifted onto the ground
    g.rotateX(-Math.PI / 2); // lie flat; uv v=1 is north (top of the picture)
    this.base = new THREE.Mesh(g, this.baseMat);
    this.base.renderOrder = -10;
    this.scene.add(this.base);
    // Everything in the city is in the 'transparent' list so draw order is just renderOrder:
    // ground first (no depth), then buildings, people, tracers, smoke.
    this.bldMat = new THREE.ShaderMaterial({ vertexShader: BLD_V, fragmentShader: BLD_F, uniforms: this.shared, transparent: true });
    this.propMat = propMaterial(this.shared);
    // People: a little figure (body + head), lit from above by vertex shading.
    const mk = (geo: THREE.BufferGeometry) => {
      const im = new THREE.InstancedMesh(geo, litBasic(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }), this.shared, 0.75), 2600);
      im.renderOrder = 1;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2600 * 3), 3);
      im.frustumCulled = false;
      im.count = 0;
      this.scene.add(im);
      return im;
    };
    // Two poses, mid-step one way and the other: walkers flip between them.
    this.agents = mk(figureGeometry(1));
    this.agentsB = mk(figureGeometry(-1));
    const sg = new THREE.CircleGeometry(0.42, 8);
    sg.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(sg, shadowMat, 2600);
    this.shadows.renderOrder = -4;
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.scene.add(this.shadows);
    // Cars on the move: one shape, many paint colours (multiplied in).
    litBasic(vehicleMat, this.shared, 0.5);
    litBasic(parkedMat, this.shared, 0.5, true); // parked cars and street furniture: every point on the ground
    lifted(shadowMat, this.shared);
    this.cars = [];
    for (let st = 0; st < CAR_STYLES; st++) {
      const im = new THREE.InstancedMesh(vehicleGeometry('car', 0xffffff, st), vehicleMat, 900);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(900 * 3), 3);
      im.frustumCulled = false;
      im.renderOrder = 0.6;
      im.count = 0;
      this.scene.add(im);
      this.cars.push(im);
    }
    this.carLights = new THREE.InstancedMesh(carLightsGeometry(), lifted(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true }), this.shared), 900);
    this.carLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carLights.frustumCulled = false;
    this.carLights.renderOrder = 0.65;
    this.carLights.count = 0;
    this.scene.add(this.carLights);
    // Heroes: their vehicle and themselves, and a thin selection box.
    for (const h of HEROES) {
      const v = new THREE.Mesh(vehicleGeometry(h.vehicle.kind, h.vehicle.colour), vehicleMat);
      v.scale.setScalar(VEHICLE_SCALE);
      v.renderOrder = 0.6;
      v.visible = false;
      this.scene.add(v);
      this.heroVeh.set(h.id, v);
      const f = new THREE.Mesh(figureGeometry(0), lifted(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, color: 0xffe08a }), this.shared));
      f.scale.setScalar(2.0);
      f.renderOrder = 1;
      f.visible = false;
      this.scene.add(f);
      this.heroFig.set(h.id, f);
    }
    this.selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), lifted(new THREE.LineBasicMaterial({ color: 0xffd640, transparent: true, depthTest: false }), this.shared));
    this.selBox.renderOrder = 6;
    this.selBox.visible = false;
    this.scene.add(this.selBox);
    const bg = new THREE.CircleGeometry(1, 6);
    bg.rotateX(-Math.PI / 2);
    this.blood = new THREE.InstancedMesh(bg, lifted(new THREE.MeshBasicMaterial({ color: 0x5a0e10, depthWrite: false, depthTest: false }), this.shared), 4000);
    this.blood.renderOrder = -5;
    this.blood.frustumCulled = false;
    this.blood.count = 0;
    this.scene.add(this.blood);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4000 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(4000 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, lifted(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true }), this.shared, true));
    this.tracers.renderOrder = 2;
    this.tracers.frustumCulled = false;
    this.scene.add(this.tracers);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6000 * 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.routeLine = new THREE.LineSegments(rg, lifted(new THREE.LineBasicMaterial({ color: 0xffd640, transparent: true, opacity: 0.9, depthTest: false }), this.shared, true));
    this.routeLine.renderOrder = 6;
    this.routeLine.frustumCulled = false;
    this.scene.add(this.routeLine);
    const pg = new THREE.BufferGeometry();
    const NP = 6000;
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(NP), 1).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(NP * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.ptsMat = new THREE.ShaderMaterial({
      vertexShader: PTS_V,
      fragmentShader: PTS_F,
      uniforms: { scale: { value: 300 }, ...terrainUniforms(HALF_W, HALF_H) },
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
    const asleep = asleepShare(s.env().hour);
    for (let i = 0; i < GW * GH; i++) {
      const j = i * 4;
      o[j] = Math.min(255, f[i] * 255);
      o[j + 1] = Math.min(255, w.infected[i] * 2);
      o[j + 2] = Math.min(255, w.healthy[i] * 1.2);
      // Alpha: 255 = power out; small values = how many windows are lit (people awake).
      const aware = w.aware[i];
      o[j + 3] = s.isDark(i) ? 255 : Math.round(45 * (1 - asleep * (1 - aware)));
    }
    const st = s.street;
    if (st)
      for (let li = 0; li < st.aware.length; li++) {
        const i = (st.y0 + Math.floor(li / st.w)) * GW + st.x0 + (li % st.w);
        if (o[i * 4 + 3] < 255) o[i * 4 + 3] = Math.round(45 * (1 - asleep * (1 - st.aware[li])));
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
      let treesBuilt = 0;
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
        // Trees for near tiles, one tile per frame (each takes a few hundredths of a second).
        if (tile && !tile.trees && d < 3 && dist < groundR + tw && treesBuilt < 1 && built === 0) {
          tile.trees = buildTrees(treeSpots(tile.key % 1000 * TILE, Math.floor(tile.key / 1000) * TILE, this.treeDensity), this.propMat, (x, y, o) => cellToLocal(x, y, o));
          for (const m of tile.trees.meshes) this.scene.add(m);
          treesBuilt++;
        }
      }
    }
    for (const [key, tile] of this.tiles) {
      const vis = want.has(key);
      tile.ground.visible = wantGround.has(key);
      if (tile.bld) tile.bld.visible = vis;
      if (tile.cars) tile.cars.visible = vis && d < 3;
      if (tile.bridges) tile.bridges.visible = vis;
      if (tile.lamps) tile.lamps.visible = vis && d < 3;
      if (tile.trees) for (const m of tile.trees.meshes) m.visible = vis && d < 3;
      (tile.ground.material as THREE.ShaderMaterial).uniforms.dots.value = dots;
      (tile.ground.material as THREE.ShaderMaterial).uniforms.alpha.value = this.alpha;
      if (!vis && this.frameNo - tile.used > 600) this.dropTile(tile);
    }
    this.propMat.uniforms.alpha.value = this.alpha;
    // Real light near where we look: lamps (when the field moves) and moving lights.
    if (d < 3) {
      const lv = cellToLocal(look.x, look.y, new THREE.Vector3());
      this.light.centre(lv.x, lv.z, (x0, z0, x1, z1) => {
        const a = localToCell(new THREE.Vector3(x0, 0, z0)), b = localToCell(new THREE.Vector3(x1, 0, z1));
        const out: { x: number; z: number }[] = [];
        const v = new THREE.Vector3();
        for (const l of lampSpots(a.x, a.y, b.x, b.y)) {
          cellToLocal(l.x, l.y, v);
          out.push({ x: v.x + Math.cos(l.arm) * 1.6, z: v.z + Math.sin(l.arm) * 1.6 });
        }
        return out;
      });
      if (++this.litFrame % 2 === 0) {
        const list: MovingLight[] = [];
        const st = s.street, v = new THREE.Vector3();
        if (st)
          for (const a of st.agents) {
            if (a.gone) continue;
            if (a.car === 1 && a.kind === Kind.Living) {
              cellToLocal(a.x, a.y, v);
              list.push({ x: v.x, z: v.z, dir: a.face, power: 0.95, reach: 28 });
            } else if (a.flash > 0) {
              cellToLocal(a.x, a.y, v);
              list.push({ x: v.x, z: v.z, dir: NaN, power: 1, reach: 8 });
            }
          }
        this.light.moving(list);
      }
    }
    // Haze beyond where we look (only near the ground; from high up the city stays clear).
    {
      const lv = cellToLocal(look.x, look.y, new THREE.Vector3());
      const D = camLocal.distanceTo(lv);
      this.light.hazeR.set(D * 1.05, D * 3.5, THREE.MathUtils.clamp((3 - d) / 2, 0, 1) * 0.6);
    }
    this.updateNearGround(look, d, dots);
    this.streetAlpha = s.streetAlpha;
    this.updateStreet(s.street, time, look, d);
    this.updateCanopy(s);
    this.updateHeroes(s, d, time);
    this.updateRoute(s, d, time);
    this.updatePoints(s, look, d, time);
    this.ptsMat.uniforms.scale.value = screenH / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    void camLocal;
  }

  /** Where a hero is right now (local metres), for clicking and labels. null = not drawn. */
  heroPos(id: string): THREE.Vector3 | null {
    const f = this.heroFig.get(id), v = this.heroVeh.get(id);
    const lift = (p: THREE.Vector3) => {
      const c = localToCell(p);
      return p.clone().setY(2 + heightAt(c.x, c.y));
    };
    if (f && f.visible) return lift(f.position);
    if (v && v.visible) return lift(v.position);
    return null;
  }

  /** Dashed lines along the patched heroes' way: to the meeting point, then out of the city.
   *  The dashes crawl toward where they are going. */
  private updateRoute(s: Session, d: number, time: number) {
    const pos = this.routeLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const dash = Math.max(6, d * 14); // metres
    let n = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const line of s.linkLines()) {
      let phase = -((time * dash) % (dash * 2));
      for (let i = 1; i < line.length && n < 5990; i++) {
        cellToLocal(line[i - 1].x, line[i - 1].y, a, 3);
        cellToLocal(line[i].x, line[i].y, b, 3);
        const len = a.distanceTo(b);
        let t = phase;
        while (t < len && n < 5990) {
          const t0 = Math.max(0, t), t1 = Math.min(len, t + dash);
          if (t1 > t0) {
            arr.set([a.x + ((b.x - a.x) * t0) / len, 3, a.z + ((b.z - a.z) * t0) / len, a.x + ((b.x - a.x) * t1) / len, 3, a.z + ((b.z - a.z) * t1) / len], n * 6);
            n++;
          }
          t += dash * 2;
        }
        phase = t - len;
      }
    }
    this.routeLine.geometry.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
  }

  private updateHeroes(s: Session, d: number, time: number) {
    const close = d < 4 && this.alpha > 0.3;
    const y = new THREE.Vector3(0, 1, 0);
    let sel: THREE.Object3D | null = null;
    for (const h of HEROES) {
      const hs = s.heroState(h.id);
      const v = this.heroVeh.get(h.id)!, f = this.heroFig.get(h.id)!;
      if (!hs || !close) {
        v.visible = f.visible = false;
        continue;
      }
      const at = s.heroWhere(h.id, s.acc);
      cellToLocal(at.x, at.y, v.position);
      // Model faces +z (south); route angle is from +x (east) toward +y (south).
      v.quaternion.setFromAxisAngle(y, Math.PI / 2 - at.face);
      // Mai has no vehicle until the stranger's pickup stops for her.
      v.visible = !hs.out && !hs.riding && !(h.id === 'dorms' && (hs.escapeStart < 0 || hs.link));
      const onRoad = at.moving;
      f.visible = !hs.dead && !onRoad && !hs.out && !hs.riding;
      if (f.visible) {
        // Stand beside the vehicle door (or on the spot).
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(v.quaternion).multiplyScalar(v.visible ? 2.6 : 0);
        f.position.copy(v.position).add(side);
        f.quaternion.copy(v.quaternion);
        f.position.y = Math.abs(Math.sin(time * 2)) * 0.05;
      }
      if (this.thermal) (f.material as THREE.MeshBasicMaterial).color.setRGB(1, 1, 0.95);
      else (f.material as THREE.MeshBasicMaterial).color.setHex(0xffe08a);
      if (h.id === this.selected) sel = f.visible ? f : v.visible ? v : null;
    }
    // The selection box: thin, round the hero (or their vehicle on the road).
    this.selBox.visible = !!sel;
    if (sel) {
      const b = new THREE.Box3().setFromObject(sel);
      if (sel === this.heroFig.get(this.selected)) {
        const veh = this.heroVeh.get(this.selected)!;
        if (veh.visible) b.union(new THREE.Box3().setFromObject(veh));
      }
      b.expandByScalar(1.2);
      b.getCenter(this.selBox.position);
      b.getSize(this.selBox.scale);
      this.selBox.quaternion.identity();
      (this.selBox.material as THREE.LineBasicMaterial).opacity = 0.65 + 0.35 * Math.sin(time * 4);
    }
  }

  private updateNearGround(look: { x: number; y: number }, d: number, dots: number) {
    const on = d < 0.6;
    if (this.nearGround) this.nearGround.visible = on;
    if (!on) return;
    const NC = 3, PPC = 256;
    const x0 = Math.floor(look.x) - 1, y0 = Math.floor(look.y) - 1;
    const key = x0 + ',' + y0;
    if (!this.nearGround) {
      const c = document.createElement('canvas');
      c.width = c.height = NC * PPC;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.NoColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 4;
      const g = new THREE.PlaneGeometry(NC * CELL_X, NC * CELL_Y, NC * 12, NC * 12);
      g.rotateX(-Math.PI / 2);
      this.nearGround = new THREE.Mesh(g, this.groundMat(tex, 1));
      this.nearGround.renderOrder = -8;
      this.scene.add(this.nearGround);
    }
    const mat = this.nearGround.material as THREE.ShaderMaterial;
    mat.uniforms.dots.value = dots;
    mat.uniforms.alpha.value = this.alpha;
    if (key === this.nearKey) return;
    this.nearKey = key;
    const tex = mat.uniforms.map.value as THREE.CanvasTexture;
    const c = tex.image as HTMLCanvasElement;
    drawGround(c.getContext('2d')!, x0, y0, NC, NC, PPC);
    tex.needsUpdate = true;
    cellToLocal(x0 + NC / 2, y0 + NC / 2, this.nearGround.position);
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
    const g = new THREE.PlaneGeometry(TILE * CELL_X, TILE * CELL_Y, TILE * 6, TILE * 6);
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
    const cg = parkedCars(x0, y0);
    let cars: THREE.Mesh | null = null;
    if (cg) {
      cars = new THREE.Mesh(cg, parkedMat);
      cars.renderOrder = 0.5;
      this.scene.add(cars);
    }
    const bgeo = bridgeGeometry(x0, y0, (x, y, o) => cellToLocal(x, y, o));
    let bridges: THREE.Mesh | null = null;
    if (bgeo) {
      bridges = new THREE.Mesh(bgeo, parkedMat);
      bridges.renderOrder = 0.3;
      this.scene.add(bridges);
    }
    const lamps = buildLamps(lampSpots(x0, y0), this.propMat, (x, y, o) => cellToLocal(x, y, o));
    if (lamps) this.scene.add(lamps);
    const tile = { key, ground, bld, cars, bridges, lamps, trees: null, used: this.frameNo };
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
    if (t.bridges) {
      this.scene.remove(t.bridges);
      t.bridges.geometry.dispose();
    }
    if (t.cars) {
      this.scene.remove(t.cars);
      t.cars.geometry.dispose();
    }
    if (t.lamps) {
      this.scene.remove(t.lamps);
      t.lamps.geometry.dispose();
      t.lamps.dispose();
    }
    if (t.trees)
      for (const m of t.trees.meshes) {
        this.scene.remove(m);
        m.geometry.dispose();
        m.dispose();
      }
    this.tiles.delete(t.key);
  }

  private updateStreet(st: Street | null, time: number, look: { x: number; y: number }, d: number) {
    const A = this.agents, A2 = this.agentsB, SH = this.shadows;
    if (!this.rig) this.rig = new Rig(this.scene, this.shared);
    const rig = this.rig;
    rig.begin();
    if (!st) {
      rig.end();
      A.count = 0;
      A2.count = 0;
      SH.count = 0;
      for (const im of this.cars) im.count = 0;
      this.carLights.count = 0;
      this.blood.count = 0;
      (this.tracers.geometry as THREE.BufferGeometry).setDrawRange(0, 0);
      return;
    }
    // People drawn bigger than life so you can read them from far; closer to true size up close.
    const FIG = THREE.MathUtils.clamp(1.6 + d * 1.6, 1.6, 2.0);
    // Up close everyone within this ring is built from moving parts (see rig.ts).
    const rigR = d < 0.35 ? Math.min(150, d * 1000) : 0;
    let n = 0, n2 = 0, ns = 0;
    const m = this.tmpM, q = this.tmpQ, p = this.tmpV, sc = this.tmpS;
    const one = new THREE.Vector3(1, 1, 1), sp = new THREE.Vector3(), q0 = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0);
    const ncs = new Array(CAR_STYLES).fill(0);
    let nc = 0, nl = 0;
    const cc = new THREE.Color();
    const putCar = (uid: number, mat: THREE.Matrix4, col: THREE.Color) => {
      const st = Math.floor(hash(uid * 131 + 7) * CAR_STYLES), im = this.cars[st];
      im.setMatrixAt(ncs[st], mat);
      im.setColorAt(ncs[st], col);
      ncs[st]++;
      nc++;
    };
    const al = this.streetAlpha;
    for (let k = 0; k < st.agents.length && n + n2 < 2600; k++) {
      const a = st.agents[k];
      // Between the last two steps (big jumps, like getting in a car, are not slid).
      const jx = a.x - a.px, jy = a.y - a.py;
      if (jx * jx + jy * jy < 0.003) cellToLocal(a.px + jx * al, a.py + jy * al, p);
      else cellToLocal(a.x, a.y, p);
      // On a bridge deck: raise them from the ground (under it) up to the deck.
      const car = a.car === 1;
      const dk = deckAt(a.x, a.y, car ? Math.cos(a.face) : a.vx, car ? Math.sin(a.face) : a.vy);
      const dl = dk === null ? 0 : dk - heightAt(a.x, a.y);
      if (a.kind === Kind.Living && a.car === 1) {
        // Driving away: a car, facing the way it goes.
        if (nc < 900) {
          q.setFromAxisAngle(yAxis, -a.face + Math.PI / 2);
          p.y = (0) + dl;
          m.compose(p, q, sc.set(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE));
          cc.setHex(CAR_COLOURS[Math.floor(hash(a.uid * 977) * CAR_COLOURS.length)]);
          putCar(a.uid, m, this.thermal ? THERM.warm : cc);
          if (!this.thermal) this.carLights.setMatrixAt(nl++, m);
        }
        continue;
      }
      if (rigR > 0 && !rig.full && Math.hypot((a.x - look.x) * CELL_X, (a.y - look.y) * CELL_Y) < rigR) {
        if (ns < 2600 && a.kind !== Kind.Fallen) {
          sp.set(p.x + 0.4, 0.03 + dl, p.z + 0.4);
          m.compose(sp, q0, one.set(FIG * 0.8, 1, FIG * 0.8));
          SH.setMatrixAt(ns++, m);
        }
        p.y = (0) + dl;
        const th = this.thermal ? (a.kind === Kind.Living ? THERM.warm : a.kind === Kind.Dead ? THERM.cold : THERM.cool) : null;
        rig.add(a, p, -a.face + Math.PI / 2, FIG, time, th);
        continue;
      }
      let c = COL.living;
      let flip = false;
      const lying = a.kind === Kind.Fallen || (a.kind === Kind.Dead && a.down > 0) || (a.kind === Kind.Living && (a.turn >= 0 || a.held > 0)) || (a.kind === Kind.Dead && !!a.hold);
      if (lying) {
        q.setFromAxisAngle(yAxis, a.face);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, Math.PI / 2));
        p.y = (0.25) + dl;
        c = a.kind === Kind.Fallen ? COL.fallen : a.kind === Kind.Living ? (a.turn >= 0 ? COL.sick : COL.living) : a.hold ? COL.dead : COL.downed;
      } else {
        // Face where they are going (sim angles: x east, y south, same as our x and z).
        q.setFromAxisAngle(yAxis, -a.face + Math.PI / 2);
        const moving = Math.hypot(a.vx, a.vy) > 0.0001;
        p.y = (moving ? Math.abs(Math.sin(time * 14 + k)) * 0.12 : 0) + dl;
        // Walkers alternate between the two stride poses; the dead run faster and wilder.
        flip = moving && Math.floor(time * (a.kind === Kind.Dead ? 9 : 6) + hash(k) * 2) % 2 === 1;
        if (ns < 2600) {
          sp.set(p.x + 0.5, 0.03 + dl, p.z + 0.5);
          m.compose(sp, q0, one.set(FIG * 0.9, 1, FIG * 0.9));
          SH.setMatrixAt(ns++, m);
        }
        if (a.kind === Kind.Dead && a.lunge > 0) {
          // Leaping: thrown forward.
          q.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, 0.8));
          p.y = (0.4) + dl;
          flip = true;
        } else if (a.kind === Kind.Dead && a.crawl) {
          // Crawling: low to the ground, dragging itself.
          q.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, 1.25));
          p.y = (0.2) + dl;
          flip = false;
        }
        if (a.kind === Kind.Dead) c = COL.dead;
        else if (a.turn >= 0) c = COL.sick;
        else if (a.role === Role.Police) c = COL.police;
        else if (a.armed && a.ammo > 0) c = COL.armed;
        else if (a.fear > 0.5) c = COL.scared;
      }
      if (this.thermal) c = a.kind === Kind.Living ? THERM.warm : a.kind === Kind.Dead ? THERM.cold : THERM.cool;
      sc.set(FIG, FIG, FIG);
      m.compose(p, q, sc);
      if (flip) {
        A2.setMatrixAt(n2, m);
        A2.setColorAt(n2, c);
        n2++;
      } else {
        A.setMatrixAt(n, m);
        A.setColorAt(n, c);
        n++;
      }
    }
    for (const M of [A, A2]) {
      M.count = M === A ? n : n2;
      M.instanceMatrix.needsUpdate = true;
      if (M.instanceColor) M.instanceColor.needsUpdate = true;
    }
    SH.count = ns;
    SH.instanceMatrix.needsUpdate = true;
    rig.end();
    // Wrecks: crashed cars burnt dark and knocked askew, abandoned ones dimmed, all where they stopped.
    for (const w of st.wrecks) {
      if (nc >= 900) break;
      cellToLocal(w.x, w.y, p);
      p.y = 0;
      q.setFromAxisAngle(yAxis, -w.face + Math.PI / 2 + (w.crashed ? (hash(w.uid) - 0.5) * 0.9 : 0));
      m.compose(p, q, sc.set(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE));
      if (this.thermal) cc.copy(w.burn > 0 ? THERM.warm : THERM.cool);
      else if (w.crashed) cc.setHex(w.burn > 0 ? 0x3a2a20 : 0x2a2622);
      else cc.setHex(CAR_COLOURS[Math.floor(hash(w.uid * 977) * CAR_COLOURS.length)]).multiplyScalar(0.55);
      putCar(w.uid, m, cc);
    }
    this.cars.forEach((im, i) => {
      im.count = ncs[i];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
    this.carLights.count = nl;
    this.carLights.instanceMatrix.needsUpdate = true;
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
    // Drizzle near the camera (16 Oct 2009 had a little; the hours are a guess).
    const rain = drizzle(s.env().hour);
    if (rain > 0 && d < 1.2 && this.alpha > 0.5) {
      const nr = Math.floor(900 * rain);
      for (let k = 0; k < nr; k++) {
        const h1 = hash(k * 7 + 1), h2 = hash(k * 13 + 5), h3 = hash(k * 29 + 3);
        const fall = (time * (0.9 + h3 * 0.3) + h1) % 1;
        cellToLocal(look.x + (h1 - 0.5) * 10 * d, look.y + (h2 - 0.5) * 10 * d, p);
        add(p.x, 40 * (1 - fall), p.z, 1.2, 0.6, 0.66, 0.78, 0.35);
      }
    }
    const st = s.street;
    if (st) {
      for (const a of st.agents)
        if (a.flash > 0) {
          cellToLocal(a.x, a.y, p);
          add(p.x, 1.8, p.z, 4, 1.0, 0.95, 0.7, 1);
        }
      // Headlights ahead of every car on the move; brake lights when it is stuck in a jam.
      for (const a of st.agents) {
        if (a.kind !== Kind.Living || a.car !== 1) continue;
        const fx = Math.cos(a.face), fy = Math.sin(a.face);
        const L = (SIZE.car.l * VEHICLE_SCALE) / 2 / CELL_X;
        const side = (0.6 * VEHICLE_SCALE) / CELL_X;
        for (const sgn of [-1, 1]) {
          cellToLocal(a.x + fx * L - fy * side * sgn, a.y + fy * L + fx * side * sgn, p);
          add(p.x, 0.9, p.z, 3, 1.0, 0.95, 0.8, 0.95);
          if (a.stuck > 0.5) {
            cellToLocal(a.x - fx * L - fy * side * sgn, a.y - fy * L + fx * side * sgn, p);
            add(p.x, 0.9, p.z, 2.5, 1.0, 0.15, 0.1, 0.9);
          }
        }
        // The beam on the road.
        cellToLocal(a.x + fx * L * 3, a.y + fy * L * 3, p);
        add(p.x, 0.3, p.z, 8, 0.9, 0.85, 0.6, 0.12);
      }
      // A burning wreck: flames, and orange light on the road around it.
      for (const w of st.wrecks) {
        if (w.burn <= 0) continue;
        cellToLocal(w.x, w.y, p);
        const fl = 0.75 + 0.25 * Math.sin(time * 17 + w.uid);
        add(p.x, 1.6, p.z, 5 * fl, 1.0, 0.55, 0.15, 0.9);
        add(p.x, 0.4, p.z, 14, 1.0, 0.45, 0.1, 0.18 * fl);
      }
      // Hazard lights blinking on cars left in the jam.
      for (const w of st.wrecks) {
        if (w.crashed || Math.floor(time * 1.6 + hash(w.uid)) % 2) continue;
        cellToLocal(w.x, w.y, p);
        add(p.x, 0.9, p.z, 2.5, 1.0, 0.6, 0.1, 0.9);
      }
      for (const pf of st.puffs) {
        cellToLocal(pf.x, pf.y, p);
        add(p.x, 0.8, p.z, 2.5, 0.75, 0.7, 0.6, Math.min(1, pf.t * 3));
      }
    }
    pos.needsUpdate = size.needsUpdate = col.needsUpdate = true;
    g.setDrawRange(0, n);
  }

  /** Treetops dissolve where people are underneath (and around the heroes), so the
   *  trees never hide what happens on the ground. */
  private updateCanopy(s: Session) {
    const st = s.street;
    const G = 5 / CELL_X; // 5 m squares
    const occ = new Set<number>();
    const mark = (x: number, y: number) => occ.add(Math.floor(y / G) * 100000 + Math.floor(x / G));
    if (st) for (const a of st.agents) if (a.kind !== Kind.Fallen && !a.gone) mark(a.x, a.y);
    for (const [, f] of this.heroFig) if (f.visible) {
      const c = localToCell(f.position);
      mark(c.x, c.y);
    }
    for (const [, v] of this.heroVeh) if (v.visible) {
      const c = localToCell(v.position);
      mark(c.x, c.y);
    }
    for (const t of this.tiles.values()) {
      if (!t.trees) continue;
      const tx = (t.key % 1000) * TILE, ty = Math.floor(t.key / 1000) * TILE;
      const overlaps = occ.size > 0 && (!st || (tx < st.x0 + st.w + 1 && tx + TILE > st.x0 - 1 && ty < st.y0 + st.h + 1 && ty + TILE > st.y0 - 1));
      if (!overlaps && !t.trees.faded) continue;
      t.trees.faded = false;
      const touched = new Set<number>();
      for (const tr of t.trees.list) {
        let near = false;
        if (occ.size) {
          const gx = Math.floor(tr.x / G), gy = Math.floor(tr.y / G);
          for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) if (occ.has((gy + dy) * 100000 + gx + dx)) near = true;
        }
        const target = near ? 0.85 : 0;
        if (target > 0 || tr.fade > 0) t.trees.faded = true;
        if (Math.abs(target - tr.fade) < 0.01) continue;
        tr.fade += (target - tr.fade) * 0.15;
        if (Math.abs(target - tr.fade) < 0.02) tr.fade = target;
        const at = t.trees.meshes[tr.m].geometry.attributes.aFade as THREE.InstancedBufferAttribute;
        at.setX(tr.i, tr.fade);
        touched.add(tr.m);
      }
      for (const m of touched) t.trees.meshes[m].geometry.attributes.aFade.needsUpdate = true;
    }
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
  if (ppc >= 32) return drawStreetGround(g, x0, y0, w, h, ppc);
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
const PARAPET = 0.9;
export function buildingGeometry(s: Shapes, x0: number, y0: number): THREE.BufferGeometry | null {
  const B: Buf = { P: [], N: [], U: [], S: [], H: [], K: [], I: [] };
  const { P, N, U, S, H, I } = B;
  const L: number[] = []; // lift per vertex: each building's lowest ground
  let lift = 0;
  const fillLift = () => {
    while (L.length < P.length / 3) L.push(lift);
  };
  const v = new THREE.Vector3();
  const rp = { x: 0, y: 0, tx: 1, ty: 0 };
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
    fillLift();
    lift = Infinity;
    for (let j = 0; j < n; j++) lift = Math.min(lift, heightAt(xs(j), ys(j)));
    const house = fitHouse(ring, h);
    const wallKind = house ? HK.house : HK.wall;
    let u = 0;
    for (let j = 0; j < n; j++) {
      const a = ring[j], b = ring[(j + 1) % n];
      const len = a.distanceTo(b);
      if (len < 0.05) continue;
      // Outward normal in x/z.
      // (A counter-clockwise ring has its inside on the left of each edge, so outward is to the right.)
      const nx = ((b.y - a.y) / len) * sign, nz = ((a.x - b.x) / len) * sign;
      const base = P.length / 3;
      const top = house ? h : h + PARAPET; // flat roofs get a low wall round the edge
      // OSM often draws a building and its parts with the same front wall: nudge each
      // building's walls out by its own few centimetres so two never fight (flicker).
      const ox = nx * (0.02 + 0.08 * seed), oz = nz * (0.02 + 0.08 * seed);
      P.push(a.x + ox, 0, a.y + oz, b.x + ox, 0, b.y + oz, b.x + ox, top, b.y + oz, a.x + ox, top, a.y + oz);
      for (let q = 0; q < 4; q++) N.push(nx, 0, nz), S.push(seed), H.push(h), B.K.push(wallKind);
      U.push(u, u + len, u + len, u);
      u += len;
      // Wind each wall so its front faces outward (back faces are skipped when drawing).
      if (sign > 0) I.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      if (!house) {
        // Inside face of the parapet (seen from above), facing in.
        const ib = P.length / 3;
        P.push(a.x, h, a.y, b.x, h, b.y, b.x, top, b.y, a.x, top, a.y);
        for (let q = 0; q < 4; q++) N.push(-nx, 0, -nz), S.push(seed), H.push(0), B.K.push(HK.trim), U.push(0);
        if (sign > 0) I.push(ib, ib + 1, ib + 2, ib, ib + 2, ib + 3);
        else I.push(ib, ib + 2, ib + 1, ib, ib + 3, ib + 2);
      }
    }
    if (house) {
      // A house: pitched roof, chimney, porch and door toward the nearest street.
      let front: [number, number] | null = null;
      const net = roadNet();
      const hit = net ? nearestRoad(net, cx, cy, 0.6) : null;
      if (hit) {
        pointAt(net!, hit.edge, hit.along, rp);
        const fx = (rp.x - cx) * CELL_X, fz = (rp.y - cy) * CELL_Y, fl = Math.hypot(fx, fz);
        if (fl > 1) front = [fx / fl, fz / fl];
      }
      addHouse(B, house, h, seed, front);
      continue;
    }
    const tris = THREE.ShapeUtils.triangulateShape(ring, []);
    const base = P.length / 3;
    for (const r of ring) {
      P.push(r.x, h + 0.05 * seed, r.y);
      N.push(0, 1, 0);
      U.push(0);
      S.push(seed);
      H.push(h);
      B.K.push(HK.wall);
    }
    for (const t of tris) {
      // Roof triangles face up: (p1 - p0) x (p2 - p0) must point to +y.
      const a = ring[t[0]], b = ring[t[1]], c = ring[t[2]];
      const up = (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
      if (up > 0) I.push(base + t[0], base + t[1], base + t[2]);
      else I.push(base + t[0], base + t[2], base + t[1]);
    }
    // Flat roofs: air-conditioning units, vents, and a stair house on tall buildings,
    // placed only where they land inside the outline.
    const A = Math.abs(area) / 2;
    if (A > 150 && h > 5) {
      let mx = 0, mz = 0;
      for (const r of ring) (mx += r.x), (mz += r.y);
      mx /= n;
      mz /= n;
      const rad = Math.sqrt(A) * 0.35;
      const inside = (x: number, z: number) => {
        let c = false;
        for (let j = 0, i = n - 1; j < n; i = j++) {
          const xi = ring[i].x, zi = ring[i].y, xj = ring[j].x, zj = ring[j].y;
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
        }
        return c;
      };
      // Line the units up with the longest wall.
      let best = 0, ax = 1, az = 0;
      for (let j = 0; j < n; j++) {
        const a = ring[j], b = ring[(j + 1) % n], l = a.distanceTo(b);
        if (l > best) (best = l), (ax = (b.x - a.x) / l), (az = (b.y - a.y) / l);
      }
      const units = Math.min(8, 1 + Math.floor(A / 300));
      for (let q = 0; q < units; q++) {
        const ox = (hash(k * 7 + q) - 0.5) * 2 * rad, oz = (hash(k * 11 + q) - 0.5) * 2 * rad;
        const x = mx + ox, z = mz + oz;
        if (!inside(x, z)) continue;
        const big = hash(k * 13 + q) > 0.6;
        hbox(B, x, h, z, ax, az, big ? 1.4 : 0.6, big ? 1.0 : 0.6, big ? 0.7 : 0.4, seed, HK.trim);
      }
      if (h > 14 && inside(mx, mz)) hbox(B, mx, h, mz, ax, az, 2.4, 1.8, 1.6, seed, HK.wall);
    }
  }
  if (!P.length) return null;
  fillLift();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(U, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(S, 1));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(H, 1));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(B.K, 1));
  g.setAttribute('aLift', new THREE.Float32BufferAttribute(L, 1));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

/** A blocky person, 1.8 m: legs, arms, body, head; vertex colours give simple top light.
 *  stride 0 = standing, +1 / -1 = mid-step (legs and arms swing opposite ways). */
function figureGeometry(stride = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, y: number, x = 0, z = 0, tilt = 0) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(0, -h / 2, 0); // swing from the top (hip or shoulder)
    if (tilt) b.rotateX(tilt);
    b.translate(x, y + h, z);
    parts.push(b);
  };
  const a = stride * 0.45;
  box(0.22, 0.82, 0.24, 0.0, -0.13, 0, a); // legs
  box(0.22, 0.82, 0.24, 0.0, 0.13, 0, -a);
  box(0.56, 0.66, 0.32, 0.8); // body
  box(0.14, 0.62, 0.16, 0.84, -0.36, 0, -a * 0.8); // arms
  box(0.14, 0.62, 0.16, 0.84, 0.36, 0, a * 0.8);
  box(0.3, 0.3, 0.3, 1.47); // head
  const merged = mergeGeoms(parts);
  const n = merged.attributes.normal as THREE.BufferAttribute;
  const p = merged.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const shade = n.getY(i) > 0.5 ? 1.0 : n.getY(i) < -0.5 ? 0.4 : 0.62 + 0.12 * n.getX(i);
    const legs = p.getY(i) < 0.8 ? 0.62 : 1;
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

/** Up close (about 1 m per pixel): lawns and paved squares, boulevard grass and
 *  sidewalks with kerbs, asphalt, lane paint, crosswalks at busy junctions, fallen
 *  leaves, and the orange pools under each street lamp. Footprints stay dark (the 3D
 *  buildings stand on them). */
function drawStreetGround(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, ppc: number) {
  const x1 = x0 + w, y1 = y0 + h;
  const mpp = CELL_X / ppc; // metres per pixel
  const W = w * ppc, H = h * ppc;
  // 1. Ground: lawns where houses stand, concrete where the city is dense.
  for (let cy = y0; cy < y1; cy++)
    for (let cx = x0; cx < x1; cx++) {
      g.fillStyle = paved(cx + 0.5, cy + 0.5) ? '#232328' : '#17221a';
      g.fillRect((cx - x0) * ppc, (cy - y0) * ppc, ppc + 1, ppc + 1);
    }
  // Grain: grass tufts and stains, in 2 px blocks so it stays pixel art.
  for (let k = 0, nk = w * h * 90 * Math.max(1, (ppc / 80) ** 2); k < nk; k++) {
    const px = Math.floor(hash(k * 3 + x0) * W), py = Math.floor(hash(k * 5 + y0) * H);
    const pv = paved(x0 + px / ppc, y0 + py / ppc);
    const v = hash(k * 7 + x0 * 131 + y0 * 977);
    g.fillStyle = pv ? `rgb(${30 + v * 10},${30 + v * 10},${35 + v * 10})` : `rgb(${18 + v * 14},${30 + v * 16},${20 + v * 8})`;
    g.fillRect(px & ~1, py & ~1, 2, 2);
  }
  g.fillStyle = '#15281a';
  for (const k of query(det.parks, x0, y0, x1, y1)) if (!det.parks.meta[k]) (path(g, det.parks, k, x0, y0, ppc), g.fill());
  const water = query(det.water, x0, y0, x1, y1);
  g.fillStyle = '#0b1a33';
  for (const k of water) if (!det.water.meta[k]) (path(g, det.water, k, x0, y0, ppc), g.fill());
  g.fillStyle = '#17221a';
  for (const k of water) if (det.water.meta[k]) (path(g, det.water, k, x0, y0, ppc), g.fill());
  // 2. Streets, in layers so crossings join cleanly: sidewalk, boulevard grass, kerb, asphalt.
  const R = det.roads;
  // Bridges are built as decks, not painted on the ground (it would run down into the river).
  const roads = query(R, x0 - 0.3, y0 - 0.3, x1 + 0.3, y1 + 0.3).filter((k) => !det.bridgeRoads.has(k)).sort((a, b) => R.meta[a] - R.meta[b]);
  const freeway = (wm: number) => wm === 22 || wm === 18 || wm === 9; // motorways, trunks, ramps
  const boulevard = (k: number) => {
    const wm = R.meta[k];
    if (wm >= 15 || freeway(wm)) return false;
    const o = R.off[k], mid = o + ((R.off[k + 1] - o) >> 1);
    return !paved(R.xy[mid * 2], R.xy[mid * 2 + 1]);
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const stroke = (k: number, widthM: number, style: string) => {
    g.strokeStyle = style;
    g.lineWidth = Math.max(1, widthM / mpp);
    path(g, R, k, x0, y0, ppc);
    g.stroke();
  };
  for (const k of roads) {
    const wm = R.meta[k];
    if (freeway(wm)) stroke(k, wm + 3, '#1d1d22'); // gravel shoulder
    else stroke(k, wm + (boulevard(k) ? 9.8 : 7), '#3a3a40'); // sidewalk
  }
  for (const k of roads) if (boulevard(k)) stroke(k, R.meta[k] + 6.2, '#1b2a1d'); // grass strip
  for (const k of roads) if (!freeway(R.meta[k])) stroke(k, R.meta[k] + 0.9, '#55555c'); // kerb
  for (const k of roads) stroke(k, R.meta[k], R.meta[k] >= 15 ? '#2a2a31' : '#25252c');
  // Sidewalk joints every few metres (pale lines across), only on the sidewalk band.
  // 3. Lane paint.
  const dash = (k: number, off: number, on: number, gap: number, style: string, wid = 0.2) => {
    g.setLineDash(on ? [on / mpp, gap / mpp] : []);
    g.strokeStyle = style;
    g.lineWidth = Math.max(1, wid / mpp);
    const o = R.off[k], n = R.off[k + 1] - o;
    g.beginPath();
    for (let j = 0; j < n; j++) {
      // Offset sideways by `off` metres (perpendicular of the local direction).
      const a = Math.max(0, j - 1), b = Math.min(n - 1, j + 1);
      const dx = (R.xy[(o + b) * 2] - R.xy[(o + a) * 2]) * CELL_X, dy = (R.xy[(o + b) * 2 + 1] - R.xy[(o + a) * 2 + 1]) * CELL_Y;
      const l = Math.hypot(dx, dy) || 1;
      const px = (R.xy[(o + j) * 2] - x0) * ppc + ((-dy / l) * off) / mpp, py = (R.xy[(o + j) * 2 + 1] - y0) * ppc + ((dx / l) * off) / mpp;
      g.lineTo(px, py);
    }
    g.stroke();
  };
  for (const k of roads) {
    const wm = R.meta[k];
    if (wm === 22 || wm === 18) {
      // Freeway: white lane dashes and solid edge lines.
      dash(k, wm / 2 - 1, 0, 0, 'rgba(200,200,190,0.45)');
      dash(k, -wm / 2 + 1, 0, 0, 'rgba(200,200,190,0.45)');
      dash(k, wm / 4, 3, 9, 'rgba(200,200,190,0.4)');
      dash(k, -wm / 4, 3, 9, 'rgba(200,200,190,0.4)');
    } else if (wm >= 15) {
      // Double yellow down the middle.
      dash(k, 0.25, 0, 0, 'rgba(210,170,60,0.55)', 0.15);
      dash(k, -0.25, 0, 0, 'rgba(210,170,60,0.55)', 0.15);
    } else if (wm >= 11) dash(k, 0, 3, 6, 'rgba(210,170,60,0.45)');
  }
  g.setLineDash([]);
  // 4. Crosswalks: zebra stripes across each street at junctions of bigger streets.
  const net = roadNet();
  const nodes = new Set<number>();
  for (const k of roads) {
    const o = R.off[k], n = R.off[k + 1] - o;
    for (let j = 0; j < n; j++) {
      const x = R.xy[(o + j) * 2], y = R.xy[(o + j) * 2 + 1];
      if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
      const hit = nearestRoad(net, x, y, 0.02);
      if (hit) nodes.add(hit.along < 0.5 ? net.ea[hit.edge] : net.elen[hit.edge] - hit.along < 0.5 ? net.eb[hit.edge] : -1);
    }
  }
  g.fillStyle = 'rgba(205,205,195,0.5)';
  for (const nd of nodes) {
    if (nd < 0) continue;
    const es = net.adj[nd];
    if (es.length < 3) continue;
    let big = 0, maxW = 0;
    for (const e of es) (big = Math.max(big, net.ewid[e])), (maxW = Math.max(maxW, net.ewid[e]));
    if (big < 11 || maxW >= 18) continue;
    const nx = net.nodeX[nd], ny = net.nodeY[nd];
    for (const e of es) {
      const fromStart = net.ea[e] === nd;
      const L = net.elen[e];
      const at = Math.min(L * 0.45, maxW / 2 + 2.5);
      const p = pointAt(net, e, fromStart ? at : L - at);
      const dx = (p.x - nx) * CELL_X, dy = (p.y - ny) * CELL_Y, l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l; // along the street, away from the junction
      const half = net.ewid[e] / 2;
      g.save();
      g.translate((p.x - x0) * ppc, (p.y - y0) * ppc);
      g.rotate(Math.atan2(uy, ux));
      for (let s2 = -half + 0.4; s2 < half - 0.4; s2 += 1.2) g.fillRect(-1.5 / mpp, s2 / mpp, 3 / mpp, Math.max(1, 0.6 / mpp));
      g.restore();
    }
  }
  // 5. Fallen leaves on grass and sidewalks (16 October): orange, gold and brown specks.
  const LEAF = ['#7a3a14', '#8a6418', '#5a2a14', '#6e4a1a'];
  for (let k = 0; k < w * h * 160; k++) {
    const px = Math.floor(hash(k * 11 + x0 * 7) * W), py = Math.floor(hash(k * 13 + y0 * 3) * H);
    const cx = x0 + px / ppc, cy = y0 + py / ppc;
    if (paved(cx, cy)) continue;
    // Drifts: thicker in some patches.
    if (hash(k * 17) > 0.35 + 0.5 * Math.sin(cx * 9.1) * Math.sin(cy * 7.7)) continue;
    g.fillStyle = LEAF[Math.floor(hash(k * 19) * LEAF.length)];
    g.fillRect(px, py, 1, 1);
  }
  // 6. Street lights: an orange pool under each lamp, a little out over the road.
  g.globalCompositeOperation = 'lighter';
  const rad = 15 / mpp;
  for (const l of lampSpots(x0 - 0.3, y0 - 0.3, x1 + 0.3, y1 + 0.3)) {
    const px = (l.x - x0) * ppc + (Math.cos(l.arm) * 2) / mpp, py = (l.y - y0) * ppc + (Math.sin(l.arm) * 2) / mpp;
    const gr = g.createRadialGradient(px, py, 0, px, py, rad);
    gr.addColorStop(0, 'rgba(150,88,28,0.55)');
    gr.addColorStop(0.5, 'rgba(110,62,20,0.22)');
    gr.addColorStop(1, 'rgba(110,62,20,0)');
    g.fillStyle = gr;
    g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  g.globalCompositeOperation = 'source-over';
  // 7. Building footprints: dark (the 3D building stands on top).
  const b = det.buildings;
  g.fillStyle = '#0e0f13';
  for (const k of query(b, x0, y0, x1, y1)) (path(g, b, k, x0, y0, ppc), g.fill());
}
