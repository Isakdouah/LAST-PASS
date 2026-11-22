// Houses up close: a small building footprint (under 9 m tall, roughly a rectangle)
// becomes a Minneapolis house: a pitched roof with shingles, a chimney on some, a front
// porch with a door facing the nearest street, and a porch light. Big buildings keep
// their flat roofs. Everything is built from simple shapes in code (placeholder art).
//
// Parts carry a kind number the building shader reads (aK):
//   0 = wall or flat roof (as before), 6 = house wall (siding, trim round windows),
//   1 = pitched roof, 2 = painted trim (porch), 3 = chimney brick, 4 = door, 5 = porch light.
import * as THREE from 'three';

export const K = { wall: 0, roof: 1, trim: 2, brick: 3, door: 4, lamp: 5, house: 6 } as const;

export interface Buf {
  P: number[];
  N: number[];
  U: number[];
  S: number[];
  H: number[];
  K: number[];
  I: number[];
}

/** One triangle with a given outward normal; the winding is fixed to face that way. */
export function tri(b: Buf, a: number[], c: number[], d: number[], n: number[], seed: number, kind: number, h = 0, u = [0, 0, 0]) {
  const base = b.P.length / 3;
  b.P.push(...a, ...c, ...d);
  for (let q = 0; q < 3; q++) b.N.push(n[0], n[1], n[2]), b.S.push(seed), b.H.push(h), b.K.push(kind);
  b.U.push(u[0], u[1], u[2]);
  const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
  if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) b.I.push(base, base + 1, base + 2);
  else b.I.push(base, base + 2, base + 1);
}

export function quad(b: Buf, a: number[], c: number[], d: number[], e: number[], n: number[], seed: number, kind: number, h = 0) {
  tri(b, a, c, d, n, seed, kind, h);
  tri(b, a, d, e, n, seed, kind, h);
}

/** An axis-free box: centre (x, y, z), half sizes along unit dir (fx, fz), across, and up. */
export function box(b: Buf, x: number, y0: number, z: number, fx: number, fz: number, hl: number, hw: number, ht: number, seed: number, kind: number, skipBottom = true) {
  const rx = -fz, rz = fx; // across
  const c = (sl: number, sw: number, up: number) => [x + fx * hl * sl + rx * hw * sw, y0 + up, z + fz * hl * sl + rz * hw * sw];
  const top = 2 * ht;
  quad(b, c(-1, -1, top), c(1, -1, top), c(1, 1, top), c(-1, 1, top), [0, 1, 0], seed, kind);
  if (!skipBottom) quad(b, c(-1, -1, 0), c(1, -1, 0), c(1, 1, 0), c(-1, 1, 0), [0, -1, 0], seed, kind);
  quad(b, c(1, -1, 0), c(1, 1, 0), c(1, 1, top), c(1, -1, top), [fx, 0, fz], seed, kind);
  quad(b, c(-1, -1, 0), c(-1, 1, 0), c(-1, 1, top), c(-1, -1, top), [-fx, 0, -fz], seed, kind);
  quad(b, c(-1, 1, 0), c(1, 1, 0), c(1, 1, top), c(-1, 1, top), [rx, 0, rz], seed, kind);
  quad(b, c(-1, -1, 0), c(1, -1, 0), c(1, -1, top), c(-1, -1, top), [-rx, 0, -rz], seed, kind);
}

export interface HouseFit {
  /** Unit long axis (x, z), centre, half length and half width (metres). */
  ax: number;
  az: number;
  cx: number;
  cz: number;
  hl: number;
  hw: number;
}

/** Fit an oriented rectangle along the longest wall; null if the footprint is not house-like. */
export function fitHouse(ring: THREE.Vector2[], h: number): HouseFit | null {
  if (h > 9 || ring.length > 8) return null;
  let best = 0, ax = 1, az = 0, area = 0;
  for (let j = 0; j < ring.length; j++) {
    const a = ring[j], b = ring[(j + 1) % ring.length];
    const l = a.distanceTo(b);
    area += a.x * b.y - b.x * a.y;
    if (l > best) (best = l), (ax = (b.x - a.x) / l), (az = (b.y - a.y) / l);
  }
  area = Math.abs(area) / 2;
  if (area < 30 || area > 320) return null;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of ring) {
    const u = p.x * ax + p.y * az, v = -p.x * az + p.y * ax;
    u0 = Math.min(u0, u), u1 = Math.max(u1, u), v0 = Math.min(v0, v), v1 = Math.max(v1, v);
  }
  if ((u1 - u0) * (v1 - v0) > area * 1.25) return null; // an L or odd shape: keep it flat
  let hl = (u1 - u0) / 2, hw = (v1 - v0) / 2;
  let um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  if (hw > hl) {
    // Make the ridge run the long way.
    [hl, hw] = [hw, hl];
    const nax = -az, naz = ax;
    const nu = vm, nv = -um; // the same centre, in the turned frame
    (ax = nax), (az = naz), (um = nu), (vm = nv);
  }
  // Centre back in x/z: p = u * axis + v * across, across = (-az, ax).
  const cx = um * ax - vm * az, cz = um * az + vm * ax;
  return { ax, az, cx, cz, hl, hw };
}

/** Roof, chimney, porch, door and light for one house. `front` = unit x/z toward the street. */
export function addHouse(b: Buf, f: HouseFit, h: number, seed: number, front: [number, number] | null) {
  const { ax, az, cx, cz, hl, hw } = f;
  const rx = -az, rz = ax;
  const o = 0.4; // eaves
  const rise = Math.min(4, hw * (0.6 + 0.35 * seed)); // steep Minnesota roofs (snow)
  const P = (u: number, v: number, y: number) => [cx + ax * u + rx * v, y, cz + az * u + rz * v];
  const slope = rise / hw;
  // Two roof planes over the ridge, overhanging the walls.
  const ny = 1 / Math.hypot(1, slope), nh = slope * ny;
  const eave = h - o * slope;
  quad(b, P(-hl - o, hw + o, eave), P(hl + o, hw + o, eave), P(hl + o, 0, h + rise), P(-hl - o, 0, h + rise), [rx * nh, ny, rz * nh], seed, K.roof);
  quad(b, P(-hl - o, -hw - o, eave), P(hl + o, -hw - o, eave), P(hl + o, 0, h + rise), P(-hl - o, 0, h + rise), [-rx * nh, ny, -rz * nh], seed, K.roof);
  // Roof undersides (seen from below at a low camera): dark.
  quad(b, P(-hl - o, hw + o, eave - 0.05), P(hl + o, hw + o, eave - 0.05), P(hl + o, 0, h + rise - 0.05), P(-hl - o, 0, h + rise - 0.05), [0, -1, 0], seed, K.brick);
  // Gable ends: house wall, no windows (height 0).
  tri(b, P(hl, -hw, h), P(hl, hw, h), P(hl, 0, h + rise), [ax, 0, az], seed, K.house);
  tri(b, P(-hl, -hw, h), P(-hl, hw, h), P(-hl, 0, h + rise), [-ax, 0, -az], seed, K.house);
  // Chimney on about half.
  if (seed > 0.45) {
    const [x, , z] = P((seed - 0.7) * hl * 1.4, hw * 0.25, 0);
    box(b, x, h - 0.5, z, ax, az, 0.35, 0.35, (rise + 1.3) / 2, seed, K.brick);
  }
  if (!front) return;
  // The front: which side of the rectangle faces the street.
  const dl = front[0] * ax + front[1] * az, dw = front[0] * rx + front[1] * rz;
  let nx: number, nz: number, half: number, along: number;
  if (Math.abs(dl) > Math.abs(dw)) (nx = ax * Math.sign(dl)), (nz = az * Math.sign(dl)), (half = hl), (along = hw);
  else (nx = rx * Math.sign(dw)), (nz = rz * Math.sign(dw)), (half = hw), (along = hl);
  const tx = -nz, tz = nx; // along the front wall
  const fx = cx + nx * half, fz = cz + nz * half; // middle of the front wall
  const pw = Math.min(along * 0.75, 4.5); // porch half... full width
  const off = (seed - 0.5) * (along - pw / 2) * 0.8; // porch not always centred
  const px = fx + tx * off, pz = fz + tz * off;
  const deep = 2.2;
  // Porch floor, posts, roof.
  box(b, px + nx * deep / 2, 0, pz + nz * deep / 2, nx, nz, deep / 2, pw / 2, 0.25, seed, K.trim);
  box(b, px + nx * (deep + 0.35), 0, pz + nz * (deep + 0.35), nx, nz, 0.35, 0.6, 0.12, seed, K.trim); // step
  for (const sgn of [-1, 1]) box(b, px + nx * (deep - 0.12) + tx * sgn * (pw / 2 - 0.12), 0.5, pz + nz * (deep - 0.12) + tz * sgn * (pw / 2 - 0.12), nx, nz, 0.08, 0.08, 1.1, seed, K.trim);
  box(b, px + nx * deep / 2, 2.7, pz + nz * deep / 2, nx, nz, deep / 2 + 0.2, pw / 2 + 0.2, 0.08, seed, K.roof);
  // Door and the light beside it.
  box(b, px + nx * 0.03 + tx * 0.6, 0.5, pz + nz * 0.03 + tz * 0.6, nx, nz, 0.05, 0.48, 1.05, seed, K.door);
  box(b, px + nx * 0.08 + tx * 1.25, 2.0, pz + nz * 0.08 + tz * 1.25, nx, nz, 0.08, 0.1, 0.12, seed, K.lamp);
}
