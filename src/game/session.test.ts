import { describe, expect, it } from 'vitest';
import { Session, blocked, GW } from './session';
import { inWindow } from './clock';

const quiet = { start() {}, hush() {}, setStatic() {}, say() {}, shot() {}, muted: true } as never;

describe('session (one night, no drawing)', () => {
  it('story mode starts the outbreak by script, at the hospital, not by the player', () => {
    const g = new Session(quiet);
    g.reset('play');
    let infected = 0;
    for (let i = 0; i < g.world.infected.length; i++) infected += g.world.infected[i];
    expect(infected).toBe(52); // 40 at HCMC + 12 moved to Fairview Riverside
    expect(g.world.infected[121 * GW + 96]).toBe(40);
  });
  it('runs a whole night to the dawn screen without hanging', () => {
    const g = new Session(quiet);
    g.reset('play');
    let frames = 0;
    let sawWindow = false;
    while (g.mode === 'play' && frames < 200000) {
      g.simulate(0.1, frames * 100, null, false);
      if (inWindow(g.t)) sawWindow = true;
      frames++;
    }
    expect(sawWindow).toBe(true);
    expect(g.mode).toBe('end');
  });
  it('buildings block movement (downtown is not empty space)', () => {
    let n = 0;
    for (let y = 100; y < 140; y += 0.5) for (let x = 90; x < 130; x += 0.5) if (blocked(x, y)) n++;
    expect(n).toBeGreaterThan(200);
  });
});

describe('nobody appears from nowhere', () => {
  it('looking closely (street level) and looking away keeps everyone counted', () => {
    const g = new Session(quiet);
    g.reset('play');
    while (g.t < 1200 + 2 * 5520 - 60) {
      g.t += 60;
      g.cityStep();
    }
    const all = () => {
      const t = g.totals();
      return t.alive + t.dead + t.fallen + t.escaped;
    };
    const before = all();
    for (let k = 0; k < 3; k++) {
      const f = { x: 95 + k * 10, y: 150 };
      g.setZone({ x0: f.x - 6, y0: f.y - 6, x1: f.x + 6, y1: f.y + 6 });
      for (let j = 0; j < 200; j++) g.simulate(0.05, j * 50, { x0: f.x - 6, y0: f.y - 6, x1: f.x + 6, y1: f.y + 6 }, true);
      g.setZone(null);
    }
    // The street's own fallen count once they are written back.
    expect(all()).toBeGreaterThan(before * 0.98);
    expect(all()).toBeLessThan(before * 1.02);
  });
});
