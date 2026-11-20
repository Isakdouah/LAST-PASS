// Town names on the globe, like a map app: the big cities from far away, then smaller
// towns and villages as you zoom in. Names never overlap; bigger places win a spot.
// Data: every place over 1,000 people (GeoNames, CC BY 4.0), from tools/build_labels.py.
import * as THREE from 'three';
import labelsFile from '../data/labels.json';
import { ecef, latLonOf, R_EARTH } from './geo';

export interface PlaceName {
  lat: number;
  lon: number;
  /** log-population code: 0 = 1,000 people, 50 = 10,000, 100 = 100k, 150 = 1M, 200 = 10M. */
  code: number;
  name: string;
}

export function decodeNames(f: { n: number; pts: string; names: string }): PlaceName[] {
  const bin = atob(f.pts);
  const dv = new DataView(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer);
  const names = f.names.split('|');
  const out: PlaceName[] = [];
  for (let k = 0; k < f.n; k++) {
    const o = k * 5;
    out.push({ lat: dv.getInt16(o, true) / 100, lon: dv.getInt16(o + 2, true) / 100, code: dv.getUint8(o + 4), name: names[k] });
  }
  return out;
}

export const popOfCode = (code: number) => Math.pow(10, 3 + code / 50);

/** Smallest place worth a name at this zoom (km of ground per screen pixel). */
export function minPopulation(kmPerPx: number): number {
  return Math.max(1000, 5000 * Math.pow(kmPerPx, 1.6));
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Placed {
  i: number;
  x: number;
  y: number;
}

const CELL = 2; // degrees

export class LabelPicker {
  private grid = new Map<number, number[]>();
  private v = new THREE.Vector3();
  constructor(public list: PlaceName[]) {
    // Each grid cell keeps its places biggest first (the list is already sorted that way).
    list.forEach((p, i) => {
      const key = this.key(Math.floor((p.lat + 90) / CELL), Math.floor((p.lon + 180) / CELL));
      let a = this.grid.get(key);
      if (!a) this.grid.set(key, (a = []));
      a.push(i);
    });
  }
  private key(r: number, c: number) {
    const cols = 360 / CELL;
    return r * cols + (((c % cols) + cols) % cols);
  }

  /**
   * Choose which names to show. `project` turns an Earth-fixed point (km) into screen
   * pixels, or null when it is behind the camera. Returns at most `max` labels, biggest
   * places first, none overlapping, none on the far side of the planet.
   */
  pick(camPos: THREE.Vector3, project: (v: THREE.Vector3) => { x: number; y: number } | null, W: number, H: number, fov: number, max = 60, skip?: Set<string>, avoid: Box[] = []): Placed[] {
    const alt = Math.max(0.1, camPos.length() - R_EARTH);
    const kmPerPx = (2 * alt * Math.tan((fov * Math.PI) / 360)) / H;
    const minCode = Math.max(0, (Math.log10(minPopulation(kmPerPx)) - 3) * 50);
    // Ground the camera can see: up to the horizon, and not far past the picture.
    const horizon = R_EARTH * Math.acos(R_EARTH / (R_EARTH + alt));
    const reachKm = Math.min(horizon, alt * (alt > 200 ? 1 : 3) + 60);
    const { lat, lon } = latLonOf(camPos);
    const dLat = reachKm / 111.2;
    const r0 = Math.max(0, Math.floor((lat - dLat + 90) / CELL));
    const r1 = Math.min(180 / CELL - 1, Math.floor((lat + dLat + 90) / CELL));
    const cosMin = Math.max(0.05, Math.cos((Math.min(89, Math.abs(lat) + dLat) * Math.PI) / 180));
    const dLon = Math.min(180, reachKm / (111.2 * cosMin));
    const c0 = Math.floor((lon - dLon + 180) / CELL), c1 = Math.floor((lon + dLon + 180) / CELL);
    const cand: number[] = [];
    const seen = new Set<number>();
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= Math.min(c1, c0 + 360 / CELL - 1); c++) {
        const key = this.key(r, c);
        if (seen.has(key)) continue;
        seen.add(key);
        const a = this.grid.get(key);
        if (!a) continue;
        for (const i of a) {
          if (this.list[i].code < minCode) break;
          cand.push(i);
        }
      }
    cand.sort((a, b) => this.list[b].code - this.list[a].code || a - b);
    // Only the biggest few hundred can ever win a spot: skip testing the rest (speed).
    if (cand.length > 800) cand.length = 800;
    // Screen areas already taken (the clock, the radio, other labels): x0, y0, x1, y1.
    const boxes: number[] = avoid.flatMap((b) => [b.x0, b.y0, b.x1, b.y1]);
    const out: Placed[] = [];
    const v = this.v;
    for (const i of cand) {
      const p = this.list[i];
      if (skip?.has(p.name)) continue;
      ecef(p.lat, p.lon, 0, v);
      // Far side of the planet: hidden.
      const toCam = (camPos.x - v.x) * v.x + (camPos.y - v.y) * v.y + (camPos.z - v.z) * v.z;
      if (toCam <= 0) continue;
      const s = project(v);
      if (!s || s.x < 4 || s.x > W - 4 || s.y < 18 || s.y > H - 4) continue;
      const w = labelWidth(p.name, p.code) / 2 + 3;
      const x0 = s.x - w, x1 = s.x + w, y0 = s.y - 17, y1 = s.y + 2;
      let hit = false;
      for (let b = 0; b < boxes.length && !hit; b += 4) hit = x0 < boxes[b + 2] && x1 > boxes[b] && y0 < boxes[b + 3] && y1 > boxes[b + 1];
      if (hit) continue;
      boxes.push(x0, y0, x1, y1);
      out.push({ i, x: s.x, y: s.y });
      if (out.length >= max) break;
    }
    return out;
  }
}

/** Rough width in pixels of a label in the 12 px pixel font. */
export const labelWidth = (name: string, code: number) => name.length * (code >= BIG ? 8 : 7) + 4;
/** About a million people: drawn in capitals. */
export const BIG = 150;

let shared: LabelPicker | null = null;
export const worldNames = () => (shared ??= new LabelPicker(decodeNames(labelsFile as unknown as { n: number; pts: string; names: string })));
