import { describe, expect, it } from 'vitest';
import { createFires, stepFires } from './fire';
import { createWorld } from './outbreak';

describe('fires', () => {
  const setup = () => {
    const w = createWorld(30, 30);
    const f = createFires(new Uint8Array(900).fill(200));
    return { w, f, none: new Float32Array(900) };
  };
  it('fighting starts fires, they spread through built-up blocks and burn out', () => {
    const { w, f, none } = setup();
    const fight = new Float32Array(900);
    fight[15 * 30 + 15] = 100;
    for (let t = 0; t < 600 && f.fire[465] === 0; t++) stepFires(f, w, fight, [], t);
    expect(f.fire[465]).toBeGreaterThan(0);
    let maxBurning = 0;
    for (let t = 0; t < 400; t++) {
      stepFires(f, w, none, [], 100 + t);
      maxBurning = Math.max(maxBurning, f.fire.filter((v) => v > 0).length);
    }
    expect(maxBurning).toBeGreaterThan(3);
    expect(f.fuel[465]).toBeLessThan(0.5);
  });
  it('a living fire station puts out fires near it', () => {
    const { w, f, none } = setup();
    w.healthy.fill(20);
    f.fire[465] = 0.5;
    for (let t = 0; t < 30; t++) stepFires(f, w, none, [15 * 30 + 17], t);
    expect(f.fire[465]).toBe(0);
  });
});
