// Street life that ties the city together: sidewalks are painted on the ground (see
// city.ts drawGround); this file places the things that stand up: street lamps and trees.
// Nothing here comes from a survey of real trees: the places are chosen by rule (ISAK's
// call, 22 Nov 2026): boulevard trees along house streets, groves in parks and woods,
// trees on the river banks, a few in yards. 16 October: fall colours, some bare.
import { det, blocked, roadNet, wet, CELL_X, CELL_Y } from '../game/session';
import { query, Shapes, TILE } from '../map/detail';
import { nearAsphalt, nearestRoad } from '../sim/roadnet';

export const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Is the point inside a polygon set (even-odd, so holes count)? Points in map cells. */
export function inShapes(s: Shapes, x: number, y: number): boolean {
  let inside = false;
  for (const k of query(s, x, y, x, y)) {
    if (x < s.box[k * 4] || x > s.box[k * 4 + 2] || y < s.box[k * 4 + 1] || y > s.box[k * 4 + 3]) continue;
    const o = s.off[k], n = s.off[k + 1] - o;
    for (let j = 0, i = n - 1; j < n; i = j++) {
      const xi = s.xy[(o + i) * 2], yi = s.xy[(o + i) * 2 + 1], xj = s.xy[(o + j) * 2], yj = s.xy[(o + j) * 2 + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Polygons filled into a grid over a rectangle (cells), `per` squares per cell, even-odd. */
export function maskOf(s: Shapes, x0: number, y0: number, w: number, h: number, per = 16) {
  const W = Math.ceil(w * per), H = Math.ceil(h * per);
  const m = new Uint8Array(W * H);
  const xs: number[] = [];
  const ks = query(s, x0, y0, x0 + w, y0 + h);
  for (let Y = 0; Y < H; Y++) {
    const py = y0 + (Y + 0.5) / per;
    xs.length = 0;
    for (const k of ks) {
      if (py < s.box[k * 4 + 1] || py > s.box[k * 4 + 3]) continue;
      const o = s.off[k], n = s.off[k + 1] - o;
      for (let j = 0, i = n - 1; j < n; i = j++) {
        const ay = s.xy[(o + i) * 2 + 1], by = s.xy[(o + j) * 2 + 1];
        if (ay > py !== by > py) {
          const ax = s.xy[(o + i) * 2], bx = s.xy[(o + j) * 2];
          xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const X0 = Math.max(0, Math.ceil((xs[q] - x0) * per - 0.5)), X1 = Math.min(W - 1, Math.floor((xs[q + 1] - x0) * per - 0.5));
      for (let X = X0; X <= X1; X++) m[Y * W + X] ^= 1;
    }
  }
  return (x: number, y: number) => {
    const X = Math.floor((x - x0) * per), Y = Math.floor((y - y0) * per);
    return X >= 0 && Y >= 0 && X < W && Y < H && m[Y * W + X] === 1;
  };
}

/** Share of a cell covered by buildings (0..1), from the 10 m building grid. */
const coverCache = new Map<number, number>();
export function cover(cx: number, cy: number): number {
  const key = cy * 10000 + cx;
  let v = coverCache.get(key);
  if (v === undefined) {
    let n = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) if (blocked(cx + (i + 0.5) / 8, cy + (j + 0.5) / 8)) n++;
    coverCache.set(key, (v = n / 64));
  }
  return v;
}
/** Downtown and big lots: paved, no lawns, no boulevard trees. */
export const paved = (x: number, y: number) => {
  // Averaged over the cell and its neighbours: houses cover about a quarter to a third
  // of their block, downtown and the big lots about half or more.
  const cx = Math.floor(x), cy = Math.floor(y);
  let t = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) t += cover(cx + i, cy + j);
  return t / 9 > 0.45;
};

export interface Lamp {
  x: number; // map cells
  y: number;
  /** Angle the arm points (toward the road), radians from +x toward +y. */
  arm: number;
}

/** Street lamps along every road about every 40 m, at the kerb, alternating sides.
 *  The orange light pools on the ground are drawn at the same spots. */
/** Is (x, y) within `margin` metres of the surface of any street other than `k`? */
export function nearOtherRoad(k: number, x: number, y: number, margin: number): boolean {
  const s = det.roads;
  for (const q of query(s, x - 0.4, y - 0.4, x + 0.4, y + 0.4)) {
    if (q === k) continue;
    const qo = s.off[q], qn = s.off[q + 1] - qo, clearM = s.meta[q] / 2 + margin;
    for (let i = 0; i + 1 < qn; i++) {
      const px = s.xy[(qo + i) * 2], py = s.xy[(qo + i) * 2 + 1];
      const ex = (s.xy[(qo + i + 1) * 2] - px) * CELL_X, ey = (s.xy[(qo + i + 1) * 2 + 1] - py) * CELL_Y;
      const wx = (x - px) * CELL_X, wy = (y - py) * CELL_Y;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
      if (Math.hypot(wx - ex * t, wy - ey * t) < clearM) return true;
    }
  }
  return false;
}

export function lampSpots(x0: number, y0: number, x1 = x0 + TILE, y1 = y0 + TILE): Lamp[] {
  const s = det.roads;
  const out: Lamp[] = [];
  for (const k of query(s, x0 - 0.3, y0 - 0.3, x1 + 0.3, y1 + 0.3)) {
    if (det.bridgeRoads.has(k)) continue; // no lamp posts standing down in the river
    const wm = s.meta[k];
    const o = s.off[k], n = s.off[k + 1] - o;
    let carry = hash(k) * 40;
    let side = hash(k * 3) < 0.5 ? 1 : -1;
    for (let j = 0; j + 1 < n; j++) {
      const ax = s.xy[(o + j) * 2], ay = s.xy[(o + j) * 2 + 1];
      const bx = s.xy[(o + j + 1) * 2], by = s.xy[(o + j + 1) * 2 + 1];
      const lx = (bx - ax) * CELL_X, ly = (by - ay) * CELL_Y;
      const len = Math.hypot(lx, ly);
      if (len < 0.01) continue;
      const ux = lx / len, uy = ly / len;
      while (carry < len) {
        const off = (wm / 2 + 0.8) * side;
        const x = ax + (ux * carry - uy * off) / CELL_X, y = ay + (uy * carry + ux * off) / CELL_Y;
        if (x >= x0 && y >= y0 && x < x1 && y < y1 && !blocked(x, y) && !wet(x, y) && !nearOtherRoad(k, x, y, 0.6)) out.push({ x, y, arm: Math.atan2(-ux * side, uy * side) });
        carry += 40;
        side = -side;
      }
      carry -= len;
    }
  }
  return out;
}

export type TreeKind = 0 | 1 | 2 | 3 | 4 | 5; // maple orange, gold, red oak, still green, evergreen, bare
export interface Tree {
  x: number;
  y: number;
  kind: TreeKind;
  /** Size multiplier, about 0.7..1.3. */
  size: number;
  /** 0..1: light from the nearest street lamp. */
  warm: number;
  seed: number;
}

function pickKind(h: number, wild: boolean): TreeKind {
  // Mid-October in Minneapolis: maples orange and red, ashes and lindens gold, oaks
  // brown-red, a few still green, spruces and pines, and some already bare (guesses).
  if (wild) return h < 0.22 ? 4 : h < 0.42 ? 2 : h < 0.6 ? 1 : h < 0.78 ? 0 : h < 0.9 ? 3 : 5;
  return h < 0.3 ? 0 : h < 0.55 ? 1 : h < 0.68 ? 2 : h < 0.8 ? 3 : h < 0.88 ? 4 : 5;
}

/** Trees in a tile, by rule. Deterministic: the same tile always gets the same trees. */
export function treeSpots(x0: number, y0: number, density = 1): Tree[] {
  const net = roadNet();
  const out: Tree[] = [];
  const x1 = x0 + TILE, y1 = y0 + TILE;
  const lamps = lampSpots(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  const water = maskOf(det.water, x0 - 0.5, y0 - 0.5, TILE + 1, TILE + 1);
  const park = maskOf(det.parks, x0, y0, TILE, TILE);
  const ok = (x: number, y: number, gap = 1.4) => {
    if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
    // Trunk and crown clear of walls (crown radius about 3 m).
    for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [2.1, 2.1], [-2.1, 2.1], [2.1, -2.1], [-2.1, -2.1]]) if (blocked(x + dx / CELL_X, y + dy / CELL_Y)) return false;
    if (nearAsphalt(net, x, y, gap)) return false;
    if (water(x, y)) return false;
    return true;
  };
  const add = (x: number, y: number, kind: TreeKind, seed: number) => {
    let warm = 0;
    for (const l of lamps) {
      const d = Math.hypot((l.x - x) * CELL_X, (l.y - y) * CELL_Y);
      if (d < 16) warm = Math.max(warm, 1 - d / 16);
    }
    out.push({ x, y, kind, size: 0.75 + hash(seed * 1.7) * 0.4, warm, seed });
  };
  // 1. Boulevard trees: the grass strip between kerb and sidewalk on house streets.
  const s = det.roads;
  for (const k of query(s, x0 - 0.3, y0 - 0.3, x1 + 0.3, y1 + 0.3)) {
    const wm = s.meta[k];
    if (wm < 6 || wm > 13 || det.bridgeRoads.has(k)) continue;
    const o = s.off[k], n = s.off[k + 1] - o;
    let carry = 4 + hash(k * 7) * 6;
    for (let j = 0; j + 1 < n; j++) {
      const ax = s.xy[(o + j) * 2], ay = s.xy[(o + j) * 2 + 1];
      const bx = s.xy[(o + j + 1) * 2], by = s.xy[(o + j + 1) * 2 + 1];
      const lx = (bx - ax) * CELL_X, ly = (by - ay) * CELL_Y;
      const len = Math.hypot(lx, ly);
      if (len < 0.01) continue;
      const ux = lx / len, uy = ly / len;
      while (carry < len) {
        for (const side of [-1, 1]) {
          const seed = k * 1009 + j * 31 + Math.floor(carry) * 3 + (side > 0 ? 1 : 0);
          const h = hash(seed);
          if (h > 0.82 * density) continue; // gaps: driveways, dead trees taken down
          const off = (wm / 2 + 1.9) * side;
          const x = ax + (ux * carry - uy * off) / CELL_X, y = ay + (uy * carry + ux * off) / CELL_Y;
          if (paved(x, y) || !ok(x, y, 0.9)) continue;
          // Keep junctions clear (sight lines, and it reads better).
          const nr = nearestRoad(net, x, y, 12 / net.M);
          if (nr && Math.min(nr.along, net.elen[nr.edge] - nr.along) < 8) continue;
          // A whole block tends to be planted with one kind.
          add(x, y, pickKind(hash(k * 13 + (h < 0.12 ? seed : 0)), false), seed);
        }
        carry += 9 + hash(k + carry) * 4;
      }
      carry -= len;
    }
  }
  // 2. Parks and woods: groves, denser in some places than others; 3. river banks;
  // 4. a few in back yards.
  const step = 7;
  const nx = Math.ceil((TILE * CELL_X) / step), ny = Math.ceil((TILE * CELL_Y) / step);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const seed = (y0 * 64 + j) * 100003 + x0 * 64 + i;
      const x = x0 + ((i + 0.2 + hash(seed) * 0.6) * step) / CELL_X;
      const y = y0 + ((j + 0.2 + hash(seed + 5) * 0.6) * step) / CELL_Y;
      const clump = 0.5 + 0.5 * Math.sin(x * 2.3 + Math.sin(y * 1.7) * 2) * Math.sin(y * 2.9 + x * 0.7);
      const h = hash(seed + 9);
      let p = 0, wild = false;
      if (park(x, y)) (p = 0.15 + 0.6 * clump), (wild = true);
      else {
        let shore = false;
        for (const [dx, dy] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) if (water(x + dx, y + dy)) shore = true;
        if (shore) (p = 0.55), (wild = true);
        else if (!paved(x, y)) p = 0.05 + 0.08 * clump; // yards
      }
      if (h > p * density) continue;
      if (!ok(x, y, wild ? 2 : 3.5)) continue;
      add(x, y, pickKind(hash(seed + 21), wild), seed);
    }
  return out;
}
