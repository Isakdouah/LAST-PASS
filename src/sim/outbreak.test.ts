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
});
