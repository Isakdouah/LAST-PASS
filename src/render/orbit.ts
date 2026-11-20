// The view from the station: the Earth below, lit by the Sun on one side and dark on
// the other, with the Twin Cities glowing when they are in sight. Land outline from a
// coarse world land mask (global-land-mask package, GLOBE data).
import globeFile from '../data/globe.json';
import { MPLS } from '../game/clock';
import { BAYER, RGB } from './palette';

const G = globeFile as { w: number; h: number; land: string };
const landBits = (() => {
  const bin = atob(G.land);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
})();
function isLand(lat: number, lon: number): boolean {
  const y = Math.min(G.h - 1, Math.max(0, Math.floor((90 - lat) * 2)));
  const x = (((Math.floor((lon + 180) * 2) % G.w) + G.w) % G.w);
  const i = y * G.w + x;
  return ((landBits[i >> 3] >> (7 - (i & 7))) & 1) === 1;
}
// Cheap value noise for clouds.
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export interface OrbitView {
  sub: { lat: number; lon: number };
  /** Hours UTC, for the Sun. */
  utc: number;
  /** 0..1 how much of the city still has power (glow). */
  cityLight: number;
  cityFire: number;
}

const D = Math.PI / 180;
const DECL = -9 * D; // Sun declination in mid-October

/** Projection set-up shared by drawing and by markers. */
function frame(v: OrbitView, vw: number, vh: number) {
  const R = 210;
  const cx = vw / 2;
  const cy = vh - 40 + R * 0.38;
  const lat0 = (v.sub.lat + 14) * D; // look ahead (north-east) so the horizon shows
  const lon0 = (v.sub.lon + 10) * D;
  return { R, cx, cy, lat0, lon0 };
}

export function project(v: OrbitView, vw: number, vh: number, lat: number, lon: number): { x: number; y: number; visible: boolean } {
  const { R, cx, cy, lat0, lon0 } = frame(v, vw, vh);
  const p = lat * D, l = lon * D;
  const cosc = Math.sin(lat0) * Math.sin(p) + Math.cos(lat0) * Math.cos(p) * Math.cos(l - lon0);
  const x = R * Math.cos(p) * Math.sin(l - lon0);
  const y = R * (Math.cos(lat0) * Math.sin(p) - Math.sin(lat0) * Math.cos(p) * Math.cos(l - lon0));
  return { x: cx + x, y: cy - y, visible: cosc > 0 };
}

export function drawOrbit(put: (x: number, y: number, c: RGB) => void, ox: number, oy: number, vw: number, vh: number, v: OrbitView, time: number): void {
  const { R, cx, cy, lat0, lon0 } = frame(v, vw, vh);
  const sunLon = (12 - v.utc) * 15 * D;
  const sx = Math.cos(DECL) * Math.cos(sunLon), sy = Math.cos(DECL) * Math.sin(sunLon), sz = Math.sin(DECL);
  const sl0 = Math.sin(lat0), cl0 = Math.cos(lat0);
  for (let py = 0; py < vh; py++)
    for (let px = 0; px < vw; px++) {
      const t = BAYER[((py + oy) % 4) * 4 + ((px + ox) % 4)];
      const u = (px - cx) / R;
      const w = -(py - cy) / R;
      const rr = u * u + w * w;
      if (rr > 1) {
        // Space, a thin blue limb of atmosphere, and stars.
        const edge = Math.sqrt(rr) - 1;
        if (edge < 0.012) put(px + ox, py + oy, [40, 80, 150]);
        else put(px + ox, py + oy, hash(px, py) > 0.997 ? [150, 150, 170] : [4, 5, 10]);
        continue;
      }
      const z = Math.sqrt(1 - rr);
      const lat = Math.asin(w * cl0 + z * sl0);
      const lon = lon0 + Math.atan2(u, z * cl0 - w * sl0);
      const ex = Math.cos(lat) * Math.cos(lon), ey = Math.cos(lat) * Math.sin(lon), ez = Math.sin(lat);
      const sun = ex * sx + ey * sy + ez * sz; // >0 = day
      const latD = lat / D, lonD = lon / D;
      const land = isLand(latD, lonD);
      const cloud = noise(lonD * 0.25 + time * 0.002, latD * 0.35) * 0.65 + noise(lonD * 0.9, latD * 0.9 + time * 0.003) * 0.35;
      let c: RGB;
      if (sun > 0.03) {
        c = land ? (Math.abs(latD) > 62 ? [190, 196, 200] : [70, 82, 52]) : [22, 52, 96];
        if (cloud > 0.62 && cloud - 0.62 > t * 0.25) c = [200, 204, 210];
        if (sun < 0.15 && t > sun / 0.15) c = [c[0] * 0.5, c[1] * 0.5, c[2] * 0.6];
      } else {
        c = land ? [16, 18, 24] : [6, 8, 16];
        if (cloud > 0.66 && cloud - 0.66 > t * 0.3) c = [22, 24, 32];
      }
      // Limb haze.
      if (z < 0.18 && t > z / 0.18) c = [36, 64, 110];
      put(px + ox, py + oy, c);
    }
  // The Twin Cities: a glow made of their remaining lights, and fires.
  const m = project(v, vw, vh, MPLS.lat, MPLS.lon);
  if (m.visible) {
    for (let k = 0; k < 40; k++) {
      const a = hash(k, 3) * Math.PI * 2;
      const r = hash(k, 7) * 4;
      const lit = hash(k, 11) < v.cityLight;
      const fire = hash(k, 13) < v.cityFire && Math.sin(time * 9 + k) > 0;
      if (lit || fire) put(Math.round(m.x + Math.cos(a) * r) + ox, Math.round(m.y + Math.sin(a) * r * 0.6) + oy, fire ? [255, 120, 40] : [255, 196, 110]);
    }
  }
}
