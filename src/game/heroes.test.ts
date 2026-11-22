import { describe, expect, it } from 'vitest';
import { escapeAt, escapeChance, HEROES, leaveChance, routeCells } from './heroes';
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

  /** Play the patch out on a city with no dead in it (so nothing can go wrong on the road). */
  function quietRun(a: string, b: string) {
    const g = new Session(quiet);
    g.reset('play');
    g.mode = 'sandbox'; // radio up whatever the clock says
    g.luck = () => 0; // they always agree
    g.world.infected.fill(0);
    const reply = g.linkHeroes(a, b);
    for (let k = 0; k < 240; k++) {
      g.world.infected.fill(0);
      g.cityStep();
      if (g.heroState(a)!.out && g.heroState(b)!.out) break;
    }
    return { g, reply, A: g.heroState(a)!, B: g.heroState(b)! };
  }
  it('patched heroes meet, then leave the city together', () => {
    const { reply, A, B, g } = quietRun('rosa', 'walt');
    expect(reply).toMatch(/together/);
    expect(A.out && B.out).toBe(true);
    expect(A.fate).toMatch(/escaped the city with/);
    expect(B.fate).toMatch(/escaped the city with/);
    // They really drove there: they end at the edge of the map.
    const edge = (h: typeof A) => Math.min(h.x, h.y, GW - h.x, GH - h.y);
    expect(edge(A)).toBeLessThan(3);
    expect(A.log.some((l) => /Met|came for them/.test(l.text))).toBe(true);
    expect(g.linkLines().length).toBe(0); // nothing left to draw
  });
  it('a hero with no car is picked up and rides out', () => {
    const { A, B } = quietRun('dorms', 'rosa');
    expect(A.riding).toBe(true);
    expect(A.out && B.out).toBe(true);
    expect(A.fate).toMatch(/riding with Rosa/);
  });
  it('they can say no', () => {
    const g = new Session(quiet);
    g.reset('play');
    g.mode = 'sandbox';
    g.luck = () => 1;
    g.linkHeroes('walt', 'gloria');
    expect(g.heroState('walt')!.link).toBeNull();
    expect(g.radio.stats.refused).toBe(1);
  });
  it('waiting with the dead close, strangers give up on each other sooner than friends', () => {
    expect(leaveChance({ bond: 0.3, danger: 0.8, waited: 3 })).toBeGreaterThan(leaveChance({ bond: 0.9, danger: 0.8, waited: 3 }));
    expect(leaveChance({ bond: 0.3, danger: 0, waited: 3 })).toBe(0);
    expect(leaveChance({ bond: 0.3, danger: 0, waited: 20 })).toBeGreaterThan(0); // nobody waits for ever
  });
  it('police sent to St Paul drive there along the streets and report back', () => {
    const g = new Session(quiet);
    g.reset('play');
    g.mode = 'sandbox';
    g.world.infected.fill(0);
    const gl = g.radio.groups.find((x) => x.id === 'gloria')!;
    const p1 = g.radio.groups.find((x) => x.id === 'p1')!;
    p1.trust = 1;
    g.radio.freq = gl.freq;
    g.doPatch();
    g.radio.freq = p1.freq;
    g.doPatch();
    expect(g.radio.convoys.length).toBe(1);
    for (let k = 0; k < 60 && g.radio.convoys.length; k++) {
      g.world.infected.fill(0);
      g.cityStep();
      const c = g.radio.convoys[0];
      if (c) expect(blocked(c.x, c.y)).toBe(false);
    }
    expect(g.radio.convoys.length).toBe(0);
    expect(g.heroState('gloria')!.log.some((l) => /officers from MPD 1st Precinct got through/.test(l.text))).toBe(true);
  });
});
