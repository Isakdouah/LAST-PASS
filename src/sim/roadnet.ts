// The road network for cars: OpenStreetMap road lines joined at their junctions into a
// graph, so a car can drive along a real street, pick a turn at a crossing and never
// leave the road. Built once from the street detail (tools/build_detail.py).
import type { Shapes } from '../map/detail';

export interface RoadNet {
  /** Number of edges (a piece of road between two junctions or ends). */
  n: number;
  /** Junction (node) at each end of edge e. */
  ea: Int32Array;
  eb: Int32Array;
  /** Edge e's points are pts[eoff[e] .. eoff[e+1]) (x, y in map cells). */
  eoff: Uint32Array;
  pts: Float32Array;
  /** Metres from the edge's start at each point. */
  cum: Float32Array;
  elen: Float32Array;
  /** Road width in metres. */
  ewid: Uint8Array;
  nodeX: Float32Array;
  nodeY: Float32Array;
  /** Edges at each junction. */
  adj: number[][];
  /** 1-cell tiles to the edges that pass through them (for "nearest road"). */
  tiles: Map<number, number[]>;
  /** Metres per map cell used for lengths. */
  M: number;
  /** 1 = the road runs under a building (a tunnel, a ramp under a ramp): cars avoid it. */
  covered: Uint8Array;
}

/** Mark the roads that pass under buildings, sampling every few metres. */
export function markCovered(net: RoadNet, inside: (x: number, y: number) => boolean, every = 4): RoadNet {
  const p: RoadPoint = { x: 0, y: 0, tx: 1, ty: 0 };
  for (let e = 0; e < net.n; e++)
    for (let a = 0; a <= net.elen[e]; a += every) {
      pointAt(net, e, a, p);
      if (inside(p.x, p.y)) {
        net.covered[e] = 1;
        break;
      }
    }
  return net;
}

const tileKey = (tx: number, ty: number) => (ty + 10) * 10000 + (tx + 10);

/**
 * Build the graph. Roads that share a point are joined there. A road that ends within
 * `snap` cells of another road's line (a T-junction whose shared point was simplified
 * away) is joined to it too.
 */
export function buildRoadNet(r: Shapes, M = 79, q = 64, snap = 0.05): RoadNet {
  const K = (x: number, y: number) => (Math.round(x * q) + 4000) * 100000 + (Math.round(y * q) + 4000);
  // How many roads use each point.
  const uses = new Map<number, number>();
  for (let s = 0; s < r.count; s++) {
    const seen = new Set<number>();
    for (let j = r.off[s]; j < r.off[s + 1]; j++) {
      const k = K(r.xy[j * 2], r.xy[j * 2 + 1]);
      if (seen.has(k)) continue;
      seen.add(k);
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  // Segment index, to snap loose ends onto the road they meet.
  const segTiles = new Map<number, number[]>(); // tile -> [shape, j, ...]
  for (let s = 0; s < r.count; s++)
    for (let j = r.off[s]; j + 1 < r.off[s + 1]; j++) {
      const ax = r.xy[j * 2], ay = r.xy[j * 2 + 1], bx = r.xy[j * 2 + 2], by = r.xy[j * 2 + 3];
      for (let ty = Math.floor(Math.min(ay, by) - snap); ty <= Math.floor(Math.max(ay, by) + snap); ty++)
        for (let tx = Math.floor(Math.min(ax, bx) - snap); tx <= Math.floor(Math.max(ax, bx) + snap); tx++) {
          const key = tileKey(tx, ty);
          let l = segTiles.get(key);
          if (!l) segTiles.set(key, (l = []));
          l.push(s, j);
        }
    }
  // Extra points to insert into roads: shape -> list of [segment j, t, x, y].
  const inserts = new Map<number, [number, number, number, number][]>();
  const isNode = new Set<number>();
  for (let s = 0; s < r.count; s++)
    for (const j of [r.off[s], r.off[s + 1] - 1]) {
      const x = r.xy[j * 2], y = r.xy[j * 2 + 1];
      const k = K(x, y);
      isNode.add(k);
      if ((uses.get(k) ?? 0) > 1) continue;
      const l = segTiles.get(tileKey(Math.floor(x), Math.floor(y)));
      if (!l) continue;
      let best = snap * snap, bs = -1, bj = 0, bt = 0;
      for (let i = 0; i < l.length; i += 2) {
        const s2 = l[i], j2 = l[i + 1];
        if (s2 === s) continue;
        const ax = r.xy[j2 * 2], ay = r.xy[j2 * 2 + 1], bx = r.xy[j2 * 2 + 2], by = r.xy[j2 * 2 + 3];
        const dx = bx - ax, dy = by - ay;
        const L2 = dx * dx + dy * dy || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
        const d = (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2;
        if (d < best) (best = d), (bs = s2), (bj = j2), (bt = t);
      }
      if (bs < 0) continue;
      let a = inserts.get(bs);
      if (!a) inserts.set(bs, (a = []));
      a.push([bj, bt, x, y]);
      uses.set(k, 2);
    }
  // Two roads that cross with no shared point (it was simplified away): a crossing.
  // Motorways cross on bridges, so they never join this way.
  const pairDone = new Set<string>();
  for (const l of segTiles.values())
    for (let i = 0; i < l.length; i += 2)
      for (let k2 = i + 2; k2 < l.length; k2 += 2) {
        const s1 = l[i], j1 = l[i + 1], s2 = l[k2], j2 = l[k2 + 1];
        if (s1 === s2 || r.meta[s1] >= 22 || r.meta[s2] >= 22) continue;
        const ax = r.xy[j1 * 2], ay = r.xy[j1 * 2 + 1], bx = r.xy[j1 * 2 + 2], by = r.xy[j1 * 2 + 3];
        const cx = r.xy[j2 * 2], cy = r.xy[j2 * 2 + 1], dx = r.xy[j2 * 2 + 2], dy = r.xy[j2 * 2 + 3];
        const ux = bx - ax, uy = by - ay, vx = dx - cx, vy = dy - cy;
        const den = ux * vy - uy * vx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * vy - (cy - ay) * vx) / den;
        const u = ((cx - ax) * uy - (cy - ay) * ux) / den;
        if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) continue;
        const pk = j1 < j2 ? `${j1},${j2}` : `${j2},${j1}`;
        if (pairDone.has(pk)) continue;
        pairDone.add(pk);
        // Snap to the grid the keys use, so both roads get the very same point.
        const x = Math.round((ax + ux * t) * q) / q, y = Math.round((ay + uy * t) * q) / q;
        for (const [s, j, tt] of [[s1, j1, t], [s2, j2, u]]) {
          let a = inserts.get(s);
          if (!a) inserts.set(s, (a = []));
          a.push([j, tt, x, y]);
        }
        uses.set(K(x, y), 2);
      }
  for (const [k, v] of uses) if (v > 1) isNode.add(k);

  // Walk each road, cutting it into edges at every junction.
  const nodeId = new Map<number, number>();
  const nx: number[] = [], ny: number[] = [];
  const node = (x: number, y: number) => {
    const k = K(x, y);
    let id = nodeId.get(k);
    if (id === undefined) nodeId.set(k, (id = nx.length)), nx.push(x), ny.push(y);
    return id;
  };
  const ea: number[] = [], eb: number[] = [], eoff: number[] = [0], pts: number[] = [], cum: number[] = [], elen: number[] = [], ewid: number[] = [];
  for (let s = 0; s < r.count; s++) {
    const list: [number, number][] = [];
    const ins = (inserts.get(s) ?? []).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let ii = 0;
    for (let j = r.off[s]; j < r.off[s + 1]; j++) {
      list.push([r.xy[j * 2], r.xy[j * 2 + 1]]);
      while (ii < ins.length && ins[ii][0] === j) list.push([ins[ii][2], ins[ii][3]]), ii++;
    }
    let start = 0;
    let cur: number[] = [list[0][0], list[0][1]];
    let len = 0;
    const cm: number[] = [0];
    for (let p = 1; p < list.length; p++) {
      const [x, y] = list[p];
      const px = cur[cur.length - 2], py = cur[cur.length - 1];
      const d = Math.hypot(x - px, y - py) * M;
      if (d < 0.01) continue;
      cur.push(x, y);
      len += d;
      cm.push(len);
      if (isNode.has(K(x, y)) || p === list.length - 1) {
        if (len > 0.5) {
          ea.push(node(list[start][0], list[start][1]));
          eb.push(node(x, y));
          pts.push(...cur);
          cum.push(...cm);
          eoff.push(pts.length / 2);
          elen.push(len);
          ewid.push(r.meta[s]);
        }
        start = p;
        cur = [x, y];
        len = 0;
        cm.length = 1;
      }
    }
  }
  const n = ea.length;
  const adj: number[][] = nx.map(() => []);
  for (let e = 0; e < n; e++) {
    adj[ea[e]].push(e);
    if (eb[e] !== ea[e]) adj[eb[e]].push(e);
  }
  const P = new Float32Array(pts);
  const off = new Uint32Array(eoff);
  const tiles = new Map<number, number[]>();
  for (let e = 0; e < n; e++) {
    const seen = new Set<number>();
    for (let j = off[e]; j + 1 < off[e + 1]; j++) {
      const ax = P[j * 2], ay = P[j * 2 + 1], bx = P[j * 2 + 2], by = P[j * 2 + 3];
      for (let ty = Math.floor(Math.min(ay, by)); ty <= Math.floor(Math.max(ay, by)); ty++)
        for (let tx = Math.floor(Math.min(ax, bx)); tx <= Math.floor(Math.max(ax, bx)); tx++) {
          const key = tileKey(tx, ty);
          if (seen.has(key)) continue;
          seen.add(key);
          let l = tiles.get(key);
          if (!l) tiles.set(key, (l = []));
          l.push(e);
        }
    }
  }
  return {
    n,
    ea: new Int32Array(ea),
    eb: new Int32Array(eb),
    eoff: off,
    pts: P,
    cum: new Float32Array(cum),
    elen: new Float32Array(elen),
    ewid: new Uint8Array(ewid),
    nodeX: new Float32Array(nx),
    nodeY: new Float32Array(ny),
    adj,
    tiles,
    M,
    covered: new Uint8Array(n),
  };
}

export interface RoadPoint {
  x: number;
  y: number;
  /** Unit direction of the road at that point, from the edge's start to its end (cells). */
  tx: number;
  ty: number;
}

/** The point `along` metres from edge e's start (clamped to the edge). */
export function pointAt(net: RoadNet, e: number, along: number, out: RoadPoint = { x: 0, y: 0, tx: 1, ty: 0 }): RoadPoint {
  const o = net.eoff[e], end = net.eoff[e + 1] - 1;
  const a = Math.max(0, Math.min(net.elen[e], along));
  let lo = o, hi = end;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (net.cum[mid] <= a) lo = mid;
    else hi = mid;
  }
  const seg = Math.max(1e-6, net.cum[hi] - net.cum[lo]);
  const t = Math.max(0, Math.min(1, (a - net.cum[lo]) / seg));
  const ax = net.pts[lo * 2], ay = net.pts[lo * 2 + 1], bx = net.pts[hi * 2], by = net.pts[hi * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.y = ay + (by - ay) * t;
  const L = Math.hypot(bx - ax, by - ay) || 1;
  out.tx = (bx - ax) / L;
  out.ty = (by - ay) / L;
  return out;
}

export interface RoadHit {
  edge: number;
  along: number;
  /** Distance in cells. */
  dist: number;
}

/** The road nearest to (x, y), within `range` cells (null if none). */
export function nearestRoad(net: RoadNet, x: number, y: number, range = 0.5): RoadHit | null {
  let best: RoadHit | null = null;
  let bd = range * range;
  const R = Math.ceil(range);
  const seen = new Set<number>();
  for (let ty = Math.floor(y) - R; ty <= Math.floor(y) + R; ty++)
    for (let tx = Math.floor(x) - R; tx <= Math.floor(x) + R; tx++) {
      const l = net.tiles.get(tileKey(tx, ty));
      if (!l) continue;
      for (const e of l) {
        if (seen.has(e)) continue;
        seen.add(e);
        for (let j = net.eoff[e]; j + 1 < net.eoff[e + 1]; j++) {
          const ax = net.pts[j * 2], ay = net.pts[j * 2 + 1], bx = net.pts[j * 2 + 2], by = net.pts[j * 2 + 3];
          const dx = bx - ax, dy = by - ay;
          const L2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
          const d = (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2;
          if (d < bd) {
            bd = d;
            best = { edge: e, along: net.cum[j] + (net.cum[j + 1] - net.cum[j]) * t, dist: 0 };
          }
        }
      }
    }
  if (best) best.dist = Math.sqrt(bd);
  return best;
}

/** The junction a car reaches driving edge e in direction dir (+1 = start to end). */
export const endNode = (net: RoadNet, e: number, dir: number) => (dir > 0 ? net.eb[e] : net.ea[e]);

/** Is (x, y) on a road's surface, or within `margin` metres of its edge? */
export function nearAsphalt(net: RoadNet, x: number, y: number, margin = 0): boolean {
  const R = 1;
  for (let ty = Math.floor(y) - R; ty <= Math.floor(y) + R; ty++)
    for (let tx = Math.floor(x) - R; tx <= Math.floor(x) + R; tx++) {
      const l = net.tiles.get(tileKey(tx, ty));
      if (!l) continue;
      for (const e of l) {
        const reach = (net.ewid[e] / 2 + margin) / net.M;
        const r2 = reach * reach;
        for (let j = net.eoff[e]; j + 1 < net.eoff[e + 1]; j++) {
          const ax = net.pts[j * 2], ay = net.pts[j * 2 + 1], bx = net.pts[j * 2 + 2], by = net.pts[j * 2 + 3];
          if (Math.min(ax, bx) - reach > x || Math.max(ax, bx) + reach < x || Math.min(ay, by) - reach > y || Math.max(ay, by) + reach < y) continue;
          const dx = bx - ax, dy = by - ay;
          const L2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
          if ((ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2 < r2) return true;
        }
      }
    }
  return false;
}
