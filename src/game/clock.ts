// The orbit clock. One night over Minneapolis: Friday 16 October 2009, from 19:40 local
// time (CDT). The station comes over the city once per orbit (92 minutes), six times.
// Only while it is over the city (the "window") can you see or talk to anyone there.
// Time runs slowly during the window and fast on the far side of the Earth.
//
// Game fudge (on purpose): a real orbit's track moves about 23 degrees west each orbit,
// so a real station would only pass near one city 3-4 times in a row. We re-aim each
// pass over Minneapolis.

export const ORBIT = 92 * 60; // seconds
export const PASSES = 6;
export const FIRST_PASS = 20 * 60; // first closest approach, seconds after 19:40
export const WINDOW = 3.5 * 60; // seconds either side of closest approach
export const START = { h: 19, m: 40 }; // local time at t = 0
/** Game seconds per real second. */
export const RATE = { window: 2, far: 300 };

const INC = (51.6 * Math.PI) / 180; // orbit inclination
const EARTH_TURN = (2 * Math.PI) / 86164; // radians per second
export const MPLS = { lat: 44.98, lon: -93.27 };

export function passIndex(t: number): number {
  return Math.max(0, Math.min(PASSES - 1, Math.round((t - FIRST_PASS) / ORBIT)));
}
export function passCentre(k: number): number {
  return FIRST_PASS + k * ORBIT;
}
/** Seconds from the nearest closest approach (negative = before). */
export function fromCentre(t: number): number {
  return t - passCentre(passIndex(t));
}
export function inWindow(t: number): boolean {
  return Math.abs(fromCentre(t)) <= WINDOW && t <= passCentre(PASSES - 1) + WINDOW;
}
/** The night is over once the last window has closed. */
export function nightOver(t: number): boolean {
  return t > passCentre(PASSES - 1) + WINDOW + 30;
}
/** Seconds until the next window opens (0 while in one). */
export function untilWindow(t: number): number {
  if (inWindow(t)) return 0;
  for (let k = 0; k < PASSES; k++) {
    const open = passCentre(k) - WINDOW;
    if (open > t) return open - t;
  }
  return Infinity;
}
/** Seconds left in the current window. */
export function windowLeft(t: number): number {
  return inWindow(t) ? passCentre(passIndex(t)) + WINDOW - t : 0;
}

/** Game seconds per real second, easing near window edges so it never jumps. */
export function rateAt(t: number): number {
  const d = Math.abs(fromCentre(t)) - WINDOW; // <0 inside the window
  if (d <= 0) return RATE.window;
  const ramp = Math.min(1, d / 120);
  return RATE.window + (RATE.far - RATE.window) * ramp;
}

export function localTime(t: number): string {
  const mins = START.h * 60 + START.m + Math.floor(t / 60);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Point under the station (degrees), for the orbit view. */
export function subPoint(t: number): { lat: number; lon: number } {
  const dt = fromCentre(t);
  const phi = (MPLS.lat * Math.PI) / 180;
  const u0 = Math.asin(Math.sin(phi) / Math.sin(INC)); // ascending (moving north-east)
  const u = u0 + (2 * Math.PI * dt) / ORBIT;
  const lat = Math.asin(Math.sin(INC) * Math.sin(u));
  const li = (uu: number) => Math.atan2(Math.cos(INC) * Math.sin(uu), Math.cos(uu));
  let lon = (MPLS.lon * Math.PI) / 180 + li(u) - li(u0) - EARTH_TURN * dt;
  lon = ((((lon + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function fmt(sec: number): string {
  if (!Number.isFinite(sec)) return 'none tonight';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Real (wall-clock) seconds it takes for game time to run from a to b. */
export function realSeconds(a: number, b: number): number {
  if (!Number.isFinite(b) || !Number.isFinite(a)) return Infinity; // no more passes tonight
  let real = 0;
  for (let x = a; x < b; x += 10) real += Math.min(10, b - x) / rateAt(x);
  return real;
}
