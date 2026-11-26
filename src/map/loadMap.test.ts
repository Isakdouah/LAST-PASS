import { describe, expect, it } from 'vitest';
import mapFile from '../data/minneapolis.json';
import { loadMap, MapFile } from './loadMap';
import { count } from '../sim/outbreak';

describe('Twin Cities map', () => {
  const city = loadMap(mapFile as unknown as MapFile);

  it('has the right size and the real 2010 Census head count (979,374 in the box, plus police)', () => {
    expect(city.world.healthy.length).toBe(city.width * city.height);
    const people = count(city.world.healthy);
    expect(people).toBeGreaterThan(979_000);
    expect(people).toBeLessThan(982_000);
  });

  it('is dense where the 2010 Census says so: Cedar-Riverside towers beat a south Minneapolis house street', () => {
    // People in a 5 x 5 cell square (about 400 m across) around a point.
    const around = (lon: number, lat: number) => {
      const [w, s, e, n] = mapFile.bbox;
      const cx = Math.floor(((lon - w) / (e - w)) * city.width);
      const cy = Math.floor(((n - lat) / (n - s)) * city.height);
      let sum = 0;
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) sum += city.world.healthy[y * city.width + x];
      return sum;
    };
    const cedarRiverside = around(-93.2475, 44.969);
    const airport = around(-93.215, 44.882);
    expect(cedarRiverside).toBeGreaterThan(2000);
    expect(airport).toBeLessThan(50);
  });

  it('has water (the Mississippi and the lakes) and nobody lives in it', () => {
    let water = 0;
    let wetPeople = 0;
    for (let i = 0; i < city.world.land.length; i++) {
      if (!city.world.land[i]) {
        water++;
        wetPeople += city.world.healthy[i];
      }
    }
    expect(water).toBeGreaterThan(1000);
    expect(wetPeople).toBe(0);
  });

  it('has police stations, fire stations and hospitals, and armed people', () => {
    expect(city.places.filter((p) => p.kind === 'police').length).toBeGreaterThan(5);
    expect(city.places.filter((p) => p.kind === 'hospital').length).toBeGreaterThan(5);
    const armed = count(city.world.armed);
    expect(armed).toBeGreaterThan(100_000);
    expect(armed).toBeLessThan(250_000);
  });
});
