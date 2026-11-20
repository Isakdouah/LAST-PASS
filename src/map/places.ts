// Police stations, fire stations and hospitals, from OpenStreetMap (2026 data),
// corrected for October 2009 where we know better. Checked against the city's
// precinct list (minneapolismn.gov, read 20 Nov 2026).
import type { Place, PlaceKind } from './loadMap';

export interface NamedPlace extends Place {
  name: string;
}

const WEST = -93.36, SOUTH = 44.87, EAST = -93.0, NORTH = 45.06, GW = 360, GH = 260;
const cell = (lon: number, lat: number) => ({
  x: ((lon - WEST) / (EAST - WEST)) * GW,
  y: ((NORTH - lat) / (NORTH - SOUTH)) * GH,
});

/** Not police stations (outreach offices, a seasonal fair post). */
const DROP = new Set(['A Community Outreach Program', 'State Fair Police']);
/** Names as they were in 2009. */
const RENAME: Record<string, string> = {
  'Hennepin Healthcare Clinic & Specialty Center': 'HCMC Clinic & Specialty Center',
  'University of Minnesota Medical Center - West Bank Campus': 'Fairview Riverside',
  "Children’s Minnesota – Minneapolis": "Children's Hospital Minneapolis",
  'North Memorial Health – Robbinsdale Hospital': 'North Memorial Medical Center',
};
/**
 * Missing from today's map: the old MPD 3rd Precinct at 3000 Minnehaha Ave
 * (burned in 2020, so it is not in 2026 data, but it stood in 2009).
 * Position = Lake St & Minnehaha Ave, approximate.
 */
const ADD_2009: NamedPlace[] = [{ ...cell(-93.2326, 44.9486), kind: 'police', name: '3rd Precinct (2009)' }];

export function cleanPlaces(raw: [number, number, string, string][]): NamedPlace[] {
  const out: NamedPlace[] = [];
  for (const [x, y, kind, name] of raw) {
    if (DROP.has(name)) continue;
    // The same place is often mapped twice (a point and a building): keep one.
    if (out.some((p) => p.kind === kind && (Math.hypot(p.x - x, p.y - y) < 1.5 || (name && p.name === (RENAME[name] ?? name))))) continue;
    out.push({ x, y, kind: kind as PlaceKind, name: RENAME[name] ?? name });
  }
  return out.concat(ADD_2009);
}
