import { describe, expect, it } from 'vitest';
import { escapeAt, escapeChance, HEROES, routeCells } from './heroes';
import { blocked, GH, GW, Session } from './session';

const quiet = { start() {}, hush() {}, setStatic() {}, say() {}, shot() {}, muted: true } as never;

/** Force the dead onto a hero's block, run one city step, and see what happened. */
function overrun(g: Session, id: string) {
  const gr = g.radio.groups.find((x) => x.id === id)!;
  const i = Math.floor(gr.y) * GW + Math.floor(gr.x);
  g.world.infected[i] += 5000;
  g.world.healthy[i] = Math.min(g.world.healthy[i], 5);
  g.world.armed[i] = g.world.ammo[i] = g.world.guard[i] = 0;
  g.cityStep();
  return { gr, hs: g.heroState(id)! };
}

describe('heroes', () => {
  it('help in time makes a narrow escape more likely; no close calls left means none', () => {
    const base = { left: 1, helpedAgo: Infinity, vehicle: true, trust: 0.4, pressure: 0.8 };
    expect(escapeChance({ ...base, helpedAgo: 5 })).toBeGreaterThan(escapeChance(base));
    expect(escapeChance({ ...base, left: 0 })).toBe(0);
    expect(escapeChance(base)).toBeLessThan(0.5); // plot armour is a chance, not a guarantee
  });
  it('escape routes are pure functions of time and end where they should', () => {
    for (const h of HEROES) {
      const a = escapeAt(h, 120), b = escapeAt(h, 120);
      expect(b).toEqual(a);
      const end = escapeAt(h, 1e6);
      const pts = routeCells(h);
      expect(end.arrived).toBe(true);
      expect(end.x).toBeCloseTo(pts[pts.length - 1].x);
      for (const p of pts) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.y).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(GW);
        expect(p.y).toBeLessThan(GH);
      }
    }
  });
  it('nobody drives through a building (escape routes stay on streets)', () => {
    for (const h of HEROES) {
      const pts = routeCells(h);
      let n = 0, hit = 0;
      const where: string[] = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.0625); // every ~5 m
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps, y = a.y + ((b.y - a.y) * k) / steps;
          n++;
          if (blocked(x, y)) {
            hit++;
            if (where.length < 5) where.push(`${x.toFixed(2)},${y.toFixed(2)} (leg ${i})`);
          }
        }
      }
      expect(hit / n, `${h.name}: ${where.join(' ')}`).toBeLessThan(0.01);
    }
  });
  it('a close call turns a death into an escape, and costs something', () => {
    const g = new Session(quiet);
    g.reset('play');
    g.luck = () => 0;
    const { gr, hs } = overrun(g, 'walt');
    expect(hs.dead).toBe(false);
    expect(hs.closeCallsUsed).toBe(1);
    expect(hs.escapeStart).toBeGreaterThanOrEqual(0);
    expect(hs.pending.length).toBeGreaterThan(0);
    expect(gr.fate).toBe('');
    // They drive away along the route and arrive.
    for (let k = 0; k < 40; k++) g.cityStep();
    expect(hs.arrived).toBe(true);
  });
  it('without luck, or with no close calls left, a hero can really die', () => {
    const g = new Session(quiet);
    g.reset('play');
    g.luck = () => 1;
    expect(overrun(g, 'rosa').hs.dead).toBe(true);
    const g2 = new Session(quiet);
    g2.reset('play');
    g2.luck = () => 0;
    g2.heroState('dorms')!.left = 0;
    expect(overrun(g2, 'dorms').hs.dead).toBe(true);
  });
});
