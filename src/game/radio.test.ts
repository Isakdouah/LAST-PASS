import { describe, expect, it } from 'vitest';
import { createWorld } from '../sim/outbreak';
import { createRadio, nextLine, patch, stepRadio, tuned, warn } from './radio';

function setup() {
  const w = createWorld(360, 260);
  w.healthy.fill(10);
  const r = createRadio();
  return { w, r };
}

describe('radio', () => {
  it('you only hear a group when the dial is close to its frequency', () => {
    const { r } = setup();
    r.freq = 146.52;
    expect(tuned(r).group?.id).toBe('walt');
    r.freq = 146.7;
    expect(tuned(r).signal).toBeLessThan(0.75); // faint: you hear something, not words
    r.freq = 145.75;
    expect(tuned(r).group).toBeNull();
  });
  it('a group you warn decides for itself; if they trust you they gather and get ready', () => {
    const { w, r } = setup();
    const walt = r.groups.find((g) => g.id === 'walt')!;
    walt.trust = 1;
    const i = Math.floor(walt.y) * 360 + Math.floor(walt.x);
    const before = w.healthy[i];
    expect(warn(r, w, walt, 0, 1)).toContain('Copy');
    expect(w.guard[i]).toBe(1);
    expect(w.healthy[i]).toBeGreaterThan(before);
    const p1 = r.groups.find((g) => g.id === 'p1')!;
    p1.trust = 0;
    let refused = 0;
    for (let s = 0; s < 20; s++) if (warn(r, w, p1, 0, s + 10).includes('believe')) refused++;
    expect(refused).toBeGreaterThan(5);
  });
  it('a false alarm costs trust; patching police to a group in trouble sends officers who drive there', () => {
    const { w, r } = setup();
    const walt = r.groups.find((g) => g.id === 'walt')!;
    walt.trust = 1;
    warn(r, w, walt, 0, 1);
    for (let t = 1; t < 95; t++) stepRadio(r, w, t);
    expect(walt.trust).toBeLessThan(1);
    expect(r.stats.warnWrong).toBe(1);
    const p1 = r.groups.find((g) => g.id === 'p1')!;
    p1.trust = 1;
    const pi = Math.floor(p1.y) * 360 + Math.floor(p1.x);
    w.healthy[pi] = 50;
    w.armed[pi] = 40;
    w.ammo[pi] = 4000;
    expect(patch(r, w, p1, walt, 3)).toContain('Sending');
    expect(r.convoys.length).toBe(1);
    for (let t = 0; t < 60; t++) stepRadio(r, w, 100 + t);
    expect(r.convoys.length).toBe(0);
    expect(r.stats.moved).toBeGreaterThan(0);
  });
  it('stars say their lines in order and an overrun group goes silent', () => {
    const { w, r } = setup();
    const rosa = r.groups.find((g) => g.id === 'rosa')!;
    expect(nextLine(r, w, rosa, 0)).toContain('Rosa');
    const i = Math.floor(rosa.y) * 360 + Math.floor(rosa.x);
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) { w.healthy[i + y * 360 + x] = 0; w.infected[i + y * 360 + x] = 30; }
    stepRadio(r, w, 1);
    stepRadio(r, w, 2);
    expect(rosa.silent).toBe(true);
  });
});
