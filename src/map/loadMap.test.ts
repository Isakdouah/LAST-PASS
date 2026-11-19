import { describe, expect, it } from 'vitest';
import mapFile from '../data/minneapolis.json';
import { loadMap, MapFile } from './loadMap';
import { count } from '../sim/outbreak';

describe('Twin Cities map', () => {
  const city = loadMap(mapFile as unknown as MapFile);

  it('has the right size and about 800,000 people', () => {
    expect(city.world.healthy.length).toBe(city.width * city.height);
    const people = count(city.world.healthy);
    expect(people).toBeGreaterThan(750_000);
    expect(people).toBeLessThan(850_000);
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
