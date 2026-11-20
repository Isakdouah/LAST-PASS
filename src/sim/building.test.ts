import { describe, expect, it } from 'vitest';
import { createBuilding, learnFloors, stepBuilding, totalDead, totalLiving } from './building';

describe('dollhouse (inside one building)', () => {
  it('the dead come in at the bottom and climb toward the living', () => {
    const b = createBuilding('t', 'Test', 6, 120, 4);
    for (let k = 0; k < 5; k++) stepBuilding(b, 200, 0, k + 1);
    expect(b.floors[0].dead + b.floors[1].dead).toBeGreaterThan(0);
    for (let k = 0; k < 40; k++) stepBuilding(b, 200, 0, k + 10);
    expect(b.floors[3].dead + b.floors[4].dead + b.floors[5].dead).toBeGreaterThan(0);
  });

  it('people who know block the stairwell doors, and that buys time', () => {
    const run = (aware: number) => {
      const b = createBuilding('t', 'Test', 8, 160, 6);
      for (let k = 0; k < 60; k++) stepBuilding(b, 150, aware, k + 1);
      return totalLiving(b);
    };
    expect(run(1)).toBeGreaterThan(run(0) * 1.2);
  });

  it('nobody appears from nowhere: the living only become the dead', () => {
    const b = createBuilding('t', 'Test', 5, 100, 2);
    for (let k = 0; k < 30; k++) stepBuilding(b, 0, 0.5, k + 1);
    expect(totalLiving(b) + totalDead(b)).toBeCloseTo(100, 3);
  });

  it('a sketch from what you are told: the hero floor first, then more', () => {
    const b = createBuilding('t', 'Test', 6, 60, 3);
    learnFloors(b, 1);
    expect(b.known.filter(Boolean).length).toBe(1);
    learnFloors(b, 3);
    expect(b.known[0] && b.known[2] && b.known[4]).toBe(true);
    expect(b.known[5]).toBe(false);
  });
});
