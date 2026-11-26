// One night over Minneapolis, without any drawing: the city numbers, fires, radio,
// the street zone near the camera, and the orbit clock. The 3D engine reads this.
// Story mode: the player never starts an outbreak. It arrives by script (an organ
// transfer brought a bitten patient into HCMC this afternoon); sandbox is a dev tool.
import mapFile from '../data/minneapolis.json';
import detailFile from '../data/detail.json';
import { outside } from '../sim/street';
import { inWindow, localTime, nightOver, passIndex, PASSES, rateAt, realSeconds, untilWindow, fmt } from './clock';
import { createRadio, Group, nextLine, patch, Radio, stepRadio, tuned, warn, DIAL } from './radio';
import { DetailFile, Detail, loadDetail, TILE } from '../map/detail';
import { CityMap, loadMap, MapFile } from '../map/loadMap';
import { cleanPlaces, NamedPlace } from '../map/places';
import { createFires, Fires, stepFires } from '../sim/fire';
import { cloneWorld, count, DEFAULT_RULES, Env, step, World } from '../sim/outbreak';
import { buildRoadNet, markCovered, RoadNet } from '../sim/roadnet';
import { enterStreet, equip, Kind, leaveStreet, newAgent, stepStreet, Street } from '../sim/street';
import type { Sound } from '../audio';
import { eventsBetween, WorldEvent } from './world';
import { agreeChance, bond, cellOf, cellsIn, createHeroStates, escapeChance, EXITS, heroById, HeroState, HEROES, leaveChance, pathPoint, routeCells, setRouter } from './heroes';
import { nearestRoad, pointAt, roadRoute } from '../sim/roadnet';
import { createRumours, rumourById, rumourEffect, RumourState } from './rumours';
import { Building, createBuilding, learnFloors, stepBuilding } from '../sim/building';
import { rng } from '../sim/outbreak';
import { createResponders, crewTotal, moveUnits, Responders, stepResponders, Unit } from './responders';
import { Agent, AXE, M as CELL_M, pickGun, Role } from '../sim/street';

export const TICK = 60; // game seconds per city-wide step (docs/tuning.md)
export const MAX_AGENTS = 2500;
/** Metres per map cell, east-west and north-south (the grid is not quite square). */
export const CELL_X = 78.7;
export const CELL_Y = 81.3;

export type Mode = 'title' | 'play' | 'sandbox' | 'end';
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Smoke {
  x: number;
  y: number;
  alt: number;
  age: number;
  life: number;
}

export const places: NamedPlace[] = cleanPlaces((detailFile as unknown as DetailFile).places);
export const city: CityMap = loadMap(mapFile as unknown as MapFile, places);
export const det: Detail = loadDetail(detailFile as unknown as DetailFile);
export const GW = city.width;
export const GH = city.height;
const policeCells = new Set(places.filter((p) => p.kind === 'police').map((p) => Math.floor(p.y) * GW + Math.floor(p.x)));
const fireStations = places.filter((p) => p.kind === 'fire').map((p) => Math.floor(p.y) * GW + Math.floor(p.x));

// Where buildings stand. A 10 m grid says free, solid, or "a wall runs through here";
// those edge squares are split into 1.25 m squares on first use, tested against the real
// building outline. So people walk right up to walls and round corners, never through.
/** Street step length (game seconds). */
const STREET_DT = 1 / 15;
const OCC = 8;
const SUB = 16; // 16 x 16 small squares per edge square (0.6 m: nobody stands more than half a metre into a wall)
const occ = (() => {
  const W = GW * OCC, H = GH * OCC;
  const out = new Uint8Array(W * H);
  const s = det.buildings;
  // Scanline fill of every building outline (no canvas needed, so tests can use it too).
  const xs: number[] = [];
  for (let k = 0; k < s.count; k++) {
    if (s.meta[k] < 4) continue; // sheds and garages do not block
    const o = s.off[k];
    const n = s.off[k + 1] - o;
    const y0 = Math.max(0, Math.floor(s.box[k * 4 + 1] * OCC));
    const y1 = Math.min(H - 1, Math.ceil(s.box[k * 4 + 3] * OCC));
    for (let Y = y0; Y <= y1; Y++) {
      const py = (Y + 0.5) / OCC;
      xs.length = 0;
      for (let j = 0; j < n; j++) {
        const ax = s.xy[(o + j) * 2], ay = s.xy[(o + j) * 2 + 1];
        const jn = (j + 1) % n;
        const bx = s.xy[(o + jn) * 2], by = s.xy[(o + jn) * 2 + 1];
        if (ay > py !== by > py) xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const X0 = Math.max(0, Math.ceil(xs[q] * OCC - 0.5));
        const X1 = Math.min(W - 1, Math.floor(xs[q + 1] * OCC - 0.5));
        for (let X = X0; X <= X1; X++) out[Y * W + X] = 1;
      }
    }
    // Every square a wall passes through: 2 (decided in detail when asked).
    for (let j = 0; j < n; j++) {
      const jn = (j + 1) % n;
      const ax = s.xy[(o + j) * 2] * OCC, ay = s.xy[(o + j) * 2 + 1] * OCC;
      const bx = s.xy[(o + jn) * 2] * OCC, by = s.xy[(o + jn) * 2 + 1] * OCC;
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 3) + 1;
      for (let t = 0; t <= steps; t++) {
        const X = Math.floor(ax + ((bx - ax) * t) / steps), Y = Math.floor(ay + ((by - ay) * t) / steps);
        if (X >= 0 && Y >= 0 && X < W && Y < H) out[Y * W + X] = 2;
      }
    }
  }
  return out;
})();
/** Exactly inside a building outline (sheds and garages excluded)? */
export function insideBuilding(x: number, y: number): boolean {
  const s = det.buildings;
  const T = TILE;
  const list = s.tiles.get(Math.floor(y / T) * 1000 + Math.floor(x / T));
  if (!list) return false;
  for (const k of list) {
    if (s.meta[k] < 4) continue;
    if (x < s.box[k * 4] || x > s.box[k * 4 + 2] || y < s.box[k * 4 + 1] || y > s.box[k * 4 + 3]) continue;
    const o = s.off[k], n = s.off[k + 1] - o;
    let inside = false;
    for (let j = 0, i = n - 1; j < n; i = j++) {
      const xi = s.xy[(o + i) * 2], yi = s.xy[(o + i) * 2 + 1], xj = s.xy[(o + j) * 2], yj = s.xy[(o + j) * 2 + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
/** Solid things the renderer places by rule (parked cars). Set by the city layer; the
 *  street simulation treats them like walls. */
let solidProps: (x: number, y: number) => boolean = () => false;
export const setSolidProps = (f: (x: number, y: number) => boolean) => void (solidProps = f);
const fine = new Map<number, Uint8Array>();
export const blocked = (x: number, y: number) => {
  const X = Math.floor(x * OCC), Y = Math.floor(y * OCC);
  if (X < 0 || Y < 0 || X >= GW * OCC || Y >= GH * OCC) return false;
  const i = Y * GW * OCC + X;
  const v = occ[i];
  if (v !== 2) return v === 1;
  let f = fine.get(i);
  if (!f) {
    // Only the outlines that touch this square, then 64 point tests against them.
    f = new Uint8Array(SUB * SUB);
    const sh = det.buildings;
    const x0 = X / OCC, y0 = Y / OCC, x1 = (X + 1) / OCC, y1 = (Y + 1) / OCC;
    const list = sh.tiles.get(Math.floor(y0 / TILE) * 1000 + Math.floor(x0 / TILE)) ?? [];
    const near: number[] = [];
    for (const k of list) if (sh.meta[k] >= 4 && sh.box[k * 4] <= x1 && sh.box[k * 4 + 2] >= x0 && sh.box[k * 4 + 1] <= y1 && sh.box[k * 4 + 3] >= y0) near.push(k);
    for (let b = 0; b < SUB; b++)
      for (let a = 0; a < SUB; a++) {
        const px = (X + (a + 0.5) / SUB) / OCC, py = (Y + (b + 0.5) / SUB) / OCC;
        for (const k of near) {
          const o = sh.off[k], n = sh.off[k + 1] - o;
          let inside = false;
          for (let j = 0, q = n - 1; j < n; q = j++) {
            const xi = sh.xy[(o + q) * 2], yi = sh.xy[(o + q) * 2 + 1], xj = sh.xy[(o + j) * 2], yj = sh.xy[(o + j) * 2 + 1];
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) {
            f[b * SUB + a] = 1;
            break;
          }
        }
      }
    fine.set(i, f);
  }
  const a = Math.min(SUB - 1, Math.floor((x * OCC - X) * SUB)), b = Math.min(SUB - 1, Math.floor((y * OCC - Y) * SUB));
  return f[b * SUB + a] === 1;
};
function freeSpot(x: number, y: number): [number, number] {
  let px = x + Math.random(), py = y + Math.random();
  for (let k = 0; k < 10 && (blocked(px, py) || wet(px, py)); k++) (px = x + Math.random()), (py = y + Math.random());
  if (blocked(px, py)) [px, py] = outside(px, py, blocked);
  return [px, py];
}
const cellAt = (x: number, y: number) => Math.floor(y) * GW + Math.floor(x);

// Where the roads are, on the same 10 m grid (built on first use): routes prefer them.
let roadGrid: Uint8Array | null = null;
function roads(): Uint8Array {
  if (roadGrid) return roadGrid;
  const W = GW * OCC, H = GH * OCC;
  const g = new Uint8Array(W * H);
  const r = det.roads;
  for (let k = 0; k < r.count; k++) {
    const half = Math.max(0.6, r.meta[k] / 2 / 10); // half the road width, in 10 m squares
    const o = r.off[k], n = r.off[k + 1] - o;
    for (let j = 0; j + 1 < n; j++) {
      const ax = r.xy[(o + j) * 2] * OCC, ay = r.xy[(o + j) * 2 + 1] * OCC;
      const bx = r.xy[(o + j + 1) * 2] * OCC, by = r.xy[(o + j + 1) * 2 + 1] * OCC;
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
      for (let s2 = 0; s2 <= steps; s2++) {
        const x = ax + ((bx - ax) * s2) / steps, y = ay + ((by - ay) * s2) / steps;
        const h = Math.ceil(half);
        for (let dy = -h; dy <= h; dy++)
          for (let dx = -h; dx <= h; dx++) {
            const X = Math.floor(x + dx), Y = Math.floor(y + dy);
            if (X >= 0 && Y >= 0 && X < W && Y < H) g[Y * W + X] = 1;
          }
      }
    }
  }
  return (roadGrid = g);
}
// Where the water is, on the same 10 m grid (built on first use). Bridges are not water:
// the road squares are taken back out. Even-odd fill, so islands stay dry.
let wetGrid: Uint8Array | null = null;
function wetSquares(): Uint8Array {
  if (wetGrid) return wetGrid;
  const W = GW * OCC, H = GH * OCC;
  const out = new Uint8Array(W * H);
  const s = det.water;
  const xs: number[] = [];
  for (let k = 0; k < s.count; k++) {
    const o = s.off[k];
    const n = s.off[k + 1] - o;
    const y0 = Math.max(0, Math.floor(s.box[k * 4 + 1] * OCC));
    const y1 = Math.min(H - 1, Math.ceil(s.box[k * 4 + 3] * OCC));
    for (let Y = y0; Y <= y1; Y++) {
      const py = (Y + 0.5) / OCC;
      xs.length = 0;
      for (let j = 0, i = n - 1; j < n; i = j++) {
        const ax = s.xy[(o + i) * 2], ay = s.xy[(o + i) * 2 + 1];
        const bx = s.xy[(o + j) * 2], by = s.xy[(o + j) * 2 + 1];
        if (ay > py !== by > py) xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const X0 = Math.max(0, Math.ceil(xs[q] * OCC - 0.5));
        const X1 = Math.min(W - 1, Math.floor(xs[q + 1] * OCC - 0.5));
        for (let X = X0; X <= X1; X++) out[Y * W + X] ^= 1;
      }
    }
  }
  const rg = roads();
  for (let i = 0; i < out.length; i++) if (rg[i]) out[i] = 0;
  return (wetGrid = out);
}
/** Is this water (river, lake), where nobody walks? Bridges are dry. */
export const wet = (x: number, y: number) => {
  const X = Math.floor(x * OCC), Y = Math.floor(y * OCC);
  return X >= 0 && Y >= 0 && X < GW * OCC && Y < GH * OCC && wetSquares()[Y * GW * OCC + X] === 1;
};
/** The road network cars drive on (built on first use, about 0.4 s). */
let net: RoadNet | null = null;
export const roadNet = () => (net ??= markCovered(buildRoadNet(det.roads), blocked));
/** Can a car drive here? (On the road grid, about 10 m squares.) */
export const onRoad = (x: number, y: number) => {
  const X = Math.floor(x * OCC), Y = Math.floor(y * OCC);
  return X >= 0 && Y >= 0 && X < GW * OCC && Y < GH * OCC && roads()[Y * GW * OCC + X] === 1;
};
/** A street route between two points (map cells): A* over the 10 m building grid, keeping
 *  away from walls, then straightened where there is a clear line. Vehicles never cut
 *  through buildings (see heroes.test.ts). */
export function streetPath(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const W = GW * OCC, H = GH * OCC;
  const pad = 6 * OCC;
  const X0 = Math.max(0, Math.floor(Math.min(a.x, b.x) * OCC) - pad), Y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) * OCC) - pad);
  const X1 = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x) * OCC) + pad), Y1 = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y) * OCC) + pad);
  const bw = X1 - X0 + 1, bh = Y1 - Y0 + 1;
  const wall = (X: number, Y: number) => occ[Y * W + X] === 1 || (occ[Y * W + X] === 2 && blocked((X + 0.5) / OCC, (Y + 0.5) / OCC));
  const rg = roads();
  // Cost of standing on a square: walls are impossible, squares next to walls cost more.
  const cost = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const X = x + X0, Y = y + Y0;
      if (wall(X, Y)) {
        cost[y * bw + x] = -1;
        continue;
      }
      let near = 0;
      for (let d = 1; d <= 2; d++)
        if (wall(Math.max(0, X - d), Y) || wall(Math.min(W - 1, X + d), Y) || wall(X, Math.max(0, Y - d)) || wall(X, Math.min(H - 1, Y + d))) near = Math.max(near, 3 - d);
      cost[y * bw + x] = (rg[Y * W + X] ? 1 : 4) + near * 2;
    }
  // The street network is the biggest connected open area in the box; courtyards and
  // backyards closed in by buildings are not roads. Snap both ends onto the network.
  const comp = new Int32Array(bw * bh).fill(-1);
  let best = -1, bestSize = 0;
  for (let i0 = 0, c = 0; i0 < bw * bh; i0++) {
    if (cost[i0] < 0 || comp[i0] >= 0) continue;
    const stack = [i0];
    comp[i0] = c;
    let size = 0;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % bw, y = (i / bw) | 0;
      if (x > 0 && cost[i - 1] >= 0 && comp[i - 1] < 0) (comp[i - 1] = c), stack.push(i - 1);
      if (x < bw - 1 && cost[i + 1] >= 0 && comp[i + 1] < 0) (comp[i + 1] = c), stack.push(i + 1);
      if (y > 0 && cost[i - bw] >= 0 && comp[i - bw] < 0) (comp[i - bw] = c), stack.push(i - bw);
      if (y < bh - 1 && cost[i + bw] >= 0 && comp[i + bw] < 0) (comp[i + bw] = c), stack.push(i + bw);
    }
    if (size > bestSize) (bestSize = size), (best = c);
    c++;
  }
  const free = (cx: number, cy: number) => {
    // Nearest square of the street network to a point.
    const bx = Math.floor(cx * OCC) - X0, by = Math.floor(cy * OCC) - Y0;
    for (let r = 0; r < 60; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = bx + dx, y = by + dy;
          if (x >= 0 && y >= 0 && x < bw && y < bh && comp[y * bw + x] === best && rg[(y + Y0) * W + x + X0]) return y * bw + x;
        }
    return Math.max(0, Math.min(bw * bh - 1, by * bw + bx));
  };
  const s0 = free(a.x, a.y), s1 = free(b.x, b.y);
  const g = new Float64Array(bw * bh).fill(Infinity);
  const done = new Uint8Array(bw * bh);
  const from = new Int32Array(bw * bh).fill(-1);
  const heap: number[] = [], prio: number[] = [];
  const push = (i: number, p: number) => {
    heap.push(i);
    prio.push(p);
    let k = heap.length - 1;
    while (k > 0) {
      const u = (k - 1) >> 1;
      if (prio[u] <= prio[k]) break;
      [heap[u], heap[k]] = [heap[k], heap[u]];
      [prio[u], prio[k]] = [prio[k], prio[u]];
      k = u;
    }
  };
  const pop = () => {
    const top = heap[0];
    const li = heap.pop()!, lp = prio.pop()!;
    if (heap.length) {
      heap[0] = li;
      prio[0] = lp;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && prio[l] < prio[m]) m = l;
        if (r < heap.length && prio[r] < prio[m]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        [prio[m], prio[k]] = [prio[k], prio[m]];
        k = m;
      }
    }
    return top;
  };
  const tx = s1 % bw, ty = Math.floor(s1 / bw);
  const hgt = (i: number) => Math.hypot((i % bw) - tx, Math.floor(i / bw) - ty);
  g[s0] = 0;
  push(s0, hgt(s0));
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === s1) break;
    const x = i % bw, y = Math.floor(i / bw);
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const j = ny * bw + nx;
      if (cost[j] < 0) continue;
      if (dx && dy && (cost[y * bw + nx] < 0 || cost[ny * bw + x] < 0)) continue; // no squeezing past corners
      const ng = g[i] + cost[j] * (dx && dy ? 1.414 : 1);
      if (ng < g[j]) {
        g[j] = ng;
        from[j] = i;
        push(j, ng + hgt(j));
      }
    }
  }
  if (from[s1] < 0 && s1 !== s0) return [a, b]; // no way through: keep the straight line
  const raw: number[] = [];
  for (let i = s1; i >= 0 && raw.length < 100000; i = from[i]) raw.push(i);
  raw.reverse();
  const pt = (i: number) => ({ x: ((i % bw) + X0 + 0.5) / OCC, y: (Math.floor(i / bw) + Y0 + 0.5) / OCC });
  // Straighten: keep a point only when the straight line past it would touch a wall.
  const clear = (p: { x: number; y: number }, q: { x: number; y: number }) => {
    const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) * OCC * 2);
    for (let k = 0; k <= n; k++) {
      const x = p.x + ((q.x - p.x) * k) / n, y = p.y + ((q.y - p.y) * k) / n;
      const X = Math.floor(x * OCC) - X0, Y = Math.floor(y * OCC) - Y0;
      if (X < 0 || Y < 0 || X >= bw || Y >= bh || cost[Y * bw + X] < 0 || cost[Y * bw + X] > 3) return false;
    }
    return true;
  };
  const out = [pt(raw[0])];
  let k = 0;
  while (k < raw.length - 1) {
    let j = k + 1;
    while (j + 1 < raw.length && clear(pt(raw[k]), pt(raw[j + 1]))) j++;
    out.push(pt(raw[j]));
    k = j;
  }
  return out;
}
setRouter((pts) => {
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const leg = streetPath(pts[i - 1], pts[i]);
    out.push(...(i === 1 ? leg : leg.slice(1)));
  }
  return out;
});

/** Path length (cells) from the start to point k. */
function pathLengthTo(p: { x: number; y: number }[], k: number): number {
  let n = 0;
  for (let i = 1; i <= k; i++) n += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return n;
}

export class Session {
  /** Average time of one street step (ms), for the speed meter and the test bot. */
  stepMs = 0;
  streetAcc = 0;
  /** How far between the last two street steps the picture is (0..1). */
  streetAlpha = 1;
  mode: Mode = 'title';
  world!: World;
  fires!: Fires;
  radio!: Radio;
  street: Street | null = null;
  t = 0; // game seconds since 19:40
  acc = 0;
  tick = 0;
  paused = false;
  sandboxRate = 6;
  startPop = 1;
  lossLog: string[] = [];
  smoke: Smoke[] = [];
  lastPhoto: Uint8Array | null = null;
  wasWindow = false;
  nextTalk = 0;
  /** World news waiting to be heard, and the ones already heard (newest last). */
  heroes: HeroState[] = createHeroStates();
  /** Squad cars, fire engines, ambulances (responders.ts). */
  resp: Responders = { units: [], calls: [], radio: [] };
  /** Tests can fix the dice for close calls (0 = always escape, 1 = never). */
  luck: (() => number) | null = null;
  /** You saw one of the dead get back up after a body shot: proof that only the head counts. */
  proof = false;
  private seenGetUps = 0;
  private proofStreet: Street | null = null;
  /** Your "aim for the head" broadcast: when, and whether you had proof. */
  headcast: { tick: number; proof: boolean } | null = null;
  rumours: RumourState[] = createRumours();
  /** Inside the buildings where a hero is (the dollhouse view). */
  buildings = new Map<string, Building>();
  newsQueue: WorldEvent[] = [];
  news: WorldEvent[] = [];
  nextNews = 0;
  /** Subtitles and notices go out through this (the HUD shows them). */
  say: (who: string, text: string, secs?: number) => void = () => {};
  /** Called once when the window closes / opens. */
  onWindow: (open: boolean) => void = () => {};

  constructor(public sound: Sound) {
    this.reset('play');
    this.mode = 'title';
  }

  reset(m: Mode) {
    this.mode = m;
    this.world = cloneWorld(city.world);
    this.fires = createFires(city.buildings);
    this.radio = createRadio();
    this.street = null;
    this.t = this.acc = this.tick = 0;
    this.smoke = [];
    this.lastPhoto = null;
    this.lossLog = [];
    this.newsQueue = [];
    this.news = [];
    this.heroes = createHeroStates();
    this.rumours = createRumours();
    this.buildings = new Map();
    if (m === 'play') {
      // Rosa: HCMC, fifth floor, east stairwell (her third floor is gone). Mai: Pioneer Hall,
      // third floor. Floor counts are guesses (OSM has no heights here); check real plans.
      this.buildings.set('rosa', createBuilding('rosa', 'HCMC, the Red Building', 8, 140, 4, 3));
      this.buildings.set('dorms', createBuilding('dorms', 'Pioneer Hall', 5, 160, 2, 5));
      // Gloria: the community centre kitchen, ground floor; two floors (a guess, placeholder building).
      this.buildings.set('gloria', createBuilding('gloria', 'Rondo community centre', 2, 70, 0, 7));
    }
    this.proof = false;
    this.seenGetUps = 0;
    this.headcast = null;
    this.resp = createResponders(places, this.world);
    this.startPop = count(this.world.healthy) + crewTotal(this.resp);
    const world = this.world;
    if (m === 'play') {
      // Scripted, not the player: patient zero came in on an organ transfer to HCMC this
      // afternoon; a second patient was moved to Fairview Riverside.
      this.seed(96.8, 121.8, 40);
      this.seed(122.2, 126.5, 12);
      // Contacts live where people are: the busiest block within ~250 m; staff and
      // patients into the hospital (homes-only population misses them).
      for (const g of this.radio.groups) {
        if (g.kind === 'broadcast' || g.kind === 'police') continue;
        if (g.id === 'rosa') {
          world.healthy[cellAt(g.x, g.y)] += 60;
          continue;
        }
        let best = cellAt(g.x, g.y);
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const i = cellAt(g.x + dx, g.y + dy);
            if (world.land[i] && world.healthy[i] > world.healthy[best]) best = i;
          }
        g.x = (best % GW) + 0.5;
        g.y = Math.floor(best / GW) + 0.5;
      }
      for (const g of this.radio.groups)
        if (g.kind === 'star' || g.kind === 'bus')
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const i = (Math.floor(g.y) + dy) * GW + Math.floor(g.x) + dx;
              world.guard[i] = 1;
              world.armed[i] += 2;
              world.ammo[i] += 100;
            }
    }
    this.wasWindow = inWindow(this.t);
  }

  seed(x: number, y: number, n: number) {
    const i = cellAt(x, y);
    if (this.world.land[i]) this.world.infected[i] += n;
  }

  radioUp(): boolean {
    return this.mode === 'sandbox' || inWindow(this.t);
  }
  canLook(): boolean {
    return this.mode === 'sandbox' || (this.mode === 'play' && inWindow(this.t));
  }

  tune(df: number) {
    this.radio.freq = Math.round(Math.max(DIAL.min, Math.min(DIAL.max, this.radio.freq + df)) * 100) / 100;
    this.nextTalk = 0;
    this.sound.hush();
  }
  setFreq(f: number) {
    this.radio.freq = f;
    this.nextTalk = 0;
    this.sound.hush();
  }

  private syncStreetFirst() {
    if (this.street) {
      this.pullCrews(true);
      leaveStreet(this.street, this.world);
      this.street = null;
    }
  }
  doWarn() {
    const { group, signal } = tuned(this.radio);
    if (!this.radioUp()) return this.say('', 'No line of sight. The radio only reaches Minneapolis during a pass.', 3);
    if (!group || signal < 0.75) return this.say('', 'Tune to someone first (arrow keys, or the wheel over the radio).', 3);
    this.syncStreetFirst();
    const refusedBefore = this.radio.stats.refused;
    let reply = warn(this.radio, this.world, group, this.tick, this.tick * 31 + 7);
    const hs = this.heroState(group.id);
    const hero = heroById(group.id);
    if (hs && hero && this.radio.stats.refused > refusedBefore) {
      // They decide. Not trusting a voice from space yet, they have their reasons.
      const why = hero.refuse[hs.refusals++ % hero.refuse.length];
      reply = why;
      hs.log.push({ t: this.t, text: `${localTime(this.t)} You warned them. They would not go. "${why.replace(/^[^:]+: /, '')}"` });
      group.trust = Math.min(1, group.trust + 0.05); // being right later starts here
    }
    this.talk(group, reply);
    if (hs && group.warnedAt === this.tick) {
      hs.helpedAt = this.tick;
      hs.log.push({ t: this.t, text: `${localTime(this.t)} You warned them. They listened.` });
    }
  }
  doPatch() {
    const { group, signal } = tuned(this.radio);
    if (!this.radioUp()) return this.say('', 'No line of sight. The radio only reaches Minneapolis during a pass.', 3);
    if (!group || signal < 0.75) return this.say('', 'Tune to someone first.', 3);
    if (!this.radio.patchFrom) {
      this.radio.patchFrom = group;
      return this.say('', `Patch: holding ${group.name}. Tune to a second channel and press P again.`, 5);
    }
    const from = this.radio.patchFrom;
    if (from !== group && this.heroState(from.id) && this.heroState(group.id)) {
      this.radio.patchFrom = null;
      this.linkSpeaker = group.id;
      const reply = this.linkHeroes(from.id, group.id);
      return this.talk(this.radio.groups.find((g) => g.id === this.linkSpeaker) ?? group, reply);
    }
    this.syncStreetFirst();
    const convoys = this.radio.convoys.length;
    const reply = patch(this.radio, this.world, from, group, this.tick * 17 + 3);
    if (this.radio.convoys.length > convoys)
      for (const g of [from, group]) {
        const hs = this.heroState(g.id);
        if (hs) {
          hs.helpedAt = this.tick;
          hs.log.push({ t: this.t, text: `${localTime(this.t)} You patched ${from.name} and ${group.name} together. Help is coming.` });
        }
      }
    this.radio.patchFrom = null;
    this.talk(group, reply);
  }
  /** SPEAK to everyone: "aim for the head". Spreads over the next hour or so. Without proof
   *  (seeing one get back up yourself) most people do not believe it, and it costs trust. */
  doHeadcast() {
    if (!this.radioUp()) return this.say('', 'No line of sight. The radio only reaches Minneapolis during a pass.', 3);
    if (this.headcast && (this.headcast.proof || !this.proof)) return this.say('', 'You already told them. It is spreading, block by block.', 4);
    this.headcast = { tick: this.tick, proof: this.proof };
    for (const g of this.radio.groups) {
      if (g.kind === 'broadcast') continue;
      g.trust = Math.max(0, Math.min(1, g.trust + (this.proof ? 0.05 : -0.1)));
      const hs = this.heroState(g.id);
      if (hs) hs.log.push({ t: this.t, text: `${localTime(this.t)} You told the whole city to aim for the head${this.proof ? ', and you had seen why' : ', without proof'}.` });
    }
    const s = this.street;
    if (s) for (const a of s.agents) if (a.kind === Kind.Living && Math.random() < (this.proof ? 0.6 : 0.25)) a.know = 1;
    this.say(
      'You, on every channel',
      this.proof
        ? 'Listen. I watched one take a bullet in the chest and get back up. Only the head stops them. Aim for the head.'
        : 'Aim for the head. Only the head stops them. ...Most of them have no reason to believe you yet. Find proof.',
      7,
    );
  }

  /** SPEAK: knock down the latest rumour. Works only if you have looked at the place yourself. */
  doDebunk() {
    if (!this.radioUp()) return this.say('', 'No line of sight. The radio only reaches Minneapolis during a pass.', 3);
    const st = [...this.rumours].reverse().find((r) => r.active && !r.debunked);
    if (!st) return this.say('', 'No rumour going round right now.', 3);
    const r = rumourById(st.id);
    if (!st.seen) {
      for (const g of this.radio.groups) if (g.kind !== 'broadcast') g.trust = Math.max(0, g.trust - 0.08);
      return this.say('', `They ask how you know. You have not looked at ${r.place} yet. Look first, then speak. (Trust lost.)`, 6);
    }
    st.debunked = true;
    for (const g of this.radio.groups) if (g.kind !== 'broadcast') g.trust = Math.min(1, g.trust + 0.05);
    this.say('You, on every channel', r.truth, 7);
  }

  talk(g: Group, text: string) {
    // The subtitle already names who is speaking.
    for (const n of [g.who + ': ', g.who.split(' ')[0] + ': ', (heroById(g.id)?.name.split(' ')[0] ?? '-') + ': ']) if (text.startsWith(n)) text = text.slice(n.length);
    this.say(g.who, text, 4 + text.length / 16);
    this.sound.say(text, g.pitch, g.rate);
    this.nextTalk = performance.now() + (4 + text.length / 16) * 1000 + 3000;
  }

  cityStep() {
    const world = this.world;
    const before = world.fallen.slice();
    this.world = step(world, DEFAULT_RULES, this.env(), this.tick * 2654435 + 11);
    const w = this.world;
    const fighting = new Float32Array(w.fallen.length);
    for (let i = 0; i < fighting.length; i++) fighting[i] = w.fallen[i] - before[i];
    stepFires(this.fires, w, fighting, fireStations, this.tick * 13 + 5);
    {
      const st = this.street;
      stepResponders(this.resp, w, this.fires, this.env().hour, this.tick * 977 + 3, (a, b) => roadRoute(roadNet(), a, b), (x, y) => !!st && x >= st.x0 && y >= st.y0 && x < st.x0 + st.w && y < st.y0 + st.h, (text) => this.dispatch(text));
    }
    const statusBefore = this.radio.groups.map((g) => g.status);
    // Help that was sent drives along the streets, not through the river.
    for (const c of this.radio.convoys) if (!c.path) (c.path = streetPath({ x: c.x, y: c.y }, { x: c.to.x, y: c.to.y })), (c.at = 0);
    this.radio.arrivals.length = this.radio.lostConvoys.length = 0;
    stepRadio(this.radio, w, this.tick);
    for (const c of this.radio.arrivals) {
      const hs = this.heroState(c.to.id);
      if (!hs || c.bus) continue;
      hs.helpedAt = this.tick;
      hs.log.push({ t: this.t, text: `${localTime(this.t)} ${Math.round(c.people)} officers from ${c.from.name} got through to them.` });
    }
    for (const c of this.radio.lostConvoys) {
      const hs = this.heroState(c.to.id);
      if (hs) hs.log.push({ t: this.t, text: `${localTime(this.t)} The officers sent from ${c.from.name} never made it. The dead stopped them on the way.` });
    }
    this.radio.groups.forEach((g, k) => {
      const hs = this.heroState(g.id);
      if (hs && (hs.out || hs.link || (hs.escapeStart >= 0 && !hs.arrived))) {
        // On the road: they are moving, not standing and fighting.
        g.status = 'calm';
        g.silent = false;
        return;
      }
      if (g.status === 'overrun' && statusBefore[k] !== 'overrun' && g.kind !== 'broadcast' && !g.fate) {
        if (hs && !hs.dead && this.closeCall(g, hs)) return;
        this.lossLog.push(`${localTime(this.t)} ${g.name} overrun`);
        g.fate = `lost around ${localTime(this.t)}`;
        if (hs) {
          hs.dead = true;
          hs.log.push({ t: this.t, text: `${localTime(this.t)} No contact. Last seen near their block.` });
        }
      }
    });
    this.moveHeroes();
    this.spreadHeadcast();
    this.stepInside();
    this.tick++;
    const s = this.street;
    if (s) {
      // People and the dead arriving from outside the zone become individuals there.
      for (let y = s.y0; y < s.y0 + s.h; y++)
        for (let x = s.x0; x < s.x0 + s.w; x++) {
          const i = y * GW + x;
          let k = Math.floor(w.infected[i] / s.scale + Math.random());
          while (k-- > 0) s.agents.push(newAgent(...freeSpot(x, y), Kind.Dead));
          const h = w.healthy[i];
          if (h > 0) {
            // Whoever arrives came by road, running: they are outside, and drawn.
            const ammoEach = w.armed[i] > 0 ? w.ammo[i] / w.armed[i] : 0;
            let n = Math.floor(h / s.scale + Math.random());
            while (n-- > 0) {
              const armed = Math.random() < w.armed[i] / h;
              const a = equip(newAgent(...freeSpot(x, y), Kind.Living, armed ? Math.max(1, Math.round(ammoEach)) : 0), Math.random, w.know[i]);
              a.fear = 1;
              s.agents.push(a);
            }
          }
          w.infected[i] = w.healthy[i] = w.armed[i] = w.ammo[i] = w.moving[i] = w.crawl[i] = 0;
        }
    }
  }

  /** Jump ahead one minute with nothing drawn (test bots, the dev jump). */
  skipMinute() {
    this.t += 60;
    this.cityStep();
    moveUnits(this.resp, 60);
  }

  /** Keep individuals simulated inside `box` (map cells), or none when null. */
  setZone(box: Box | null) {
    if (!box) {
      this.syncStreetFirst();
      return;
    }
    const s = this.street;
    const vw = box.x1 - box.x0, vh = box.y1 - box.y0;
    if (s && box.x0 >= s.x0 && box.y0 >= s.y0 && box.x1 <= s.x0 + s.w && box.y1 <= s.y0 + s.h && s.w * s.h <= (vw + 6) * (vh + 6) * 2.5)
      return;
    if (s) this.pullCrews(true), leaveStreet(s, this.world);
    const mx = Math.ceil(vw * 0.3) + 1, my = Math.ceil(vh * 0.3) + 1;
    const x0 = Math.max(0, Math.floor(box.x0) - mx), y0 = Math.max(0, Math.floor(box.y0) - my);
    const x1 = Math.min(GW, Math.ceil(box.x1) + mx), y1 = Math.min(GH, Math.ceil(box.y1) + my);
    this.street = enterStreet(this.world, x0, y0, x1 - x0, y1 - y0, MAX_AGENTS, this.tick + 1, policeCells, (x, y) => blocked(x, y) || wet(x, y) || solidProps(x, y), this.env());
    const w = this.world;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * GW + x;
        w.healthy[i] = w.infected[i] = w.armed[i] = w.ammo[i] = w.moving[i] = w.crawl[i] = 0;
      }
  }

  /** The hour, the dark and how far the news has spread, for the city maths. */
  env(): Env {
    const hour = 19 + 40 / 60 + this.t / 3600;
    // Local TV breaks in around 9 PM; phones and radio carry it from there (guess).
    const news = Math.max(0, Math.min(1, (this.t - 4800) / 7200));
    const r = rumourEffect(this.rumours);
    return { hour, dark: 0.8, news, leave: r.leave, strife: r.strife };
  }

  /** Inside the hero buildings: the dead come in from the street and climb. People turned
   *  inside join the dead on the block; what the hero tells you fills in the sketch. */
  private stepInside() {
    const w = this.world;
    for (const [id, b] of this.buildings) {
      const g = this.radio.groups.find((x) => x.id === id);
      const hs = this.heroState(id);
      if (!g) continue;
      if (g.known) learnFloors(b, g.said);
      if (hs && (hs.escapeStart >= 0 || hs.dead)) continue; // they are gone; the sketch stays as it was
      const i = Math.floor(g.y) * GW + Math.floor(g.x);
      let dead = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) dead += w.infected[i + dy * GW + dx] || 0;
      const before = b.turned;
      stepBuilding(b, dead, Math.max(w.aware[i], w.guard[i]), this.tick * 131 + 7);
      const turned = Math.min(w.healthy[i], b.turned - before);
      w.healthy[i] -= turned;
      w.infected[i] += turned;
    }
  }

  /** The broadcast spreads through radios, phones and word of mouth, one block at a time. */
  private spreadHeadcast() {
    const h = this.headcast;
    if (!h || this.tick - h.tick > 180) return;
    const target = h.proof ? 0.8 : 0.3;
    const k = h.proof ? 0.025 : 0.012;
    const w = this.world;
    for (let i = 0; i < w.know.length; i++) if (w.land[i] && w.know[i] < target) w.know[i] += (target - w.know[i]) * k;
  }

  /** Cars that drove out of the street area join the city numbers just outside it, still on the road. */
  private drainExits(s: Street) {
    if (!s.exits.length) return;
    const w = this.world;
    const cx = s.x0 + s.w / 2, cy = s.y0 + s.h / 2;
    for (const e of s.exits) {
      let x = Math.floor(e.x), y = Math.floor(e.y);
      const dx = e.x - cx, dy = e.y - cy;
      if (Math.abs(dx) * s.h > Math.abs(dy) * s.w) x = dx > 0 ? s.x0 + s.w : s.x0 - 1;
      else y = dy > 0 ? s.y0 + s.h : s.y0 - 1;
      x = Math.max(0, Math.min(GW - 1, x));
      y = Math.max(0, Math.min(GH - 1, y));
      const i = y * GW + x;
      w.healthy[i] += s.scale;
      w.moving[i] += s.scale;
      if (e.armed) (w.armed[i] += s.scale), (w.ammo[i] += e.ammo * s.scale);
    }
    s.exits.length = 0;
  }

  heroState(id: string): HeroState | undefined {
    return this.heroes.find((h) => h.id === id);
  }

  /** Plot armour: the dead reach a hero. If they have close calls left, the maths may turn it
   *  into a narrow escape: they run for it along their escape route, and it costs them something. */
  private closeCall(g: Group, hs: HeroState): boolean {
    const hero = heroById(hs.id)!;
    const w = this.world;
    const i = Math.floor(g.y) * GW + Math.floor(g.x);
    let dead = 0, living = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const j = i + dy * GW + dx;
        dead += w.infected[j] || 0;
        living += w.healthy[j] || 0;
      }
    const p = escapeChance({
      left: hs.left,
      helpedAgo: hs.helpedAt < 0 ? Infinity : this.tick - hs.helpedAt,
      vehicle: true,
      trust: g.trust,
      pressure: dead / Math.max(1, dead + living),
    });
    const roll = this.luck ? this.luck() : rng(this.tick * 7717 + HEROES.indexOf(hero) * 131 + 17)();
    if (p <= 0 || roll > p) return false;
    const n = hs.closeCallsUsed;
    hs.left--;
    hs.closeCallsUsed++;
    hs.pending = hero.after[Math.min(n, hero.after.length - 1)];
    hs.log.push({ t: this.t, text: `${localTime(this.t)} Close call. ${hero.costs[Math.min(n, hero.costs.length - 1)]}` });
    if (hs.id === 'walt' && n === 0) g.trust = Math.max(0, g.trust - 0.1); // weak handheld: harder to reach
    g.status = 'calm';
    g.silent = false;
    if (hs.escapeStart < 0) {
      // Off they go, with as many as the vehicle holds.
      hs.escapeStart = this.tick;
      hs.path = routeCells(hero);
      hs.pathAt = 0;
      hs.kmh = hero.escape.kmh;
      const ride = Math.min(hero.escape.seats, living);
      hs.riders = ride;
      for (let dy = -1; dy <= 1 && ride > 0; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * GW + dx;
          const take = Math.min(w.healthy[j] || 0, ride / 9);
          w.healthy[j] -= take;
        }
      hs.log.push({ t: this.t, text: `${localTime(this.t)} Left by ${hero.escape.label}, heading for ${hero.escape.to}.` });
    } else if (hs.arrived) {
      // Already out: the close call happens where they are, and they hold on.
      w.infected[i] *= 0.5;
    }
    return true;
  }

  /** Where a hero is now (cells), `extra` game seconds ahead if they are moving (smooth drawing). */
  heroWhere(id: string, extra = 0): { x: number; y: number; face: number; moving: boolean } {
    const hs = this.heroState(id)!;
    if (hs.path && !hs.dead) {
      const p = pathPoint(hs.path, hs.pathAt + cellsIn(extra, hs.kmh));
      return { x: p.x, y: p.y, face: p.face, moving: true };
    }
    return { x: hs.x, y: hs.y, face: hs.face, moving: false };
  }

  /** Where a way out of the city is, on the road (cells). */
  exitCell(id: string): { x: number; y: number } {
    const e = EXITS.find((x) => x.id === id)!;
    const c = cellOf(e.lat, e.lon);
    const h = nearestRoad(roadNet(), c.x, c.y, 4);
    if (!h) return c;
    const p = pointAt(roadNet(), h.edge, h.along);
    return { x: Math.min(GW - 0.6, Math.max(0.6, p.x)), y: Math.min(GH - 0.6, Math.max(0.6, p.y)) };
  }

  /** CONNECT two heroes: patched together on the radio, they decide whether to meet up and
   *  get out of the city together. You do not move them. Returns what they say. */
  linkHeroes(aId: string, bId: string): string {
    if (!this.radioUp()) return 'No line of sight. The radio only reaches Minneapolis during a pass.';
    const A = this.heroState(aId), B = this.heroState(bId);
    const ga = this.radio.groups.find((x) => x.id === aId), gb = this.radio.groups.find((x) => x.id === bId);
    const ha = heroById(aId), hb = heroById(bId);
    if (!A || !B || !ga || !gb || !ha || !hb || aId === bId) return 'Pick a second hero to patch through.';
    const first = (n: string) => n.split(' ')[0];
    for (const [st, gr, h] of [[A, ga, ha], [B, gb, hb]] as const) {
      if (st.dead || gr.silent) return `${first(h.name)} does not answer.`;
      if (st.out) return `${first(h.name)} is already out of the city.`;
      if (st.link) return `${first(h.name)} is already on the way to meet ${first(heroById(st.link.with)!.name)}.`;
    }
    this.radio.stats.patches++;
    for (const gr of [ga, gb]) gr.known = true;
    const bd = bond(aId, bId);
    const roll = rng(this.tick * 977 + aId.length * 31 + bId.length * 7);
    // One decision for the pair (they talk it over); the less trusting one is the one who says no.
    const ca = agreeChance({ trust: ga.trust, bond: bd, pressure: this.pressureAt(A.x, A.y) });
    const cb = agreeChance({ trust: gb.trust, bond: bd, pressure: this.pressureAt(B.x, B.y) });
    if ((this.luck ? this.luck() : roll()) > (ca + cb) / 2) {
      const [st, gr, h, other] = ca <= cb ? [A, ga, ha, hb] : [B, gb, hb, ha];
      this.radio.stats.refused++;
      gr.trust = Math.max(0, gr.trust - 0.03);
      st.log.push({ t: this.t, text: `${localTime(this.t)} You patched them to ${first(other.name)}. They said no.` });
      st.fate = `turned down meeting ${first(other.name)}`;
      this.linkSpeaker = st.id;
      return `${first(h.name)}: I don't know ${first(other.name)}. I'm not crossing town on the word of a voice in the sky.`;
    }
    // Who drives: whoever has a vehicle (Mai has none of her own), the bigger one if both do.
    const hasCar = (id: string) => id !== 'dorms';
    let drv = aId, rid = bId;
    if (!hasCar(aId) || (hasCar(bId) && hb.escape.seats > ha.escape.seats)) (drv = bId), (rid = aId);
    const D = this.heroState(drv)!, R = this.heroState(rid)!;
    const meet = hasCar(rid) ? this.midway(D, R) : { x: R.x, y: R.y };
    // The way out: the nearest freeway exit from where they meet.
    let exit = EXITS[0], best = Infinity;
    for (const e of EXITS) {
      const c = cellOf(e.lat, e.lon);
      const d = Math.hypot(c.x - meet.x, c.y - meet.y);
      if (d < best) (best = d), (exit = e);
    }
    const go = (st: HeroState, role: 'driver' | 'rider', moving: boolean) => {
      st.link = { with: st === D ? rid : drv, role, meet, exit: exit.id, stage: moving ? 'going' : 'waiting', reached: moving ? -1 : this.tick };
      st.helpedAt = this.tick;
      if (moving) {
        st.path = streetPath({ x: st.x, y: st.y }, meet);
        st.pathAt = 0;
        st.kmh = heroById(st.id)!.escape.kmh;
        if (st.escapeStart < 0) st.escapeStart = this.tick;
      }
    };
    go(D, 'driver', true);
    go(R, 'rider', hasCar(rid));
    for (const [st, gr, other] of [[A, ga, hb], [B, gb, ha]] as const) {
      gr.trust = Math.min(1, gr.trust + 0.05);
      st.log.push({ t: this.t, text: `${localTime(this.t)} You patched them to ${first(other.name)}. They agreed to meet, then get out by ${exit.name}.` });
      st.fate = `on the way to meet ${first(other.name)}`;
    }
    const dn = first(heroById(drv)!.name), rn = first(heroById(rid)!.name);
    this.linkSpeaker = drv;
    return hasCar(rid) ? `${dn}: Copy. I'll meet ${rn} halfway. Then we go out by ${exit.name}, together.` : `${dn}: Copy. Tell ${rn} to stay put, I'm coming to get her. Then ${exit.name}.`;
  }

  /** Who answered the last patch between heroes (their group speaks the reply). */
  linkSpeaker = '';

  /** What a hero on the road, or out of the city, says when you tune in. PLACEHOLDER lines. */
  roadLine(hs: HeroState): string {
    const me = heroById(hs.id)!.name.split(' ')[0];
    const L = hs.link;
    if (hs.out) return `${me}: We're past the city limits. ${hs.fate[0].toUpperCase()}${hs.fate.slice(1)}. Whoever you are up there: thank you.`;
    if (!L) return '';
    const other = heroById(L.with)!.name.split(' ')[0];
    if (L.stage === 'waiting') return `${me}: I'm at the meeting point. No sign of ${other} yet. Tell them to hurry.`;
    if (L.stage === 'together') return `${me}: ${other} is right here with me. We're heading for the city limits.`;
    if (L.stage === 'alone') return `${me}: It's just me now. I'm going for the city limits.`;
    return `${me}: On my way to ${other}. Keep your eyes on the road ahead of me.`;
  }

  /** Halfway along the streets between two heroes. */
  private midway(a: HeroState, b: HeroState) {
    const p = streetPath({ x: a.x, y: a.y }, { x: b.x, y: b.y });
    let total = 0;
    for (let i = 1; i < p.length; i++) total += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    const m = pathPoint(p, total / 2);
    return { x: m.x, y: m.y };
  }

  /** Share of the dead among everyone on the 3 x 3 block round a point (0..1). */
  pressureAt(x: number, y: number): number {
    const w = this.world;
    const i = Math.floor(y) * GW + Math.floor(x);
    let dead = 0, living = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        dead += w.infected[i + dy * GW + dx] || 0;
        living += w.healthy[i + dy * GW + dx] || 0;
      }
    return dead < 3 ? 0 : dead / (dead + living + 1);
  }

  /** What is left of every linked hero's way: to the meeting point, then out (for the route line). */
  linkLines(): { x: number; y: number }[][] {
    const out: { x: number; y: number }[][] = [];
    for (const hs of this.heroes) {
      if (!hs.link || hs.dead || hs.out || hs.riding) continue;
      if (hs.path) {
        const now = pathPoint(hs.path, hs.pathAt);
        let k = 1, acc = 0;
        while (k < hs.path.length) {
          const seg = Math.hypot(hs.path[k].x - hs.path[k - 1].x, hs.path[k].y - hs.path[k - 1].y);
          if (acc + seg > hs.pathAt) break;
          acc += seg;
          k++;
        }
        out.push([{ x: now.x, y: now.y }, ...hs.path.slice(k)]);
      }
      if (hs.link.stage === 'going' || hs.link.stage === 'waiting') {
        // The planned way out from the meeting point (drawn once, by the driver).
        if (hs.link.role === 'driver') out.push([hs.link.meet, this.exitCell(hs.link.exit)]);
      }
    }
    // Help on the way (police, the bus): what is left of their drive.
    for (const c of this.radio.convoys) {
      if (!c.path) continue;
      const rest = c.path.filter((_, k) => k > 0 && pathLengthTo(c.path!, k) > (c.at ?? 0));
      out.push([{ x: c.x, y: c.y }, ...rest]);
    }
    return out;
  }

  /** Something on the road: the dead. A close call if their luck and your help hold, else lost. */
  private trouble(hs: HeroState, g: Group, waiting: boolean): boolean {
    const p = this.pressureAt(hs.x, hs.y);
    if (p <= 0) return false;
    const roll = this.luck ? this.luck() : rng(this.tick * 3301 + hs.id.length * 97 + 5)();
    if (roll > p * (waiting ? 0.25 : 0.1)) return false;
    const hero = heroById(hs.id)!;
    const save = escapeChance({ left: hs.left, helpedAgo: hs.helpedAt < 0 ? Infinity : this.tick - hs.helpedAt, vehicle: !waiting || hs.id !== 'dorms', trust: g.trust, pressure: p });
    const roll2 = this.luck ? this.luck() : rng(this.tick * 7919 + hs.id.length * 13 + 1)();
    if (roll2 < save) {
      const n = hs.closeCallsUsed;
      hs.left--;
      hs.closeCallsUsed++;
      hs.pending = hero.after[Math.min(n, hero.after.length - 1)];
      hs.log.push({ t: this.t, text: `${localTime(this.t)} Close call on the way. ${hero.costs[Math.min(n, hero.costs.length - 1)]}` });
      return false;
    }
    hs.dead = true;
    hs.path = null;
    g.silent = true;
    g.fate = `lost on the way, around ${localTime(this.t)}`;
    hs.fate = `did not make it: the dead caught them on the way, around ${localTime(this.t)}`;
    hs.log.push({ t: this.t, text: `${localTime(this.t)} The dead caught them on the way. No contact since.` });
    this.lossLog.push(`${localTime(this.t)} ${hero.name} lost on the way`);
    // Whoever was riding with them runs for it on foot.
    for (const o of this.heroes)
      if (o.riding && o.link && o.link.with === hs.id) {
        o.riding = false;
        o.path = null;
        o.link = null;
        o.fate = `got out of the wreck and ran, around ${localTime(this.t)}`;
        o.log.push({ t: this.t, text: `${localTime(this.t)} The vehicle went down. They got out and ran.` });
      }
    return true;
  }

  private leaveAlone(hs: HeroState, why: string) {
    if (!hs.link) return;
    hs.link.stage = 'alone';
    hs.path = streetPath({ x: hs.x, y: hs.y }, this.exitCell(hs.link.exit));
    hs.pathAt = 0;
    hs.kmh = heroById(hs.id)!.escape.kmh;
    if (hs.escapeStart < 0) hs.escapeStart = this.tick;
    hs.log.push({ t: this.t, text: `${localTime(this.t)} ${why}` });
    hs.fate = why;
  }

  /** A hero got to the end of their path. */
  private reached(hs: HeroState, g: Group) {
    const hero = heroById(hs.id)!;
    const L = hs.link;
    const first = (id: string) => heroById(id)!.name.split(' ')[0];
    if (!L) {
      // Their own escape route (after a close call).
      hs.arrived = true;
      const j = Math.floor(hs.y) * GW + Math.floor(hs.x);
      this.world.healthy[j] += hs.riders + 1;
      this.world.armed[j] += 1;
      this.world.guard[j] = 1;
      hs.log.push({ t: this.t, text: `${localTime(this.t)} Arrived: ${hero.escape.to}, with ${Math.round(hs.riders)} people.` });
      hs.fate = `made it to ${hero.escape.to}`;
      return;
    }
    const P = this.heroState(L.with)!;
    if (L.stage === 'going') {
      L.reached = this.tick;
      if (P.link && P.link.with === hs.id && P.link.stage === 'waiting' && !P.dead) {
        // Both here: one convoy out.
        const path = streetPath({ x: hs.x, y: hs.y }, this.exitCell(L.exit));
        const kmh = Math.min(hero.escape.kmh, heroById(P.id)!.escape.kmh);
        for (const [st, lag] of [[hs, 0], [P, 0.13]] as const) {
          st.link!.stage = 'together';
          st.path = path;
          st.pathAt = -lag; // the second vehicle a few car lengths behind
          st.kmh = kmh;
          if (st.escapeStart < 0) st.escapeStart = this.tick;
        }
        const rider = hs.link!.role === 'rider' ? hs : P;
        if (rider.id === 'dorms') (rider.riding = true), (rider.pathAt = 0);
        const at = localTime(this.t);
        hs.log.push({ t: this.t, text: `${at} Met ${first(P.id)}. Heading out together by ${EXITS.find((e) => e.id === L.exit)!.name}.` });
        P.log.push({ t: this.t, text: `${at} ${first(hs.id)} came. Heading out together.` });
        hs.fate = P.fate = `met up and drove for the city limits together`;
        return;
      }
      if (P.dead || P.out || !P.link || P.link.with !== hs.id || P.link.stage === 'alone') {
        this.leaveAlone(hs, `Got to the meeting point. ${first(P.id)} was not there${P.dead ? ' (no contact)' : ', and had gone'}. Went on alone.`);
        return;
      }
      L.stage = 'waiting';
      hs.log.push({ t: this.t, text: `${localTime(this.t)} At the meeting point, waiting for ${first(P.id)}.` });
      return;
    }
    // Together or alone, at the city limits.
    hs.out = true;
    hs.path = null;
    g.status = 'calm';
    const together = L.stage === 'together' && P.link?.stage === 'together' && !P.dead;
    const exitName = EXITS.find((e) => e.id === L.exit)!.name;
    if (!hs.riding) {
      hs.log.push({ t: this.t, text: `${localTime(this.t)} Out of the city by ${exitName}${together ? `, with ${first(P.id)}` : ', alone'}.` });
      hs.fate = together ? `escaped the city with ${first(P.id)}, by ${exitName}` : `escaped the city alone, by ${exitName}`;
    } else {
      hs.log.push({ t: this.t, text: `${localTime(this.t)} Out of the city, riding with ${first(P.id)}.` });
      hs.fate = `escaped the city riding with ${first(P.id)}`;
    }
    this.world.stats.escaped += hero.escape.seats;
  }

  /** Heroes on the move go along their path; linked heroes wait, meet, and drive for the city limits. */
  private moveHeroes() {
    for (const hs of this.heroes) {
      if (hs.dead || hs.out) continue;
      const g = this.radio.groups.find((x) => x.id === hs.id);
      if (!g) continue;
      if (hs.path) {
        hs.pathAt += cellsIn(TICK, hs.kmh);
        const p = pathPoint(hs.path, hs.pathAt);
        hs.x = g.x = p.x;
        hs.y = g.y = p.y;
        hs.face = p.face;
        if (hs.link && !hs.riding && this.trouble(hs, g, false)) continue;
        if (p.arrived) {
          hs.path = null;
          this.reached(hs, g);
        }
        continue;
      }
      const L = hs.link;
      if (L && L.stage === 'waiting') {
        const P = this.heroState(L.with)!;
        if (this.trouble(hs, g, true)) continue;
        if (P.dead) {
          if (hs.id === 'dorms') {
            hs.link = null;
            hs.fate = `waited for ${heroById(P.id)!.name.split(' ')[0]}, who never came`;
            hs.log.push({ t: this.t, text: `${localTime(this.t)} ${heroById(P.id)!.name.split(' ')[0]} never came.` });
          } else this.leaveAlone(hs, `${heroById(P.id)!.name.split(' ')[0]} never came. Went on alone.`);
          continue;
        }
        if (hs.id === 'dorms') continue; // on foot: she can only wait
        const waited = this.tick - L.reached;
        const roll = this.luck ? this.luck() : rng(this.tick * 4409 + hs.id.length * 3)();
        if (roll < leaveChance({ bond: bond(hs.id, P.id), danger: this.pressureAt(hs.x, hs.y), waited })) {
          this.leaveAlone(hs, `Waited ${waited} minutes for ${heroById(P.id)!.name.split(' ')[0]}, then left without them.`);
        }
      }
    }
  }

  takePhoto() {
    const w = this.world;
    this.lastPhoto = new Uint8Array(GW * GH);
    for (let i = 0; i < this.lastPhoto.length; i++) this.lastPhoto[i] = w.infected[i] > Math.max(2, w.healthy[i]) ? 1 : 0;
  }

  /** Advance the night by one frame. `zone` = cells near the camera (or null). */
  simulate(realDt: number, now: number, zone: Box | null, streetVisible: boolean) {
    if (this.paused || this.mode === 'title' || this.mode === 'end') return;
    const rate = this.mode === 'play' ? rateAt(this.t) : this.sandboxRate;
    const gameDt = realDt * rate;
    if (this.mode === 'play') this.newsQueue.push(...eventsBetween(this.t, this.t + gameDt));
    this.t += gameDt;
    moveUnits(this.resp, gameDt);
    // World news comes in one item at a time, so nothing scrolls past unread.
    if (this.newsQueue.length && now > this.nextNews && now > this.nextTalk) {
      const e = this.newsQueue.shift()!;
      this.news.push(e);
      this.say(e.source, e.text, 9);
      this.nextNews = now + 10000;
    }
    this.acc += gameDt;
    let n = 0;
    while (this.acc >= TICK && n++ < 25) {
      this.cityStep();
      this.acc -= TICK;
    }
    if (this.acc > TICK) this.acc = 0;
    if (this.mode === 'play') {
      const open = inWindow(this.t);
      if (open && !this.wasWindow) {
        this.say('', `Pass ${passIndex(this.t) + 1} of ${PASSES}: Minneapolis is coming over the horizon.`, 6);
        this.onWindow(true);
      }
      if (!open && this.wasWindow) {
        this.takePhoto();
        this.sound.hush();
        this.onWindow(false);
        this.say('', `Lost line of sight. Next pass in ${fmt(realSeconds(this.t, this.t + untilWindow(this.t)))}.`, 6);
      }
      this.wasWindow = open;
      if (nightOver(this.t)) {
        this.sound.hush();
        this.sound.setStatic(0);
        this.mode = 'end';
        return;
      }
    }
    if (this.mode === 'play')
      for (const st of this.rumours) {
        const r = rumourById(st.id);
        if (!st.active && this.t >= r.at) {
          st.active = true;
          this.newsQueue.push({ t: this.t, lat: 44.98, lon: -93.27, source: r.source, text: `${r.text} (Rumour. Look at ${r.place}, then press D to answer it.)` });
        }
        // Looking at the place, close enough to tell, during a pass.
        if (st.active && !st.seen && zone && this.canLook() && zone.x1 - zone.x0 < 40 && r.where.x > zone.x0 && r.where.x < zone.x1 && r.where.y > zone.y0 && r.where.y < zone.y1) {
          st.seen = true;
          this.say('', `You can see ${r.place} now. Press D to tell them what you see.`, 5);
        }
      }
    this.setZone(this.canLook() ? zone : null);
    const s = this.street;
    if (s && s !== this.proofStreet) (this.proofStreet = s), (this.seenGetUps = s.stats.getUps);
    if (s && streetVisible && s.stats.getUps > this.seenGetUps) {
      this.seenGetUps = s.stats.getUps;
      if (!this.proof && this.canLook()) {
        this.proof = true;
        this.say('', 'You saw it: shot in the chest, it got back up. Only the head stops them. Press H to tell everyone.', 7);
      }
    }
    if (s && streetVisible) {
      // The street moves in fixed steps (15 a second of game time); the picture slides
      // smoothly between them (streetAlpha). Stepping every frame cost too much.
      this.streetAcc += gameDt;
      let n = 0;
      while (this.streetAcc >= STREET_DT && n < 3) {
        const dt = n === 2 ? Math.min(0.3, this.streetAcc) : STREET_DT;
        this.streetAcc -= dt;
        n++;
        const t0 = performance.now();
        stepStreet(s, this.world, this.tick * 7919 + Math.floor(now) + n, dt, blocked, this.env(), onRoad, roadNet(), wet);
        this.stepMs = this.stepMs * 0.9 + (performance.now() - t0) * 0.1;
        this.drainExits(s);
      }
      this.dropCrews();
      this.pullCrews();
      if (this.streetAcc > STREET_DT) this.streetAcc = 0;
      this.streetAlpha = Math.min(1, this.streetAcc / STREET_DT);
    }
    this.updateSmoke(gameDt, zone);
    const { group, signal } = tuned(this.radio);
    const up = this.radioUp();
    this.sound.setStatic(up ? 1 - signal * 0.8 : 0.35);
    if (up && group && signal > 0.75 && now > this.nextTalk) {
      const pass = this.mode === 'play' ? passIndex(this.t) : Math.min(5, Math.floor(this.tick / 60));
      const hs = this.heroState(group.id);
      if (hs && hs.pending) {
        this.talk(group, hs.pending);
        hs.pending = '';
      } else {
        const before = group.known;
        this.talk(group, (hs && this.roadLine(hs)) || nextLine(this.radio, this.world, group, pass));
        if (hs && !before) hs.log.push({ t: this.t, text: `${localTime(this.t)} Pass ${pass + 1}: first heard on ${group.freq.toFixed(2)} MHz.` });
      }
    }
  }

  private updateSmoke(gameDt: number, b: Box | null) {
    if (!b) {
      this.smoke.length = 0;
      return;
    }
    const want = 1400;
    const smoke = this.smoke;
    for (let y = Math.max(0, Math.floor(b.y0) - 4); y < Math.min(GH, b.y1 + 6); y++)
      for (let x = Math.max(0, Math.floor(b.x0) - 8); x < Math.min(GW, b.x1 + 2); x++) {
        const f = this.fires.fire[y * GW + x];
        if (f > 0.25 && smoke.length < want && Math.random() < f * 0.8 * Math.min(1, gameDt)) {
          const life = 40 + Math.random() * 50;
          const age = smoke.length < want / 2 ? Math.random() * life * 0.7 : 0;
          smoke.push({ x: x + Math.random() + (2.2 * age) / CELL_X, y: y + Math.random(), alt: 5 + 3.5 * age, age, life });
        }
      }
    for (const p of smoke) {
      p.age += gameDt;
      p.alt += 3.5 * gameDt;
      p.x += (2.2 * gameDt) / CELL_X; // wind from the west
    }
    this.smoke = smoke.filter((p) => p.age < p.life);
  }

  /** Living and turned, counting the individuals in the street zone. */
  /** Dispatch radio: kept for the log; the odd line shown when it matters. */
  private dispatch(text: string) {
    this.resp.radio.push({ t: this.t, text });
    if (this.resp.radio.length > 200) this.resp.radio.shift();
    if (/home to|no answer/.test(text) && this.mode === 'play') this.say('Police radio', text, 7);
  }

  /**
   * Crews in the street: when a vehicle is on scene inside the drawn area, its crew get out
   * and are simulated one by one (police with their guns, firefighters with axes, medics).
   * Their fate there is the crew's fate. `all` = everyone back in (the street is closing).
   */
  pullCrews(all = false) {
    const s = this.street;
    if (!s) return;
    const byId = new Map(this.resp.units.map((u) => [u.id, u] as const));
    const alive = new Map<number, Agent[]>();
    for (const a of s.agents) if (a.unit >= 0 && a.kind === Kind.Living && a.turn < 0 && !a.gone) (alive.get(a.unit) ?? alive.set(a.unit, []).get(a.unit)!).push(a);
    for (const u of this.resp.units) {
      if (!u.inStreet.length) continue;
      const list = alive.get(u.id) ?? [];
      u.crew = list.length;
      if (u.armed) u.ammo = list.reduce((n, a) => n + a.ammo, 0);
      const inside = u.x >= s.x0 && u.y >= s.y0 && u.x < s.x0 + s.w && u.y < s.y0 + s.h;
      if (all || u.state !== 'scene' || u.sceneT <= 0 || !inside) {
        for (const a of list) a.gone = true; // back in the vehicle
        u.inStreet = [];
        if (u.crew <= 0) u.state = 'lost';
      } else u.inStreet = list.map((a) => a.uid);
      if (u.crew <= 0 && u.state !== 'lost') {
        u.state = 'lost';
        u.inStreet = [];
        this.dispatch(`${u.label}, ${u.label}, respond... (no answer)`);
      }
    }
    void byId;
    s.agents = s.agents.filter((a) => !a.gone || a.unit < 0);
  }

  private dropCrews() {
    const s = this.street;
    if (!s) return;
    for (const u of this.resp.units) {
      if (u.state !== 'scene' || u.inStreet.length || u.crew <= 0 || u.sceneT <= 0) continue;
      if (u.x < s.x0 || u.y < s.y0 || u.x >= s.x0 + s.w || u.y >= s.y0 + s.h) continue;
      const r = Math.random;
      const fx = Math.cos(u.face), fy = Math.sin(u.face);
      for (let k = 0; k < u.crew; k++) {
        // Out of the doors, either side of the vehicle.
        const side = k % 2 ? 1 : -1, back = (Math.floor(k / 2) - 0.5) * 3;
        let x = u.x + (-fy * side * 2.4 - fx * back) / CELL_M, y = u.y + (fx * side * 2.4 - fy * back) / CELL_M;
        if (blocked(x, y) || wet(x, y)) [x, y] = outside(x, y, (px, py) => blocked(px, py) || wet(px, py));
        const role = u.kind === 'police' ? Role.Police : u.kind === 'fire' ? Role.Fire : Role.Civilian;
        const a = newAgent(x, y, Kind.Living, u.armed ? Math.max(1, Math.round(u.ammo / u.crew)) : 0, role);
        if (u.armed) a.gun = pickGun(Role.Police, r);
        if (u.kind === 'fire') (a.weapon = AXE), (a.skill = 0.3);
        a.bold = u.kind === 'ems' ? 0.4 : 0.85 + r() * 0.15;
        a.know = 0.2;
        a.face = u.face;
        a.unit = u.id;
        s.agents.push(a);
        u.inStreet.push(a.uid);
      }
    }
  }

  totals() {
    let alive = count(this.world.healthy) + crewTotal(this.resp);
    let dead = count(this.world.infected);
    const s = this.street;
    if (s) {
      for (const a of s.agents) {
        if (a.unit >= 0 && a.kind === Kind.Living) continue; // counted with their vehicle
        if (a.unit >= 0) {
          if (a.kind === Kind.Dead) dead += 1;
          continue;
        }
        if (a.kind === Kind.Living) alive += s.scale;
        if (a.kind === Kind.Dead) dead += s.scale;
      }
      alive += count(s.indoor);
    }
    return { alive, dead, fallen: count(this.world.fallen), escaped: this.world.stats.escaped };
  }

  isDark(i: number) {
    const w = this.world;
    return w.infected[i] > 3 && w.infected[i] > w.healthy[i] * 0.8;
  }
}
