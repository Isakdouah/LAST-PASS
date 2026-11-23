import { describe, expect, it } from 'vitest';
import { createWorld, rng } from './outbreak';
import { equip, Gun, Kind, newAgent, newStreet, PILE, Role, SPARED, stepStreet, TURN } from './street';

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

  it('the bitten fall and shake where they are, then rise in 8-15 s, fast', () => {
    for (let k = 0; k < 20; k++) {
      const w = createWorld(10, 10);
      const s = newStreet(0, 0, 10, 10);
      const p = newAgent(5, 5, Kind.Living);
      const z = newAgent(5.012, 5, Kind.Dead); // within reach
      p.weapon = 0;
      p.bold = 0;
      s.agents.push(p, z);
      let t = 0, bitAt = -1, x = 0, y = 0;
      while (p.kind === Kind.Living && t < 200) {
        stepStreet(s, w, k * 500 + t, 0.25);
        t++;
        if (bitAt < 0 && p.turn >= 0) (bitAt = t), (x = p.x), (y = p.y);
        if (bitAt >= 0 && p.kind === Kind.Living) expect(Math.hypot(p.x - x, p.y - y)).toBeLessThan(1e-9); // lies still
      }
      if (bitAt < 0) continue; // killed it first, or got away
      expect(p.kind).toBe(Kind.Dead);
      const secs = (t - bitAt) * 0.25;
      expect(secs).toBeGreaterThanOrEqual(TURN.min - 0.5);
      expect(secs).toBeLessThanOrEqual(TURN.max + 0.5);
      expect(p.fresh).toBeGreaterThanOrEqual(0);
    }
  });

  it('the dead lunge before they grab (you can see it coming)', () => {
    const w = createWorld(10, 10);
    const s = newStreet(0, 0, 10, 10);
    const p = newAgent(5, 5, Kind.Living);
    const z = newAgent(5 + 4 / 79, 5, Kind.Dead);
    s.agents.push(p, z);
    let lunged = false;
    for (let t = 0; t < 8 && !lunged; t++) {
      stepStreet(s, w, t, 0.25);
      if (z.lunge > 0) lunged = true;
    }
    expect(lunged).toBe(true);
  });

  it('a grabbed pair stays locked together on the spot (no shaking)', () => {
    let checked = 0;
    for (let k = 0; k < 30 && checked < 5; k++) {
      const w = createWorld(10, 10);
      const s = newStreet(0, 0, 10, 10);
      const p = newAgent(5, 5, Kind.Living);
      p.bold = 0;
      const z = newAgent(5.012, 5, Kind.Dead);
      s.agents.push(p, z);
      for (let t = 0; t < 4 && p.held === 0; t++) stepStreet(s, w, k * 100 + t, 0.25);
      if (p.held === 0 || p.turn >= 0) continue;
      const x = p.x, y = p.y;
      for (let t = 0; t < 4 && p.held > 0; t++) {
        stepStreet(s, w, k * 100 + 10 + t, 0.25);
        if (p.held > 0) {
          expect(Math.hypot(p.x - x, p.y - y)).toBeLessThan(1e-9);
          expect(Math.hypot(z.x - p.x, z.y - p.y) * 79).toBeCloseTo(0.45, 1);
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('two of the dead on one person kill them; the trained last until three', () => {
    const pile = (role: Role, n: number) => {
      const w = createWorld(10, 10);
      const s = newStreet(0, 0, 10, 10);
      const p = newAgent(5, 5, Kind.Living, 0, role);
      p.grip = 5;
      s.agents.push(p);
      for (let j = 0; j < n; j++) {
        const z = newAgent(5 + 0.006 * Math.cos(j * 2), 5 + 0.006 * Math.sin(j * 2), Kind.Dead);
        z.hold = p;
        s.agents.push(z);
      }
      stepStreet(s, w, 1, 0.25);
      return p;
    };
    const civ = pile(Role.Civilian, PILE.civ);
    expect(civ.kind).toBe(Kind.Fallen);
    expect(civ.turn).toBe(-1); // eaten: they do not rise
    expect(pile(Role.Police, 2).kind).toBe(Kind.Living);
    expect(pile(Role.Police, PILE.trained).kind).toBe(Kind.Fallen);
  });

  it('friends can pull one of the dead off, and sometimes get grabbed instead', () => {
    let rescues = 0, swapped = 0;
    for (let k = 0; k < 200; k++) {
      const w = createWorld(10, 10);
      const s = newStreet(0, 0, 10, 10);
      const p = newAgent(5, 5, Kind.Living);
      p.grip = 6;
      p.bold = 0;
      const z = newAgent(5.006, 5, Kind.Dead);
      z.hold = p;
      const f = newAgent(5.03, 5, Kind.Living);
      f.bold = 1;
      f.weapon = 2; // baseball bat
      s.agents.push(p, z, f);
      for (let t = 0; t < 12; t++) stepStreet(s, w, k * 50 + t, 0.25);
      rescues += s.stats.rescues;
      if (z.hold === f || f.turn >= 0) swapped++;
    }
    expect(rescues).toBeGreaterThan(40);
    expect(swapped).toBeGreaterThan(0);
  });

  it('shooting one of the dead off someone can hit the person it holds', () => {
    let hurt = 0;
    for (let k = 0; k < 60; k++) {
      const w = createWorld(10, 10);
      const s = newStreet(0, 0, 10, 10);
      const p = newAgent(5, 5, Kind.Living);
      p.grip = 20;
      const z = newAgent(5.006, 5, Kind.Dead);
      z.hold = p;
      const cop = newAgent(5.2, 5, Kind.Living, 30, Role.Police);
      s.agents.push(p, z, cop);
      for (let t = 0; t < 20 && p.kind === Kind.Living; t++) stepStreet(s, w, k * 70 + t, 0.25, undefined, NIGHT);
      if (p.kind === Kind.Fallen && s.stats.eaten === 0) hurt++;
    }
    expect(hurt).toBeGreaterThan(0);
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

  it('the dead pass over people with a fever (SPARED) and go for the healthy one beside them', () => {
    let sparedHurt = 0, otherHurt = 0;
    for (let k = 0; k < 20; k++) {
      const w = createWorld(10, 10);
      const s = newStreet(0, 0, 10, 10);
      const sick = newAgent(5, 5, Kind.Living);
      sick.spared = true;
      const well = newAgent(5.15, 5, Kind.Living);
      s.agents.push(sick, well);
      for (let j = 0; j < 3; j++) s.agents.push(newAgent(5.02 + j * 0.01, 5.02, Kind.Dead));
      for (let t = 0; t < 80; t++) stepStreet(s, w, k * 1000 + t, 0.25, undefined, NIGHT);
      if (sick.kind !== Kind.Living || sick.turn >= 0 || sick.held > 0) sparedHurt++;
      if (well.kind !== Kind.Living || well.turn >= 0) otherHurt++;
    }
    expect(sparedHurt).toBe(0);
    expect(otherHurt).toBeGreaterThan(10);
    expect(SPARED.share).toBeGreaterThan(0);
    expect(SPARED.share).toBeLessThan(0.05); // a few lonely survivors, not a safe crowd
  });
});
