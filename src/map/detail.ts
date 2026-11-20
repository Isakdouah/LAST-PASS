// Street-level detail (tools/build_detail.py): building outlines with heights, road lines,
// water and parks. Decoded once into flat arrays, with a tile index so drawing only
// touches what is on screen.
export interface ShapeFile {
  count: number;
  starts: string;
  lens: string;
  steps: string;
  meta: string;
}
export interface DetailFile {
  q: number;
  buildings: ShapeFile;
  roads: ShapeFile;
  water: ShapeFile;
  parks: ShapeFile;
  names: Record<string, string>;
  places: [number, number, string, string][];
}

export interface Shapes {
  count: number;
  /** Start index into xy (in points) for shape k; shape k has off[k+1]-off[k] points. */
  off: Uint32Array;
  /** Points in map cells: x0,y0,x1,y1,... */
  xy: Float32Array;
  meta: Uint8Array;
  /** Bounding boxes: minx,miny,maxx,maxy per shape. */
  box: Float32Array;
  /** Tile index: TILE x TILE cells per tile; lists of shape ids. */
  tiles: Map<number, number[]>;
}

export const TILE = 8;

function b64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeShapes(f: ShapeFile, q: number): Shapes {
  const sb = b64(f.starts);
  const starts = new Int16Array(sb.buffer, sb.byteOffset, sb.length / 2);
  const lb = b64(f.lens);
  const lens = new Uint16Array(lb.buffer, lb.byteOffset, lb.length / 2);
  const st = b64(f.steps);
  const steps = new Int8Array(st.buffer, st.byteOffset, st.length);
  const meta = b64(f.meta);
  const n = f.count;
  const off = new Uint32Array(n + 1);
  let total = 0;
  for (let k = 0; k < n; k++) {
    off[k] = total;
    total += lens[k] + 1;
  }
  off[n] = total;
  const xy = new Float32Array(total * 2);
  const box = new Float32Array(n * 4);
  const tiles = new Map<number, number[]>();
  let si = 0;
  for (let k = 0; k < n; k++) {
    let x = starts[k * 2];
    let y = starts[k * 2 + 1];
    let o = off[k] * 2;
    let minx = x, miny = y, maxx = x, maxy = y;
    xy[o++] = x / q;
    xy[o++] = y / q;
    for (let j = 0; j < lens[k]; j++) {
      x += steps[si++];
      y += steps[si++];
      xy[o++] = x / q;
      xy[o++] = y / q;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
    box[k * 4] = minx / q;
    box[k * 4 + 1] = miny / q;
    box[k * 4 + 2] = maxx / q;
    box[k * 4 + 3] = maxy / q;
    for (let ty = Math.floor(miny / q / TILE); ty <= Math.floor(maxy / q / TILE); ty++)
      for (let tx = Math.floor(minx / q / TILE); tx <= Math.floor(maxx / q / TILE); tx++) {
        const key = ty * 1000 + tx;
        let l = tiles.get(key);
        if (!l) tiles.set(key, (l = []));
        l.push(k);
      }
  }
  return { count: n, off, xy, meta, box, tiles };
}

/** Shape ids whose tiles touch the rectangle (in cells), each once, in id order. */
export function query(s: Shapes, x0: number, y0: number, x1: number, y1: number): number[] {
  const seen = new Set<number>();
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++)
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
      const l = s.tiles.get(ty * 1000 + tx);
      if (!l) continue;
      for (const k of l) {
        if (s.box[k * 4 + 2] < x0 || s.box[k * 4] > x1 || s.box[k * 4 + 3] < y0 || s.box[k * 4 + 1] > y1) continue;
        seen.add(k);
      }
    }
  return [...seen].sort((a, b) => a - b);
}

export interface Detail {
  buildings: Shapes; // meta = height in metres
  roads: Shapes; // meta = width in metres
  water: Shapes; // meta 1 = hole (island)
  parks: Shapes;
  names: Map<number, string>;
}

export function loadDetail(f: DetailFile): Detail {
  const names = new Map<number, string>();
  for (const [k, v] of Object.entries(f.names)) names.set(Number(k), v);
  return {
    buildings: decodeShapes(f.buildings, f.q),
    roads: decodeShapes(f.roads, f.q),
    water: decodeShapes(f.water, f.q),
    parks: decodeShapes(f.parks, f.q),
    names,
  };
}
