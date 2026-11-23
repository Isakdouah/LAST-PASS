// Bridges. The elevation data is bare earth (bridges removed), so every bridge in the map
// (roads, paths and railways tagged bridge in OpenStreetMap) is built here: a deck from bank to
// bank, railings, and piers down to the ground where it is more than a few metres below.
// The deck runs straight between the ground heights where the bridge starts and ends (bridges
// split into several map pieces are joined first), so it never sags into the river.
import * as THREE from 'three';
import { det, CELL_X, CELL_Y } from '../game/session';
import { query, TILE } from '../map/detail';
import { heightAt } from './terrain';

let nodeH: Map<string, number> | null = null;
const keyOf = (x: number, y: number) => Math.round(x * 64) + ',' + Math.round(y * 64);

/** Deck heights at every bridge end (solved once): free ends sit on the ground, joints between
 *  two pieces of the same bridge take the length-weighted average of their neighbours. */
function ends(): Map<string, number> {
  if (nodeH) return nodeH;
  const b = det.bridges;
  const deg = new Map<string, { other: string; len: number }[]>();
  const ground = new Map<string, number>();
  for (let k = 0; k < b.count; k++) {
    const o = b.off[k], n = b.off[k + 1] - o;
    if (n < 2) continue;
    let len = 0;
    for (let j = 0; j + 1 < n; j++) len += Math.hypot((b.xy[(o + j + 1) * 2] - b.xy[(o + j) * 2]) * CELL_X, (b.xy[(o + j + 1) * 2 + 1] - b.xy[(o + j) * 2 + 1]) * CELL_Y);
    const ax = b.xy[o * 2], ay = b.xy[o * 2 + 1], bx = b.xy[(o + n - 1) * 2], by = b.xy[(o + n - 1) * 2 + 1];
    const ka = keyOf(ax, ay), kb = keyOf(bx, by);
    ground.set(ka, heightAt(ax, ay));
    ground.set(kb, heightAt(bx, by));
    (deg.get(ka) ?? deg.set(ka, []).get(ka)!).push({ other: kb, len });
    (deg.get(kb) ?? deg.set(kb, []).get(kb)!).push({ other: ka, len });
  }
  const h = new Map(ground);
  for (let it = 0; it < 40; it++)
    for (const [k, list] of deg) {
      if (list.length < 2) continue; // a free end: on the ground
      let s = 0, w = 0;
      for (const e of list) (s += h.get(e.other)! / Math.max(1, e.len)), (w += 1 / Math.max(1, e.len));
      h.set(k, Math.max(ground.get(k)!, s / w));
    }
  return (nodeH = h);
}

/** Deck height (relative to REF) along bridge piece k at fraction t of its length. */
function deckH(k: number, t: number): number {
  const b = det.bridges, o = b.off[k], n = b.off[k + 1] - o;
  const e = ends();
  const ha = e.get(keyOf(b.xy[o * 2], b.xy[o * 2 + 1]))!, hb = e.get(keyOf(b.xy[(o + n - 1) * 2], b.xy[(o + n - 1) * 2 + 1]))!;
  return ha + (hb - ha) * t;
}

/** Walk the segments of piece k with their start fraction and length. */
function segs(k: number) {
  const b = det.bridges, o = b.off[k], n = b.off[k + 1] - o;
  const out: { ax: number; ay: number; bx: number; by: number; t0: number; t1: number; len: number }[] = [];
  let total = 0;
  for (let j = 0; j + 1 < n; j++) total += Math.hypot((b.xy[(o + j + 1) * 2] - b.xy[(o + j) * 2]) * CELL_X, (b.xy[(o + j + 1) * 2 + 1] - b.xy[(o + j) * 2 + 1]) * CELL_Y);
  let acc = 0;
  for (let j = 0; j + 1 < n; j++) {
    const ax = b.xy[(o + j) * 2], ay = b.xy[(o + j) * 2 + 1], bx = b.xy[(o + j + 1) * 2], by = b.xy[(o + j + 1) * 2 + 1];
    const len = Math.hypot((bx - ax) * CELL_X, (by - ay) * CELL_Y);
    out.push({ ax, ay, bx, by, t0: acc / (total || 1), t1: (acc + len) / (total || 1), len });
    acc += len;
  }
  return out;
}

/** The deck height under (x, y) if a bridge is there, else null. With a heading (dx, dy) only a
 *  bridge running the same way counts (a car on a freeway under an overpass stays under it);
 *  without one, only a deck well above the ground (over water or a gorge). */
let near: Set<number> | null = null;
/** Quarter-cells (about 20 m) that any bridge touches: a fast first check. */
function nearSet(): Set<number> {
  if (near) return near;
  near = new Set();
  const b = det.bridges;
  for (let k = 0; k < b.count; k++)
    for (let y = Math.floor((b.box[k * 4 + 1] - 0.15) * 4); y <= Math.floor((b.box[k * 4 + 3] + 0.15) * 4); y++)
      for (let x = Math.floor((b.box[k * 4] - 0.15) * 4); x <= Math.floor((b.box[k * 4 + 2] + 0.15) * 4); x++) near.add(y * 4096 + x);
  return near;
}

export function deckAt(x: number, y: number, dx = 0, dy = 0): number | null {
  const b = det.bridges;
  if (!b.count || !nearSet().has(Math.floor(y * 4) * 4096 + Math.floor(x * 4))) return null;
  let best: number | null = null;
  const hl = Math.hypot(dx, dy);
  for (const k of query(b, x - 0.2, y - 0.2, x + 0.2, y + 0.2)) {
    const half = b.meta[k] / 2 + 0.6;
    for (const s of segs(k)) {
      const ex = (s.bx - s.ax) * CELL_X, ey = (s.by - s.ay) * CELL_Y, wx = (x - s.ax) * CELL_X, wy = (y - s.ay) * CELL_Y;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (s.len * s.len || 1)));
      if (Math.hypot(wx - ex * t, wy - ey * t) > half) continue;
      const d = deckH(k, s.t0 + (s.t1 - s.t0) * t);
      if (hl > 1e-9) {
        if (Math.abs((dx * ex + dy * ey) / (hl * (s.len || 1))) < 0.6) continue;
      } else if (d - heightAt(x, y) < 4) continue;
      if (best === null || d > best) best = d;
    }
  }
  return best;
}

const COL = { road: 0x2a2a30, rail: 0x3a332c, path: 0x4a4844, side: 0x6a6a66, rail2: 0x55565a, pier: 0x5e5d58 };

/** Bridge geometry for one map tile, in local metres with heights stored relative to the ground
 *  under each point (the material lifts every point by the ground height). */
export function bridgeGeometry(x0: number, y0: number, toLocal: (x: number, y: number, out: THREE.Vector3) => THREE.Vector3): THREE.BufferGeometry | null {
  const b = det.bridges;
  const P: number[] = [], C: number[] = [], I: number[] = [];
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  // A four-cornered face; corners given as [cellX, cellY, absolute height].
  const face = (pts: [number, number, number][], col: number, shade: number) => {
    const base = P.length / 3;
    c.setHex(col).multiplyScalar(shade);
    for (const [x, y, hAbs] of pts) {
      toLocal(x, y, v);
      P.push(v.x, hAbs - heightAt(x, y), v.z);
      C.push(c.r, c.g, c.b);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2); // both sides
  };
  for (const k of query(b, x0, y0, x0 + TILE, y0 + TILE)) {
    const o = b.off[k], n = b.off[k + 1] - o;
    const mx = b.xy[(o + (n >> 1)) * 2], my = b.xy[(o + (n >> 1)) * 2 + 1];
    if (mx < x0 || my < y0 || mx >= x0 + TILE || my >= y0 + TILE) continue;
    const w = b.meta[k], half = w / 2;
    const top = w >= 7 && w !== 7 ? COL.road : w === 7 ? COL.rail : COL.path;
    let sincePier = 15;
    for (const s of segs(k)) {
      if (s.len < 0.1) continue;
      const ux = ((s.bx - s.ax) * CELL_X) / s.len, uy = ((s.by - s.ay) * CELL_Y) / s.len;
      const rx = -uy / CELL_X, ry = ux / CELL_Y; // across, per metre, in cells
      const ha = deckH(k, s.t0), hb = deckH(k, s.t1);
      const A = (side: number, ex = 0): [number, number] => [s.ax + rx * side * (half + ex), s.ay + ry * side * (half + ex)];
      const B = (side: number, ex = 0): [number, number] => [s.bx + rx * side * (half + ex), s.by + ry * side * (half + ex)];
      // Deck top, underside and both edges.
      face([[...A(-1), ha], [...B(-1), hb], [...B(1), hb], [...A(1), ha]], top, 1);
      face([[...A(-1), ha - 1.1], [...B(-1), hb - 1.1], [...B(1), hb - 1.1], [...A(1), ha - 1.1]], COL.side, 0.35);
      for (const sd of [-1, 1]) {
        face([[...A(sd), ha - 1.1], [...B(sd), hb - 1.1], [...B(sd), hb + 1.0], [...A(sd), ha + 1.0]], COL.side, 0.7);
        face([[...A(sd, -0.25), ha], [...B(sd, -0.25), hb], [...B(sd, -0.25), hb + 1.0], [...A(sd, -0.25), ha + 1.0]], COL.rail2, 0.55);
        face([[...A(sd, -0.25), ha + 1.0], [...B(sd, -0.25), hb + 1.0], [...B(sd), hb + 1.0], [...A(sd), ha + 1.0]], COL.rail2, 0.9);
      }
      // Lane paint on road decks: pale edge lines and a dashed yellow centre line.
      if (top === COL.road) {
        for (const sd of [-1, 1]) {
          const e1 = A(sd, -0.9), e2 = B(sd, -0.9), f1 = A(sd, -0.75), f2 = B(sd, -0.75);
          face([[...e1, ha + 0.03], [...e2, hb + 0.03], [...f2, hb + 0.03], [...f1, ha + 0.03]], 0xb8b6ac, 0.8);
        }
        for (let d = 0; d + 3 < s.len; d += 9) {
          const f0 = d / s.len, f1 = (d + 3) / s.len;
          const p0x = s.ax + (s.bx - s.ax) * f0, p0y = s.ay + (s.by - s.ay) * f0, p1x = s.ax + (s.bx - s.ax) * f1, p1y = s.ay + (s.by - s.ay) * f1;
          const h0 = ha + (hb - ha) * f0 + 0.03, h1 = ha + (hb - ha) * f1 + 0.03;
          face([[p0x - rx * 0.08, p0y - ry * 0.08, h0], [p1x - rx * 0.08, p1y - ry * 0.08, h1], [p1x + rx * 0.08, p1y + ry * 0.08, h1], [p0x + rx * 0.08, p0y + ry * 0.08, h0]], 0xc8a030, 0.9);
        }
      }
      // Piers where the ground is well below the deck.
      for (let d = 0; d < s.len; d += 5) {
        sincePier += 5;
        if (sincePier < 32) continue;
        const f = d / s.len, px = s.ax + (s.bx - s.ax) * f, py = s.ay + (s.by - s.ay) * f;
        const dh = ha + (hb - ha) * f;
        if (dh - heightAt(px, py) < 3) continue;
        sincePier = 0;
        const pw = 0.8 / CELL_X, along = [ux / CELL_X * 0.8, uy / CELL_Y * 0.8];
        const corner = (sa: number, sb: number): [number, number] => [px + rx * sa * (half - 1) + along[0] * sb, py + ry * sa * (half - 1) + along[1] * sb];
        void pw;
        const g = Math.min(heightAt(px, py), dh) - 3;
        for (const [a1, b1, a2, b2] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]] as const)
          face([[...corner(a1, b1), g], [...corner(a2, b2), g], [...corner(a2, b2), dh - 1.1], [...corner(a1, b1), dh - 1.1]], COL.pier, 0.6);
      }
    }
  }
  if (!P.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.setIndex(I);
  return geo;
}
