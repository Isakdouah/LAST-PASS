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
