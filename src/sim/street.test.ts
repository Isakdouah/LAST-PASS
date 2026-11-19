import { describe, expect, it } from 'vitest';
import { createWorld } from './outbreak';
import { enterStreet, Kind, leaveStreet, stepStreet } from './street';

function block() {
  const w = createWorld(20, 20);
  w.healthy.fill(10);
  w.infected[10 * 20 + 10] = 10;
  return w;
}

describe('street level', () => {
  it('turns cell numbers into people and back without losing anyone', () => {
    const w = block();
    const s = enterStreet(w, 0, 0, 20, 20, 10_000);
    expect(s.agents.length).toBeGreaterThan(3900);
    expect(s.agents.length).toBeLessThan(4100);
    leaveStreet(s, w);
    let total = 0;
    for (let i = 0; i < 400; i++) total += w.healthy[i] + w.infected[i] + w.fallen[i];
    expect(total).toBeCloseTo(s.agents.length * s.scale, 0);
  });

  it('the dead catch people and people run', () => {
    const w = block();
    const s = enterStreet(w, 0, 0, 20, 20, 10_000);
    const deadAtStart = s.agents.filter((a) => a.kind === Kind.Dead).length;
    for (let t = 0; t < 200; t++) stepStreet(s, w, t);
    const deadNow = s.agents.filter((a) => a.kind === Kind.Dead).length;
    expect(deadNow).toBeGreaterThan(deadAtStart);
    expect(s.agents.some((a) => a.kind === Kind.Living && a.fear > 0.5)).toBe(true);
  });

  it('nobody walks into water', () => {
    const w = block();
    for (let y = 0; y < 20; y++) {
      w.land[y * 20 + 5] = 0;
      w.healthy[y * 20 + 5] = 0;
    }
    const s = enterStreet(w, 0, 0, 20, 20, 10_000);
    for (let t = 0; t < 200; t++) stepStreet(s, w, t);
    expect(s.agents.every((a) => Math.floor(a.x) !== 5)).toBe(true);
  });
});
