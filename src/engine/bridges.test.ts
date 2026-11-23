import { describe, expect, it } from 'vitest';
import { deckAt, bridgeGeometry } from './bridges';
import { elevation, heightAt } from './terrain';
import { det } from '../game/session';
import { TILE } from '../map/detail';

// Map cell of a point (same projection as the map build).
const cell = (lat: number, lon: number) => ({ x: ((lon + 93.36) / 0.36) * 360, y: ((45.06 - lat) / 0.19) * 260 });

describe('real ground and bridges', () => {
  it('the Mississippi lies well below downtown (USGS heights)', () => {
    const river = cell(44.9790, -93.2440); // the river at the I-35W bridge
    const downtown = cell(44.9765, -93.2700); // Nicollet Mall area
    expect(elevation(river.x, river.y)).toBeLessThan(elevation(downtown.x, downtown.y) - 12);
    expect(elevation(downtown.x, downtown.y)).toBeGreaterThan(240);
    expect(elevation(downtown.x, downtown.y)).toBeLessThan(270);
  });

  it('bridges over the river stand high above the water, with piers', () => {
    expect(det.bridges.count).toBeGreaterThan(500);
    const b = det.bridges;
    let over = 0;
    for (let k = 0; k < b.count; k++) {
      const o = b.off[k], n = b.off[k + 1] - o;
      const mx = b.xy[(o + (n >> 1)) * 2], my = b.xy[(o + (n >> 1)) * 2 + 1];
      const d = deckAt(mx, my);
      if (d !== null && d - heightAt(mx, my) > 10) over++;
    }
    expect(over).toBeGreaterThan(10);
    const c = cell(44.9790, -93.2440);
    const g = bridgeGeometry(Math.floor(c.x / TILE) * TILE, Math.floor(c.y / TILE) * TILE, (x, y, o) => o.set(x, 0, y));
    expect(g).not.toBeNull();
  });
});
