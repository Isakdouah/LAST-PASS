import { describe, expect, it } from 'vitest';
import { count, createWorld, step, total } from './outbreak';

function smallTown() {
  const w = createWorld(20, 10);
  w.healthy.fill(100);
  w.infected[0] = 5; // patient zero in the top-left corner
  return w;
}

describe('outbreak simulation', () => {
  it('never creates or loses people', () => {
    let w = smallTown();
    const before = total(w);
    for (let t = 0; t < 50; t++) w = step(w);
    expect(total(w)).toBeCloseTo(before, 0);
  });

  it('spreads from patient zero', () => {
    let w = smallTown();
    for (let t = 0; t < 30; t++) w = step(w);
    expect(count(w.infected) + count(w.fallen)).toBeGreaterThan(100);
    expect(count(w.healthy)).toBeLessThan(20 * 10 * 100);
  });

  it('cannot cross water', () => {
    let w = smallTown();
    // A river down column 10, all the way through.
    for (let y = 0; y < 10; y++) {
      const i = y * 20 + 10;
      w.land[i] = 0;
      w.healthy[i] = 0;
    }
    for (let t = 0; t < 100; t++) w = step(w);
    let farSide = 0;
    for (let y = 0; y < 10; y++) for (let x = 11; x < 20; x++) farSide += w.infected[y * 20 + x];
    expect(farSide).toBe(0);
  });

  it('flows faster along roads', () => {
    const make = (withRoad: boolean) => {
      const w = createWorld(60, 21);
      w.healthy.fill(50);
      if (withRoad) for (let x = 0; x < 60; x++) w.road[10 * 60 + x] = 3;
      w.infected[10 * 60] = 20;
      return w;
    };
    let a = make(true);
    let b = make(false);
    for (let t = 0; t < 25; t++) {
      a = step(a);
      b = step(b);
    }
    const reach = (w: ReturnType<typeof make>) => {
      let far = 0;
      for (let x = 0; x < 60; x++) if (w.infected[10 * 60 + x] + w.fallen[10 * 60 + x] > 1) far = x;
      return far;
    };
    expect(reach(a)).toBeGreaterThan(reach(b));
  });
});
