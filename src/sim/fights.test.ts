import { describe, expect, it } from 'vitest';
import { createWorld, rng } from './outbreak';
import { equip, Gun, Kind, newAgent, newStreet, Role, stepStreet } from './street';

const NIGHT = { hour: 22, dark: 0.8, news: 0 };

/** One shooter against a line of the dead walking in, many times over. */
function range(know: number, role = Role.Police) {
  const totals = { shots: 0, hits: 0, heads: 0, getUps: 0, crawlers: 0 };
  for (let k = 0; k < 30; k++) {
    const w = createWorld(10, 10);
    const s = newStreet(0, 0, 10, 10);
    const cop = newAgent(5, 5, Kind.Living, 60, role);
    cop.know = know;
    s.agents.push(cop);
    for (let j = 0; j < 8; j++) s.agents.push(newAgent(5.5 + j * 0.06, 5 + (j % 3) * 0.02, Kind.Dead));
    for (let t = 0; t < 60; t++) stepStreet(s, w, k * 1000 + t, 0.25, undefined, NIGHT);
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += s.stats[key];
  }
  return totals;
}

describe('fights (street level)', () => {
  it('police miss most shots at night; early on few hits are head shots', () => {
    const t = range(0);
    expect(t.shots).toBeGreaterThan(100);
    const rate = t.hits / t.shots;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.4);
    expect(t.heads / t.hits).toBeLessThan(0.3);
  });

  it('once they aim for the head, far more hits kill', () => {
    const green = range(0), learned = range(1);
    expect(learned.heads / learned.hits).toBeGreaterThan(0.25); // shots into a crowd also hit the one beside the target
    expect(learned.heads / learned.hits).toBeGreaterThan((2 * green.heads) / green.hits);
  });

  it('body shots knock the dead down and they get back up; some crawl', () => {
    const t = range(0, Role.Hunter);
    expect(t.getUps).toBeGreaterThan(0);
    expect(t.crawlers).toBeGreaterThan(0);
  });

  it('stray bullets hit the living when they are mixed in with the dead', () => {
    let stray = 0;
    for (let k = 0; k < 20; k++) {
      const w = createWorld(10, 10);
      const s = newStreet(0, 0, 10, 10);
      s.agents.push(newAgent(5, 5, Kind.Living, 60, Role.Civilian));
      for (let j = 0; j < 6; j++) s.agents.push(newAgent(5.4, 4.95 + j * 0.02, Kind.Dead));
      for (let j = 0; j < 10; j++) s.agents.push(newAgent(5.45 + (j % 2) * 0.01, 4.9 + j * 0.02, Kind.Living)); // a crowd beside them
      for (let t = 0; t < 40; t++) stepStreet(s, w, k * 77 + t, 0.25, undefined, NIGHT);
      stray += s.stats.stray;
    }
    expect(stray).toBeGreaterThan(0);
  });

  it('people grab what they can; a bat does more than bare hands', () => {
    const duel = (weapon: number) => {
      let won = 0;
      for (let k = 0; k < 120; k++) {
        const w = createWorld(10, 10);
        const s = newStreet(0, 0, 10, 10);
        const a = newAgent(5, 5, Kind.Living);
        a.weapon = weapon;
        a.bold = 1;
        const friend = newAgent(5, 5.05, Kind.Living);
        const z = newAgent(5.08, 5, Kind.Dead);
        s.agents.push(a, friend, z);
        for (let t = 0; t < 30; t++) stepStreet(s, w, k * 31 + t, 0.25, undefined, NIGHT);
        if (z.kind === Kind.Fallen) won++;
      }
      return won;
    };
    expect(duel(2)).toBeGreaterThan(duel(0) * 2); // baseball bat vs bare hands
    // The kit is shared out by the dice: many have nothing at all.
    const r = rng(5);
    let none = 0;
    for (let k = 0; k < 2000; k++) if (equip(newAgent(0, 0, Kind.Living), r).weapon === 0) none++;
    expect(none / 2000).toBeGreaterThan(0.35);
    expect(none / 2000).toBeLessThan(0.55);
  });

  it('the bitten keep going for a while, then turn', () => {
    const w = createWorld(10, 10);
    const s = newStreet(0, 0, 10, 10);
    const p = newAgent(5, 5, Kind.Living);
    p.turn = 10;
    s.agents.push(p);
    for (let t = 0; t < 30; t++) stepStreet(s, w, t, 0.25);
    expect(p.kind).toBe(Kind.Living);
    for (let t = 0; t < 30; t++) stepStreet(s, w, 100 + t, 0.25);
    expect(p.kind).toBe(Kind.Dead);
  });

  it('people drive away on the road, and a crowd of cars jams', () => {
    const w = createWorld(20, 20);
    const s = newStreet(0, 0, 20, 20);
    const road = (x: number, y: number) => Math.abs(y - 10) < 0.3; // one road, east-west
    for (let k = 0; k < 25; k++) {
      const a = newAgent(10 + k * 0.02, 10, Kind.Living);
      a.hasCar = true;
      a.car = 1;
      a.vx = 1;
      s.agents.push(a);
    }
    s.agents.push(newAgent(9, 10, Kind.Dead));
    let stuck = 0;
    for (let t = 0; t < 400; t++) {
      stepStreet(s, w, t, 0.25, undefined, NIGHT, road);
      stuck = Math.max(stuck, s.agents.filter((a) => a.car === 1 && a.stuck > 0.5).length);
    }
    expect(s.stats.drove).toBeGreaterThan(5);
    expect(s.exits.length).toBe(s.stats.drove);
    expect(stuck).toBeGreaterThan(2);
  });

  it('the dead break into houses, and a street in chaos empties out', () => {
    const w = createWorld(6, 6);
    const s = newStreet(0, 0, 6, 6);
    s.indoor.fill(50);
    for (let j = 0; j < 30; j++) s.agents.push(newAgent(3 + (j % 5) * 0.1, 3 + Math.floor(j / 5) * 0.1, Kind.Dead));
    for (let t = 0; t < 800; t++) stepStreet(s, w, t, 0.25, undefined, NIGHT);
    expect(s.stats.caughtInside).toBeGreaterThan(0);
    expect(s.stats.cameOut).toBeGreaterThan(0);
  });

  it('guns: hunters carry rifles or shotguns', () => {
    const r = rng(9);
    const kinds = new Set<Gun>();
    for (let k = 0; k < 300; k++) {
      const a = equip(newAgent(0, 0, Kind.Living, 20), r);
      if (a.role === Role.Hunter) kinds.add(a.gun);
    }
    expect(kinds.has(Gun.Rifle) && kinds.has(Gun.Shotgun)).toBe(true);
  });
});
