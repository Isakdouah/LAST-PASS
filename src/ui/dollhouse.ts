// The dollhouse: a cut-away sketch of the building a hero is in, floor by floor. It is drawn
// from what they tell you on the radio, so floors you have no news of stay grey. With the
// thermal camera on you also see warm shapes on every floor (but not who they are).
// Pixel art on a tiny canvas, shown big with nearest-neighbour scaling. PLACEHOLDER art.
import type { Building } from '../sim/building';

function hash(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function drawDollhouse(b: Building, heroHere: boolean, thermal: boolean, time: number): HTMLCanvasElement {
  const FH = 18, W = 220, top = 10, left = 22, bw = 186;
  const H = top + b.floors.length * FH + 6;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  px(0, 0, W, H, '#10131c');
  const stairX = left + bw - 24;
  const n = b.floors.length;
  for (let k = 0; k < n; k++) {
    const f = b.floors[k];
    const y = top + (n - 1 - k) * FH; // ground floor at the bottom
    const known = b.known[k];
    // Floor label.
    g.fillStyle = known ? '#c8c2b0' : '#5a5e6a';
    g.font = '8px monospace';
    g.fillText(`${k + 1}F`, 3, y + 12);
    // Rooms: lit if known, grey dither if not.
    px(left, y, bw, FH, known ? '#2a2418' : '#22252e');
    if (!known) for (let yy = 0; yy < FH; yy += 2) for (let xx = (yy / 2) % 2; xx < bw; xx += 2) px(left + xx, y + yy, 1, 1, '#2c303a');
    const rw = (stairX - left) / f.rooms;
    for (let r = 1; r < f.rooms; r++) px(left + r * rw, y + 3, 1, FH - 3, '#4a4a50'); // room walls (doorways at the bottom left open)
    // The stairwell: a zig-zag on the right.
    px(stairX, y, 1, FH, '#4a4a50');
    for (let s = 0; s < 6; s++) px(stairX + 3 + s * 3, y + FH - 3 - s * 2.4, 3, 1, '#6a6458');
    // Barricade on the stairwell door.
    if (known && f.barricade > 0.3) px(stairX - 3, y + 6, 3, FH - 7, f.barricade > 0.7 ? '#8a5a2a' : '#5a3a1a');
    // Slab.
    px(left, y + FH - 1, bw, 2, '#5a5c64');
    // People and the dead.
    const dots = (count: number, col: string, salt: number, stairs = false) => {
      const nDots = Math.min(28, Math.round(count / 3 + (count > 0.3 ? 0.5 : 0)));
      for (let d = 0; d < nDots; d++) {
        const h1 = hash(k * 977 + d * 31 + salt), h2 = hash(k * 131 + d * 17 + salt * 3);
        const jx = Math.sin(time * (1 + h1) + h2 * 9) * 1.2;
        const x = stairs && d % 3 === 0 ? stairX + 4 + h1 * 16 : left + 3 + h1 * (stairX - left - 6) + jx;
        px(x, y + 6 + h2 * (FH - 10), 2, 3, col);
      }
    };
    if (known) {
      dots(f.living, '#e8e6dc', 1);
      dots(f.dead, '#70dc50', 2, true);
      if (heroHere && k === b.heroFloor) {
        px(stairX - 10, y + 5, 3, 4, '#ffd640');
        px(stairX - 13, y + 2, 9, 1, '#ffd640');
      }
    } else if (thermal) {
      // Warm shapes only: someone is there, but you cannot tell who.
      dots(f.living + f.dead * 0.2, '#c86a2a', 3);
    }
  }
  // Roof and ground.
  px(left - 2, top - 3, bw + 4, 3, '#5a5c64');
  px(0, H - 5, W, 5, '#2a2620');
  return c;
}
