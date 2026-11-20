import { describe, expect, it } from 'vitest';
import detail from '../data/detail.json';
import { cleanPlaces } from './places';

describe('real places for 2009', () => {
  const places = cleanPlaces((detail as unknown as { places: [number, number, string, string][] }).places);
  it('has the five Minneapolis police precincts, including the 2009 3rd Precinct', () => {
    for (const n of ['1st Precinct', '2nd Precinct', '3rd Precinct (2009)', '4th Precinct', '5th Precinct'])
      expect(places.some((p) => p.kind === 'police' && p.name === n)).toBe(true);
  });
  it('has HCMC downtown and drops non-stations', () => {
    expect(places.some((p) => p.name === 'Hennepin County Medical Center')).toBe(true);
    expect(places.some((p) => p.name === 'State Fair Police')).toBe(false);
  });
});
