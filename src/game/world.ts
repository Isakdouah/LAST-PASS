// The world beyond Minneapolis, written as pure functions of game time t (seconds after
// 19:40 CDT, 16 October 2009). Nothing here is simulated step by step: ask for any second,
// in any order, and you get the same answer. That keeps it testable, lets "compare passes"
// look back in time for free, and lets us record trailers frame by frame later.
// Story mode: all of this is scripted. The player never starts an outbreak.
// Our own alternate-history events. Origin never confirmed (organ-trade rumours only).
// PLACEHOLDER writing for ISAK to rewrite.

const D = Math.PI / 180;
export interface LatLon {
  lat: number;
  lon: number;
}

// ---------- great-circle paths, by distance ----------
function unit(p: LatLon): [number, number, number] {
  const c = Math.cos(p.lat * D);
  return [c * Math.cos(p.lon * D), c * Math.sin(p.lon * D), Math.sin(p.lat * D)];
}
function toLL(v: [number, number, number]): LatLon {
  const r = Math.hypot(v[0], v[1], v[2]);
  return { lat: Math.asin(v[2] / r) / D, lon: Math.atan2(v[1], v[0]) / D };
}
export function arcKm(a: LatLon, b: LatLon): number {
  const h = Math.sin(((b.lat - a.lat) * D) / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(((b.lon - a.lon) * D) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** The point a share f (0..1) of the way along the great circle from a to b. */
export function between(a: LatLon, b: LatLon, f: number): LatLon {
  const A = unit(a), B = unit(b);
  const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const w = Math.acos(dot);
  if (w < 1e-9) return { ...a };
  const s = Math.sin(w), ka = Math.sin((1 - f) * w) / s, kb = Math.sin(f * w) / s;
  return toLL([A[0] * ka + B[0] * kb, A[1] * ka + B[1] * kb, A[2] * ka + B[2] * kb]);
}
export function lengthKm(path: LatLon[]): number {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += arcKm(path[i - 1], path[i]);
  return L;
}
/** Where you are after `km` along a path (clamped to its ends), and which way you face (degrees, 0 = north). */
export function along(path: LatLon[], km: number): LatLon & { heading: number } {
  let left = Math.max(0, km);
  for (let i = 1; i < path.length; i++) {
    const seg = arcKm(path[i - 1], path[i]);
    if (left <= seg || i === path.length - 1) {
      const f = seg > 0 ? Math.min(1, left / seg) : 0;
      const p = between(path[i - 1], path[i], f);
      const q = between(path[i - 1], path[i], Math.min(1, f + 0.001));
      const y = Math.sin((q.lon - p.lon) * D) * Math.cos(q.lat * D);
      const x = Math.cos(p.lat * D) * Math.sin(q.lat * D) - Math.sin(p.lat * D) * Math.cos(q.lat * D) * Math.cos((q.lon - p.lon) * D);
      return { ...p, heading: (Math.atan2(y, x) / D + 360) % 360 };
    }
    left -= seg;
  }
  return { ...path[0], heading: 0 };
}

// ---------- the timeline ----------
const H = 3600;
export type Region = 'americas' | 'europe' | 'asia' | 'africa' | 'oceania';

/** When each region stops new flights (t, seconds). Planes already up keep flying and land. */
export const GROUND_STOP: Record<Region, number> = {
  americas: 4 * H,
  europe: 5 * H,
  asia: 6 * H,
  africa: 7.5 * H,
  oceania: 7.5 * H,
};
/** When ports close: ships at sea stop and drop anchor where they are. */
export const PORTS_CLOSE = 6.5 * H;

/** An outbreak somewhere else. It grows from `onset` at `kmh` up to `maxKm` across. */
export interface Front extends LatLon {
  id: string;
  place: string;
  onset: number;
  kmh: number;
  maxKm: number;
}
export const FRONTS: Front[] = [
  { id: 'fra', place: 'Frankfurt', lat: 50.11, lon: 8.68, onset: -6 * H, kmh: 4, maxKm: 70 },
  { id: 'bom', place: 'Mumbai', lat: 19.07, lon: 72.88, onset: -3 * H, kmh: 6, maxKm: 90 },
  { id: 'jnb', place: 'Johannesburg', lat: -26.2, lon: 28.05, onset: 1 * H, kmh: 5, maxKm: 70 },
  { id: 'chi', place: 'Chicago', lat: 41.88, lon: -87.63, onset: 2 * H, kmh: 5, maxKm: 80 },
  { id: 'sao', place: 'São Paulo', lat: -23.55, lon: -46.63, onset: 2.5 * H, kmh: 6, maxKm: 90 },
  { id: 'can', place: 'Guangzhou', lat: 23.13, lon: 113.26, onset: 3 * H, kmh: 6, maxKm: 90 },
  { id: 'mow', place: 'Moscow', lat: 55.75, lon: 37.62, onset: 4.5 * H, kmh: 4, maxKm: 60 },
  { id: 'cai', place: 'Cairo', lat: 30.04, lon: 31.24, onset: 5.5 * H, kmh: 5, maxKm: 60 },
];
/** How far an outbreak has spread (km from its centre) at time t: 0 before it starts. */
export function frontRadius(f: Front, t: number): number {
  if (t <= f.onset) return 0;
  return Math.min(f.maxKm, 3 + ((t - f.onset) / H) * f.kmh);
}
/** How dark a place is from the outbreaks at time t (0 = normal, 1 = lights out). */
export function darkness(p: LatLon, t: number): number {
  let d = 0;
  for (const f of FRONTS) {
    const r = frontRadius(f, t);
    if (r <= 0) continue;
    const km = arcKm(p, f);
    if (km < r) d = Math.max(d, Math.min(0.85, 0.35 + 0.5 * (1 - km / r)) * Math.min(1, (t - f.onset) / (2 * H)));
  }
  return d;
}

/** Something you hear about: on shortwave, from hams, or on the wire. Shown once, when t passes it. */
export interface WorldEvent extends LatLon {
  t: number;
  source: string;
  text: string;
}
export const EVENTS: WorldEvent[] = [
  { t: 5 * 60, source: 'Wire report', lat: 50.11, lon: 8.68, text: 'Frankfurt: an airport clinic is sealed after "violent patients". Officials blame a bad batch of medicine.' },
  { t: 40 * 60, source: 'Ham relay, Mumbai', lat: 19.07, lon: 72.88, text: 'Hospitals in Andheri are turning people away. Police have closed the Western Express Highway.' },
  { t: 1.1 * H, source: 'Shortwave', lat: 50.03, lon: 8.56, text: 'Flights out of Frankfurt are being held on the ground. Passengers are told it is a security check.' },
  { t: 1.6 * H, source: 'Shortwave, Johannesburg', lat: -26.2, lon: 28.05, text: 'A private transplant clinic in Sandton is on fire. Reporters ask where its donor kidneys came from. Nobody answers.' },
  { t: 2.1 * H, source: 'CB radio, I-94', lat: 41.88, lon: -87.63, text: 'Truckers say the interstate out of Chicago is jammed solid. "They say Minneapolis is worse."' },
  { t: 2.7 * H, source: 'Ham relay, São Paulo', lat: -23.55, lon: -46.63, text: 'Neighbours in the favelas above Paraisópolis are blocking the stairways with cars. The police have not come up.' },
  { t: 3.3 * H, source: 'Shortwave', lat: 22.75, lon: 113.6, text: 'Guangzhou: a ship crew is held in quarantine at Nansha port. Two crewmen are missing from the ship.' },
  { t: 4 * H, source: 'Wire report', lat: 39, lon: -98, text: 'US aviation authorities order every plane in American airspace to land at the nearest airport.' },
  { t: 4.6 * H, source: 'Ham relay, Moscow', lat: 55.75, lon: 37.62, text: 'The ring road is closed. The radio says it is an exercise. The soldiers do not look like it is an exercise.' },
  { t: 5 * H, source: 'Shortwave', lat: 50, lon: 10, text: 'Europe closes its airspace. The last flights in are circling, waiting for runways.' },
  { t: 5.7 * H, source: 'Shortwave, Cairo', lat: 30.04, lon: 31.24, text: 'The Suez Canal is closed to all ships. Cairo hospitals ask for blood donors on every station.' },
  { t: 6.5 * H, source: 'Wire report', lat: 1.26, lon: 103.8, text: 'Singapore, Rotterdam and Shanghai stop letting ships in. Hundreds of ships drop anchor at sea.' },
  { t: 7.3 * H, source: 'Ham relay, Mogadishu', lat: 2.04, lon: 45.34, text: 'Neighbourhood watch groups closed the roads into the city hours ago. The ham says: "We have done this before. We are holding."' },
];
export function eventsBetween(t0: number, t1: number): WorldEvent[] {
  return EVENTS.filter((e) => e.t > t0 && e.t <= t1);
}

// ---------- flights ----------
interface Airport extends LatLon {
  code: string;
  region: Region;
}
const AP: Record<string, Airport> = {};
const ap = (code: string, lat: number, lon: number, region: Region) => (AP[code] = { code, lat, lon, region });
ap('MSP', 44.88, -93.22, 'americas');
ap('ORD', 41.98, -87.9, 'americas');
ap('JFK', 40.64, -73.78, 'americas');
ap('LAX', 33.94, -118.41, 'americas');
ap('MEX', 19.44, -99.07, 'americas');
ap('GRU', -23.43, -46.47, 'americas');
ap('LHR', 51.47, -0.45, 'europe');
ap('FRA', 50.03, 8.56, 'europe');
ap('AMS', 52.31, 4.76, 'europe');
ap('SVO', 55.97, 37.41, 'europe');
ap('IST', 40.98, 28.82, 'europe');
ap('DXB', 25.25, 55.36, 'asia');
ap('DEL', 28.56, 77.1, 'asia');
ap('BOM', 19.09, 72.87, 'asia');
ap('KHI', 24.91, 67.16, 'asia');
ap('SIN', 1.36, 103.99, 'asia');
ap('HKG', 22.31, 113.91, 'asia');
ap('PVG', 31.14, 121.81, 'asia');
ap('NRT', 35.77, 140.39, 'asia');
ap('SYD', -33.94, 151.18, 'oceania');
ap('JNB', -26.14, 28.24, 'africa');
ap('NBO', -1.32, 36.93, 'africa');
ap('LOS', 6.58, 3.32, 'africa');
ap('CAI', 30.12, 31.41, 'africa');
ap('ADD', 8.98, 38.8, 'africa');

/** Routes flown both ways, with one departure every `every` minutes each way. */
const ROUTES: [string, string, number][] = [
  ['MSP', 'ORD', 30], ['MSP', 'JFK', 60], ['MSP', 'LAX', 60], ['MSP', 'AMS', 240], ['ORD', 'LHR', 90], ['JFK', 'LHR', 40],
  ['JFK', 'FRA', 90], ['LAX', 'NRT', 120], ['LAX', 'MEX', 60], ['GRU', 'JFK', 120], ['GRU', 'FRA', 180], ['MEX', 'JFK', 60],
  ['LHR', 'DXB', 60], ['FRA', 'DEL', 120], ['AMS', 'NBO', 240], ['LHR', 'JNB', 120], ['FRA', 'SIN', 120], ['IST', 'SVO', 90],
  ['DXB', 'BOM', 45], ['DXB', 'KHI', 60], ['DXB', 'SIN', 90], ['DXB', 'ADD', 120], ['DEL', 'BOM', 30], ['SIN', 'HKG', 45],
  ['SIN', 'SYD', 90], ['HKG', 'PVG', 30], ['PVG', 'NRT', 40], ['NRT', 'SYD', 180], ['CAI', 'JNB', 240], ['LOS', 'LHR', 180],
  ['ADD', 'NBO', 90], ['CAI', 'IST', 90], ['SVO', 'DEL', 180], ['JNB', 'NBO', 120],
];
const CRUISE = 850; // km/h
export interface Plane extends LatLon {
  id: string;
  heading: number;
  /** 0..1 of the trip done. */
  done: number;
}
/** Every plane in the air at time t. */
export function planesAt(t: number): Plane[] {
  const out: Plane[] = [];
  ROUTES.forEach(([a, b, every], r) => {
    for (const [from, to] of [[AP[a], AP[b]], [AP[b], AP[a]]] as [Airport, Airport][]) {
      const km = arcKm(from, to);
      const dur = (km / CRUISE) * H + 1800; // plus taxi, climb and descent
      const gap = every * 60;
      const phase = ((r * 977 + (from === AP[a] ? 0 : 431)) % every) * 60;
      const stop = GROUND_STOP[from.region];
      // Departures between t - dur and t (and before the ground stop) are in the air.
      const k0 = Math.ceil((t - dur - phase) / gap), k1 = Math.floor((Math.min(t, stop) - phase) / gap);
      for (let k = k0; k <= k1; k++) {
        const dep = phase + k * gap;
        const f = (t - dep) / dur;
        if (f < 0 || f > 1) continue;
        const p = along([from, to], f * km);
        out.push({ id: `${from.code}-${to.code}-${k}`, lat: p.lat, lon: p.lon, heading: p.heading, done: f });
      }
    }
  });
  return out;
}

// ---------- ships ----------
/** Sea lanes, every point on open water (checked against the land mask by a test). */
export const LANES: { id: string; path: LatLon[]; ships: number }[] = [
  {
    id: 'asia-europe',
    ships: 26,
    path: [
      { lat: 31, lon: 123.5 }, { lat: 25, lon: 121 }, { lat: 18, lon: 115 }, { lat: 8, lon: 108 }, { lat: 2, lon: 105 }, { lat: 1.0, lon: 104.1 }, { lat: 1.0, lon: 103.7 },
      { lat: 1.9, lon: 102.3 }, { lat: 3.2, lon: 100.4 }, { lat: 4.5, lon: 99 }, { lat: 6.4, lon: 96.5 }, { lat: 6.5, lon: 93 }, { lat: 5.5, lon: 81 }, { lat: 9, lon: 70 }, { lat: 12.3, lon: 52 },
      { lat: 11.9, lon: 44.5 }, { lat: 12.3, lon: 43.3 }, { lat: 13.2, lon: 42.8 }, { lat: 14.5, lon: 41.8 }, { lat: 20, lon: 38.6 }, { lat: 27, lon: 34.4 },
    ],
  },
  {
    id: 'mediterranean',
    ships: 10,
    path: [{ lat: 31.8, lon: 32 }, { lat: 33.5, lon: 25 }, { lat: 36.5, lon: 15 }, { lat: 37.8, lon: 8 }, { lat: 38, lon: 4.5 }, { lat: 37, lon: 0 }, { lat: 36.2, lon: -3 }, { lat: 36.5, lon: -10 }],
  },
  {
    id: 'north-atlantic',
    ships: 14,
    path: [{ lat: 40.3, lon: -73.5 }, { lat: 42, lon: -60 }, { lat: 46, lon: -40 }, { lat: 49, lon: -15 }, { lat: 49.5, lon: -5 }, { lat: 50.6, lon: 0.5 }, { lat: 52.2, lon: 3.5 }],
  },
  {
    id: 'pacific',
    ships: 14,
    path: [{ lat: 34, lon: 140 }, { lat: 40, lon: 160 }, { lat: 45, lon: 180 }, { lat: 45, lon: -165 }, { lat: 40, lon: -140 }, { lat: 33.6, lon: -119 }],
  },
  {
    id: 'cape',
    ships: 10,
    path: [{ lat: 36, lon: -10 }, { lat: 25, lon: -20 }, { lat: 10, lon: -20 }, { lat: 0, lon: -8 }, { lat: -15, lon: 6 }, { lat: -30, lon: 14 }, { lat: -35.5, lon: 19 }, { lat: -34, lon: 30 }, { lat: -26, lon: 36 }],
  },
  {
    id: 'east-africa',
    ships: 6,
    path: [{ lat: -26, lon: 36 }, { lat: -15, lon: 42 }, { lat: -4, lon: 41 }, { lat: 1.5, lon: 46 }, { lat: 4, lon: 50 }, { lat: 8, lon: 53 }, { lat: 11.5, lon: 53 }, { lat: 12.3, lon: 52 }],
  },
];
const SHIP_KMH = 35;
export interface Ship extends LatLon {
  id: string;
  heading: number;
  anchored: boolean;
}
/** Every ship at time t. Ships go back and forth along their lane; when the ports close they stop. */
export function shipsAt(t: number): Ship[] {
  const out: Ship[] = [];
  const tm = Math.min(t, PORTS_CLOSE);
  for (const lane of LANES) {
    const L = lengthKm(lane.path);
    for (let k = 0; k < lane.ships; k++) {
      // Each ship runs a loop of 2L (out and back), starting spread out along it.
      const s = (((k / lane.ships) * 2 * L + (tm / H) * SHIP_KMH * (k % 2 ? 1 : 0.85)) % (2 * L) + 2 * L) % (2 * L);
      const back = s > L;
      const p = along(lane.path, back ? 2 * L - s : s);
      out.push({ id: `${lane.id}-${k}`, lat: p.lat, lon: p.lon, heading: back ? (p.heading + 180) % 360 : p.heading, anchored: t >= PORTS_CLOSE });
    }
  }
  return out;
}
