import { describe, expect, it } from 'vitest';
import { lampSpots, treeSpots, paved } from './props';
import { blocked, roadNet } from '../game/session';
import { nearAsphalt } from '../sim/roadnet';

// Tiles: downtown Minneapolis (paved), a house grid in south Minneapolis, the river gorge.
const TILES: [number, number, string][] = [
  [86, 110, 'downtown'],
  [104, 160, 'south Minneapolis houses'],
  [152, 136, 'river gorge'],
];

describe('street lamps and trees', () => {
  for (const [x0, y0, name] of TILES) {
    it(`${name}: trees stand clear of buildings, roads and water; same every time`, () => {
      const t = treeSpots(x0, y0);
      const net = roadNet();
      for (const tr of t) {
        expect(blocked(tr.x, tr.y)).toBe(false);
        expect(nearAsphalt(net, tr.x, tr.y, 0.5)).toBe(false);
      }
      expect(treeSpots(x0, y0)).toEqual(t);
    });
    it(`${name}: lamps stand beside roads, never in buildings`, () => {
      const l = lampSpots(x0, y0);
      expect(l.length).toBeGreaterThan(10);
      for (const p of l) expect(blocked(p.x, p.y)).toBe(false);
    });
  }
  it('house streets get boulevard trees; downtown is paved and gets few', () => {
    const houses = treeSpots(104, 160).length, down = treeSpots(86, 110).length;
    console.log('trees: houses', houses, 'downtown', down, 'river', treeSpots(152, 136).length);
    expect(houses).toBeGreaterThan(400);
    expect(down).toBeLessThan(houses / 2);
    expect(paved(89.5, 114.5)).toBe(true);
  });
});
