import { describe, expect, it } from 'vitest';
import { createWorld } from './outbreak';
import { enterStreet, Kind, leaveStreet, newAgent, newStreet, Role, stepStreet } from './street';

function block() {
  const w = createWorld(20, 20);
  w.healthy.fill(10);
  w.infected[10 * 20 + 10] = 10;
  return w;
}

describe('street level', () => {
  it('turns cell numbers into people and back without losing anyone; most stay indoors', () => {
    const w = block();
    const before = 400 * 10 + 10;
    const s = enterStreet(w, 0, 0, 20, 20, 10_000);
    const drawn = s.agents.filter((a) => a.kind === Kind.Living).length * s.scale;
    let inside = 0;
    for (const v of s.indoor) inside += v;
    expect(inside).toBeGreaterThan(drawn * 3); // a cold October evening: most are at home
    leaveStreet(s, w);
    let total = 0;
    for (let i = 0; i < 400; i++) total += w.healthy[i] + w.infected[i] + w.fallen[i];
    expect(total).toBeCloseTo(before, -1);
  });

  it('the dead catch people and people run', () => {
    const w = block();
    const s = enterStreet(w, 0, 0, 20, 20, 10_000);
    const deadAtStart = s.agents.filter((a) => a.kind === Kind.Dead).length;
    for (let t = 0; t < 600; t++) stepStreet(s, w, t);
    const deadNow = s.agents.filter((a) => a.kind === Kind.Dead || (a.kind === Kind.Living && a.turn >= 0)).length;
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

  it('armed people shoot the dead and use up ammo', () => {
    const w = createWorld(10, 10);
    const s = newStreet(0, 0, 10, 10);
    s.agents.push(newAgent(5, 5, Kind.Living, 30));
    for (let k = 0; k < 10; k++) s.agents.push(newAgent(5.6 + k * 0.05, 5, Kind.Dead));
    for (let t = 0; t < 120; t++) stepStreet(s, w, t);
    expect(s.agents.filter((a) => a.kind === Kind.Fallen).length).toBeGreaterThan(0);
    expect(s.agents[0].ammo).toBeLessThan(30);
  });

  it('scared unarmed people run to someone armed', () => {
    const w = createWorld(20, 20);
    const s = newStreet(0, 0, 20, 20);
    const guard = newAgent(8, 10, Kind.Living, 500);
    const runner = newAgent(10, 10, Kind.Living);
    s.agents.push(guard, runner, newAgent(11.2, 10, Kind.Dead));
    const before = Math.abs(runner.x - guard.x);
    for (let t = 0; t < 10; t++) stepStreet(s, w, t);
    expect(Math.abs(runner.x - guard.x)).toBeLessThan(before);
  });
  it('keeps the armed share when one dot stands for many people', () => {
    const w = createWorld(20, 20);
    w.healthy.fill(10);
    w.armed.fill(2);
    w.ammo.fill(40);
    w.moving.fill(10); // everyone out on the street, so everyone is drawn
    const s = enterStreet(w, 0, 0, 20, 20, 200); // about 20 people per dot
    const living = s.agents.filter((a) => a.kind === Kind.Living);
    const armed = living.filter((a) => a.ammo > 0).length;
    expect(armed / living.length).toBeGreaterThan(0.1);
    expect(armed / living.length).toBeLessThan(0.3);
  });

  it('bullets are real: they fly over time, and gunfire draws the dead', () => {
    const w = createWorld(20, 20);
    const s = newStreet(0, 0, 20, 20);
    s.agents.push(newAgent(10, 10, Kind.Living, 50, Role.Police));
    s.agents.push(newAgent(10.6, 10, Kind.Dead));
    const far = newAgent(14, 10, Kind.Dead); // out of sight (316 m), but can hear shots
    s.agents.push(far);
    let sawBulletInFlight = false;
    for (let t = 0; t < 40; t++) {
      stepStreet(s, w, t);
      if (s.bullets.length > 0) sawBulletInFlight = true;
    }
    expect(sawBulletInFlight).toBe(true);
    expect(far.x).toBeLessThan(14 - 0.5);
  });
});
