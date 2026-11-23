// Street dressing, placed by rule along the OpenStreetMap streets (placeholder art, boxes):
// stop signs where a side street meets one as big or bigger, fire hydrants at some corners,
// wooden power poles with sagging wires along residential streets, and garbage carts out on
// the boulevard. Minneapolis really runs most power lines down the alleys; our map has no
// alleys, so the poles stand on the street (a simplification).
import * as THREE from 'three';
import { det, blocked, CELL_X, CELL_Y } from '../game/session';
import { query, TILE } from '../map/detail';
import { box } from './vehicles';
import { nearOtherRoad } from './props';

export type DressKind = 'stop' | 'hydrant' | 'pole' | 'cart';
export interface Dress {
  kind: DressKind;
  x: number; // map cells
  y: number;
  /** Unit direction it faces, in metres (x east, y south). */
  fx: number;
  fy: number;
  /** Poles: index of the next pole on the same street (for wires), or -1. */
  next: number;
  seed: number;
}

const hash = (n: number) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** The widest other street whose surface covers (x, y), with its direction; null if none.
 *  Streets running the same way (the same street split into two map pieces) do not count. */
function crossing(k: number, x: number, y: number, ux: number, uy: number): { w: number } | null {
  const s = det.roads;
  let best: { w: number } | null = null;
  for (const q of query(s, x - 0.3, y - 0.3, x + 0.3, y + 0.3)) {
    if (q === k) continue;
    const qo = s.off[q], qn = s.off[q + 1] - qo, half = s.meta[q] / 2;
    for (let i = 0; i + 1 < qn; i++) {
      const px = s.xy[(qo + i) * 2], py = s.xy[(qo + i) * 2 + 1];
      const ex = (s.xy[(qo + i + 1) * 2] - px) * CELL_X, ey = (s.xy[(qo + i + 1) * 2 + 1] - py) * CELL_Y;
      const el = Math.hypot(ex, ey) || 1;
      const wx = (x - px) * CELL_X, wy = (y - py) * CELL_Y;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (el * el)));
      if (Math.hypot(wx - ex * t, wy - ey * t) > half) continue;
      if (Math.abs((ex * ux + ey * uy) / el) > 0.85) continue; // same direction: a split, not a crossing
      if (!best || s.meta[q] > best.w) best = { w: s.meta[q] };
    }
  }
  return best;
}

export function dressingSpots(x0: number, y0: number): Dress[] {
  const s = det.roads;
  const out: Dress[] = [];
  const inTile = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + TILE && y < y0 + TILE && !blocked(x, y) && !nearOtherRoad(-1, x, y, 0.4);
  for (const k of query(s, x0 - 0.3, y0 - 0.3, x0 + TILE + 0.3, y0 + TILE + 0.3)) {
    const wm = s.meta[k];
    if (wm > 11 || det.bridgeRoads.has(k)) continue; // big streets: signals, not stop signs (not drawn yet)
    const o = s.off[k], n = s.off[k + 1] - o;
    const poleSide = hash(k * 5 + 1) < 0.5 ? 1 : -1;
    const poles = wm <= 8 && hash(k * 7 + 3) < 0.7;
    let lastPole = -1, sincePole = hash(k * 11) * 38, sinceCart = hash(k * 13) * 25;
    let inside = false, prevW = 0;
    for (let j = 0; j + 1 < n; j++) {
      const ax = s.xy[(o + j) * 2], ay = s.xy[(o + j) * 2 + 1];
      const lx = (s.xy[(o + j + 1) * 2] - ax) * CELL_X, ly = (s.xy[(o + j + 1) * 2 + 1] - ay) * CELL_Y;
      const len = Math.hypot(lx, ly);
      if (len < 0.5) continue;
      const ux = lx / len, uy = ly / len;
      const rx = -uy, ry = ux; // right-hand side of the direction of travel (y is south)
      const at = (d: number, side: number, off: number): [number, number] => [ax + (ux * d + rx * side * off) / CELL_X, ay + (uy * d + ry * side * off) / CELL_Y];
      for (let d = 0; d < len; d += 3) {
        const [cx, cy] = at(d, 0, 0);
        const c = crossing(k, cx, cy, ux, uy);
        const seed = hash(k * 977 + j * 131 + Math.floor(d));
        if (c && !inside && c.w >= wm) {
          // Arriving at a junction: a stop sign on the right, sometimes a hydrant on the left.
          const [sx, sy] = at(d - 3, 1, wm / 2 + 1.0);
          if (inTile(sx, sy)) out.push({ kind: 'stop', x: sx, y: sy, fx: -ux, fy: -uy, next: -1, seed });
          if (seed < 0.45) {
            const [hx, hy] = at(d - 4, -1, wm / 2 + 1.3);
            if (inTile(hx, hy)) out.push({ kind: 'hydrant', x: hx, y: hy, fx: rx, fy: ry, next: -1, seed });
          }
        } else if (!c && inside && prevW >= wm) {
          // Leaving it: the sign for traffic coming the other way.
          const [sx, sy] = at(d, -1, wm / 2 + 1.0);
          if (inTile(sx, sy)) out.push({ kind: 'stop', x: sx, y: sy, fx: ux, fy: uy, next: -1, seed });
        }
        inside = !!c;
        prevW = c ? c.w : 0;
        sincePole += 3;
        sinceCart += 3;
        if (poles && sincePole >= 38 && !c) {
          sincePole = 0;
          const [px, py] = at(d, poleSide, wm / 2 + 2.4);
          if (inTile(px, py) && !crossing(k, px, py, ux, uy)) {
            const prev = lastPole >= 0 ? out[lastPole] : null;
            if (prev && Math.hypot((prev.x - px) * CELL_X, (prev.y - py) * CELL_Y) < 48) prev.next = out.length;
            lastPole = out.length;
            out.push({ kind: 'pole', x: px, y: py, fx: ux, fy: uy, next: -1, seed });
          } else lastPole = -1;
        }
        if (wm <= 8 && sinceCart >= 25 && !c) {
          sinceCart = 0;
          if (seed > 0.82) {
            const side = seed > 0.91 ? 1 : -1;
            const [px, py] = at(d, side, wm / 2 + 1.6);
            if (inTile(px, py)) out.push({ kind: 'cart', x: px, y: py, fx: rx * side, fy: ry * side, next: -1, seed });
          }
        }
      }
    }
  }
  return out;
}

const S = 1.3; // drawn a little over life size, like the people and cars
const POLE_H = 9;

/** Coloured box geometries for the dressing, in local metres. */
export function dressingGeometry(items: Dress[], toLocal: (x: number, y: number, out: THREE.Vector3) => THREE.Vector3): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const p = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(S, S, S);
  const place = (parts: THREE.BufferGeometry[], x: number, y: number, fx: number, fy: number, scale = sc) => {
    toLocal(x, y, p);
    q.setFromAxisAngle(up, Math.atan2(fx, fy));
    m.compose(p, q, scale);
    for (const g of parts) out.push(g.applyMatrix4(m));
  };
  const top = (it: Dress) => toLocal(it.x, it.y, new THREE.Vector3()).setY(POLE_H * 0.95);
  for (const it of items) {
    if (it.kind === 'stop') {
      place([box(0.07, 2.1, 0.07, 0, 1.05, 0, 0x8a8a8c), box(0.62, 0.62, 0.04, 0, 2.05, 0.05, 0xb3161a), box(0.44, 0.12, 0.02, 0, 2.05, 0.08, 0xe8e4dc)], it.x, it.y, it.fx, it.fy);
    } else if (it.kind === 'hydrant') {
      place([box(0.24, 0.55, 0.24, 0, 0.28, 0, 0xa81c14), box(0.18, 0.12, 0.18, 0, 0.6, 0, 0xc8b020), box(0.44, 0.09, 0.1, 0, 0.42, 0, 0xa81c14)], it.x, it.y, it.fx, it.fy);
    } else if (it.kind === 'cart') {
      const col = it.seed > 0.9 ? 0x23407a : 0x1c1c1e; // recycling blue or garbage black (placeholder colours)
      place([box(0.62, 0.95, 0.72, 0, 0.48, 0, col), box(0.68, 0.08, 0.8, 0, 0.99, -0.02, col), box(0.64, 0.1, 0.1, 0, 0.1, -0.34, 0x101012)], it.x, it.y, it.fx, it.fy);
    } else {
      const parts = [box(0.28, POLE_H, 0.28, 0, POLE_H / 2, 0, 0x4a3a2a), box(2.2, 0.14, 0.14, 0, POLE_H * 0.95, 0, 0x3a2e22)];
      if (it.seed < 0.3) parts.push(box(0.5, 0.75, 0.5, 0.3, POLE_H * 0.8, 0, 0x6a6c70)); // transformer
      // Crossarm runs across the street; wires run along it.
      place(parts, it.x, it.y, it.fx, it.fy, new THREE.Vector3(1, 1, 1));
      if (it.next >= 0) {
        const a = top(it), b = top(items[it.next]);
        const ax = new THREE.Vector3(it.fy, 0, -it.fx).normalize(); // along the crossarm (local x, z)
        for (const off of [-0.95, 0, 0.95]) {
          const a2 = a.clone().addScaledVector(ax, off).setY(a.y + 0.1), b2 = b.clone().addScaledVector(ax, off).setY(b.y + 0.1);
          const mid = a2.clone().lerp(b2, 0.5).setY(a2.y - 0.8); // sag
          for (const [u, v] of [[a2, mid], [mid, b2]]) {
            const L = u.distanceTo(v);
            const g = box(0.1, 0.1, L, 0, 0, 0, 0x0c0c0e);
            const c = u.clone().lerp(v, 0.5);
            m.lookAt(u, v, up);
            m.setPosition(c);
            out.push(g.applyMatrix4(m));
          }
        }
      }
    }
  }
  return out;
}
