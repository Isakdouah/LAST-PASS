// Earth maths in kilometres. Earth-fixed frame: x to (0N, 0E), y to (0N, 90E), z to the
// North Pole. The planet does not turn in this frame; the Sun and the station move.
import * as THREE from 'three';
import { MPLS, subPoint } from '../game/clock';

export const R_EARTH = 6371;
/** Station altitude in October 2009: about 350 km (it was raised to ~400 km in 2011). */
export const ALT_ISS = 350;
const D = Math.PI / 180;

export function ecef(lat: number, lon: number, alt = 0, out = new THREE.Vector3()): THREE.Vector3 {
  const r = R_EARTH + alt;
  const cl = Math.cos(lat * D);
  return out.set(r * cl * Math.cos(lon * D), r * cl * Math.sin(lon * D), r * Math.sin(lat * D));
}
export function latLonOf(v: THREE.Vector3): { lat: number; lon: number; alt: number } {
  const r = v.length();
  return { lat: Math.asin(v.z / r) / D, lon: Math.atan2(v.y, v.x) / D, alt: r - R_EARTH };
}
/** East, North, Up unit vectors at a point. */
export function enu(lat: number, lon: number) {
  const sl = Math.sin(lat * D), cl = Math.cos(lat * D), so = Math.sin(lon * D), co = Math.cos(lon * D);
  return {
    e: new THREE.Vector3(-so, co, 0),
    n: new THREE.Vector3(-sl * co, -sl * so, cl),
    u: new THREE.Vector3(cl * co, cl * so, sl),
  };
}
/** Great-circle distance in km. */
export function arcKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(((lat2 - lat1) * D) / 2) ** 2 + Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin(((lon2 - lon1) * D) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Hours UTC at game time t (19:40 CDT = 00:40 UTC on 17 October 2009). */
export const utcHours = (t: number) => 0 + 40 / 60 + t / 3600;

/** Direction to the Sun in the Earth-fixed frame. Mid-October 2009: declination about
 *  -9 degrees, equation of time about +14 minutes (good to a fraction of a degree). */
export function sunDir(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const h = utcHours(t);
  const decl = -9.1 - (h / 24) * 0.38; // about -0.38 degrees per day in mid-October
  const lon = -(h - 12) * 15 - 14.2 / 4;
  return ecef(decl, lon, -R_EARTH + 1, out).normalize();
}

/** Station position (km, Earth-fixed) and its local frame: forward (velocity), up (zenith), right. */
export function station(t: number) {
  const a = subPoint(t);
  const b = subPoint(t + 1);
  const pos = ecef(a.lat, a.lon, ALT_ISS);
  const up = pos.clone().normalize();
  const fwd = ecef(b.lat, b.lon, ALT_ISS).sub(pos);
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  return { pos, up, fwd, right, lat: a.lat, lon: a.lon };
}

/** Footprint: ground within this arc of the sub-point can see the station above the
 *  horizon (about 2,000 km from 350 km up). Radio and telescope need it. */
export const FOOTPRINT_KM = R_EARTH * Math.acos(R_EARTH / (R_EARTH + ALT_ISS));
export { MPLS };
