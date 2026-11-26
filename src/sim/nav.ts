// Finding the way on foot. A grid over the street area says where a person can stand
// (not inside a building, not in the river). From it, "distance fields" are worked out:
// for every square, how far it is (walking round buildings, not through them) to the
// nearest living person, the nearest of the dead, or the nearest safe place. Anyone can
// then find their way by stepping to the neighbouring square that is closer: the dead
// pour round corners toward the living, people run toward safety, police close in until
// they can see what they are shooting at.
// The grid is finer when the area is small (close up) and coarser when it is big.
export interface Nav {
  /** Top-left corner, in map cells. */
  x0: number;
  y0: number;
  /** Size of one square in map cells, and the grid size. */
  res: number;
  W: number;
  H: number;
  /** 1 = cannot stand here. */
  wall: Uint8Array;
}

/** A field: walking distance in fifths of a square (5 straight, 7 diagonal). UNREACHED far away. */
export const UNREACHED = 65535;
const ORTHO = 5, DIAG = 7;

export function buildNav(x0: number, y0: number, w: number, h: number, metresPerCell: number, blocked: (x: number, y: number) => boolean, maxSquares = 640): Nav {
  // About 1.25 m squares close up; never more than maxSquares across.
  const res = Math.max(1.25 / metresPerCell, Math.max(w, h) / maxSquares);
  const W = Math.ceil(w / res), H = Math.ceil(h / res);
  const wall = new Uint8Array(W * H);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const cx = x0 + (X + 0.5) * res, cy = y0 + (Y + 0.5) * res;
      if (blocked(cx, cy)) wall[Y * W + X] = 1;
    }
  return { x0, y0, res, W, H, wall };
}

export const navIndex = (n: Nav, x: number, y: number): number => {
  const X = Math.floor((x - n.x0) / n.res), Y = Math.floor((y - n.y0) / n.res);
  return X < 0 || Y < 0 || X >= n.W || Y >= n.H ? -1 : Y * n.W + X;
};

/**
 * Walking distance from the nearest source, round walls. `extra` (optional) adds cost per
 * square (danger). Stops spreading past `maxDist` (in squares), which keeps it quick.
 * A bucket queue: costs are small whole numbers, so no sorting is needed.
 */
export function field(n: Nav, sources: { x: number; y: number }[], maxDist = 400, extra?: Uint8Array, out?: Uint16Array): Uint16Array {
  const N = n.W * n.H;
  const dist = out && out.length === N ? out : new Uint16Array(N);
  dist.fill(UNREACHED);
  const cap = Math.min(UNREACHED - 64, Math.round(maxDist * ORTHO));
  const SIZE = 64; // bucket ring (bigger than any one step cost)
  const buckets: number[][] = Array.from({ length: SIZE }, () => []);
  let pending = 0;
  for (const s of sources) {
    let i = navIndex(n, s.x, s.y);
    if (i < 0) continue;
    if (n.wall[i]) i = nearestFree(n, i);
    if (i < 0 || dist[i] === 0) continue;
    dist[i] = 0;
    buckets[0].push(i);
    pending++;
  }
  const W = n.W, H = n.H, wall = n.wall;
  for (let d = 0; pending > 0 && d <= cap; d++) {
    const b = buckets[d % SIZE];
    while (b.length) {
      const i = b.pop()!;
      pending--;
      if (dist[i] !== d) continue;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const j = ny * W + nx;
          if (wall[j]) continue;
          // No cutting a corner between two walls.
          if (dx && dy && (wall[y * W + nx] || wall[ny * W + x])) continue;
          const nd = d + (dx && dy ? DIAG : ORTHO) + (extra ? extra[j] : 0);
          if (nd < dist[j] && nd <= cap) {
            dist[j] = nd;
            buckets[nd % SIZE].push(j);
            pending++;
          }
        }
      }
    }
  }
  return dist;
}

function nearestFree(n: Nav, i: number): number {
  const x = i % n.W, y = (i / n.W) | 0;
  for (let r = 1; r < 12; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < n.W && Y < n.H && !n.wall[Y * n.W + X]) return Y * n.W + X;
      }
  return -1;
}

/**
 * Which way to step to get closer (down = true) or further (down = false) along a field.
 * Returns a unit direction in map cells, or null when there is no better neighbour
 * (arrived, or out of the field's reach). Looks one square around, plus the square the
 * person stands in, so the way out of a doorway is found too.
 */
export function follow(n: Nav, f: Uint16Array, x: number, y: number, down = true): [number, number] | null {
  let i = navIndex(n, x, y);
  if (i < 0) return null;
  if (n.wall[i]) {
    const j = nearestFree(n, i);
    if (j < 0) return null;
    const cx = n.x0 + ((j % n.W) + 0.5) * n.res, cy = n.y0 + (((j / n.W) | 0) + 0.5) * n.res;
    const l = Math.hypot(cx - x, cy - y) || 1;
    return [(cx - x) / l, (cy - y) / l];
  }
  const here = f[i];
  if (here === UNREACHED) return null;
  const W = n.W, X = i % W, Y = (i / W) | 0;
  let best = here, bx = 0, by = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = X + dx, ny = Y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= n.H) continue;
      const j = ny * W + nx;
      if (n.wall[j] || f[j] === UNREACHED) continue;
      if (dx && dy && (n.wall[Y * W + nx] || n.wall[ny * W + X])) continue;
      const v = f[j];
      if (down ? v < best : v > best) (best = v), (bx = dx), (by = dy);
    }
  if (!bx && !by) return null;
  // Aim at the middle of the better square: keeps people off the walls' edges.
  const tx = n.x0 + (X + bx + 0.5) * n.res, ty = n.y0 + (Y + by + 0.5) * n.res;
  const l = Math.hypot(tx - x, ty - y) || 1;
  return [(tx - x) / l, (ty - y) / l];
}

/** Value of a field where someone stands (UNREACHED off the grid). */
export function at(n: Nav, f: Uint16Array, x: number, y: number): number {
  const i = navIndex(n, x, y);
  return i < 0 ? UNREACHED : f[i];
}

/** Can a person at a see b (no building between)? Steps along the line square by square. */
export function sees(n: Nav, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const steps = Math.ceil((Math.hypot(dx, dy) / n.res) * 1.5);
  for (let k = 1; k < steps; k++) {
    const i = navIndex(n, ax + (dx * k) / steps, ay + (dy * k) / steps);
    if (i >= 0 && n.wall[i]) return false;
  }
  return true;
}
