import { describe, expect, it } from 'vitest';
import globeFile from '../data/globe.json';
import { along, between, darkness, EVENTS, eventsBetween, FRONTS, frontRadius, GROUND_STOP, LANES, lengthKm, planesAt, PORTS_CLOSE, shipsAt } from './world';

const G = globeFile as { w: number; h: number; land: string };
const bits = Uint8Array.from(atob(G.land), (c) => c.charCodeAt(0));
const isLand = (lat: number, lon: number) => {
  const y = Math.min(G.h - 1, Math.max(0, Math.floor((90 - lat) * 2)));
  const x = ((Math.floor((lon + 180) * 2) % G.w) + G.w) % G.w;
  const i = y * G.w + x;
  return ((bits[i >> 3] >> (7 - (i & 7))) & 1) === 1;
};
// The mask is coarse (half a degree, about 55 km), so narrow straits read as land and coastal
// cities as sea. "Near water" / "near land" = within one mask cell.
const near = (lat: number, lon: number, land: boolean) => {
  for (const dy of [-0.5, 0, 0.5]) for (const dx of [-0.5, 0, 0.5]) if (isLand(lat + dy, lon + dx) === land) return true;
  return false;
};

describe('world events as functions of time', () => {
  it('gives the same answer for the same second, whatever order you ask in', () => {
    const a = planesAt(3 * 3600), b = planesAt(1000), c = planesAt(3 * 3600);
    expect(c).toEqual(a);
    expect(b.length).toBeGreaterThan(0);
    expect(shipsAt(5000)).toEqual(shipsAt(5000));
  });
  it('walks paths by distance', () => {
    const p = along([{ lat: 0, lon: 0 }, { lat: 0, lon: 10 }], 0);
    expect(p.lon).toBeCloseTo(0);
    expect(p.heading).toBeCloseTo(90, 0);
    const mid = between({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, 0.5);
    expect(mid.lon).toBeCloseTo(5);
  });
  it('empties the sky after the ground stops', () => {
    const before = planesAt(3 * 3600).length;
    const late = Math.max(...Object.values(GROUND_STOP)) + 20 * 3600;
    expect(before).toBeGreaterThan(50);
    expect(planesAt(late).length).toBe(0);
    // No plane over America took off after the American ground stop.
    const after = planesAt(GROUND_STOP.americas + 12 * 3600).filter((p) => p.id.startsWith('MSP-') || p.id.startsWith('ORD-'));
    expect(after.length).toBe(0);
  });
  it('outbreaks only grow, and start dark at their centre', () => {
    for (const f of FRONTS) {
      expect(frontRadius(f, f.onset - 1)).toBe(0);
      let last = 0;
      for (let t = f.onset; t < f.onset + 20 * 3600; t += 600) {
        const r = frontRadius(f, t);
        expect(r).toBeGreaterThanOrEqual(last);
        last = r;
      }
      expect(darkness(f, f.onset + 3 * 3600)).toBeGreaterThan(0.3);
    }
  });
  it('ships stay on open water and stop when the ports close', () => {
    for (const lane of LANES) {
      const L = lengthKm(lane.path);
      for (let km = 0; km <= L; km += 50) {
        const p = along(lane.path, km);
        expect(!near(p.lat, p.lon, false), `${lane.id} at ${km} km (${p.lat.toFixed(1)}, ${p.lon.toFixed(1)})`).toBe(false);
      }
    }
    expect(shipsAt(PORTS_CLOSE + 3600)).toEqual(shipsAt(PORTS_CLOSE + 7200).map((s) => ({ ...s })));
    expect(shipsAt(PORTS_CLOSE + 1).every((s) => s.anchored)).toBe(true);
  });
  it('places every outbreak and event on land, and hands out each event once', () => {
    for (const f of FRONTS) expect(near(f.lat, f.lon, true), f.place).toBe(true);
    let seen = 0;
    for (let t = -10; t < 12 * 3600; t += 97) seen += eventsBetween(t, t + 97).length;
    expect(seen).toBe(EVENTS.length);
  });
});
