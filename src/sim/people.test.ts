import { describe, expect, it } from 'vitest';
import { asleepShare, count, createWorld, EVENING, headShare, hitChance, SKILL, step, total } from './outbreak';

const LATE = { hour: 2, dark: 0.9, news: 0 };

describe('people (city maths)', () => {
  it('most people are awake at 7:40 PM and asleep at 2 AM (BLS time-use survey)', () => {
    expect(asleepShare(19.67)).toBeLessThan(0.1);
    expect(asleepShare(0)).toBeGreaterThan(0.6);
    expect(asleepShare(2)).toBeGreaterThan(0.85);
  });

  it('nobody has perfect aim: skill, dark, fear and distance all count', () => {
    const calm = { dark: 0, fear: 0, metres: 5, know: 0 };
    const p = (skill: number) => hitChance({ ...calm, skill });
    expect(p(SKILL.special)).toBeGreaterThan(p(SKILL.soldier));
    expect(p(SKILL.soldier)).toBeGreaterThan(p(SKILL.police));
    expect(p(SKILL.police)).toBeGreaterThan(p(SKILL.regular));
    expect(p(SKILL.regular)).toBeGreaterThan(p(SKILL.untrained));
    // Police, close and calm: in the RAND range for New York (about 30-37%), a little lower
    // because the dead sprint.
    expect(p(SKILL.police)).toBeGreaterThan(0.2);
    expect(p(SKILL.police)).toBeLessThan(0.4);
    const scared = hitChance({ skill: SKILL.police, dark: 0.8, fear: 1, metres: 30, know: 0 });
    expect(scared).toBeLessThan(p(SKILL.police) / 2.5);
    // Veterans keep their nerve better.
    expect(hitChance({ skill: 0.3, dark: 0.8, fear: 1, metres: 15, know: 1 })).toBeGreaterThan(hitChance({ skill: 0.3, dark: 0.8, fear: 1, metres: 15, know: 0 }));
  });

  it('a hit is not a kill until people learn to aim for the head', () => {
    expect(headShare(0)).toBeLessThan(0.2);
    expect(headShare(1)).toBeGreaterThan(0.6);
    const fight = (know: number) => {
      const w = createWorld(1, 1);
      w.healthy[0] = 100;
      w.armed[0] = 30;
      w.ammo[0] = 600;
      w.aware[0] = 1;
      w.know[0] = know;
      w.infected[0] = 40;
      const a = step(w);
      return { heads: a.stats.heads, shots: a.stats.shots };
    };
    const green = fight(0), learned = fight(1);
    expect(learned.heads / learned.shots).toBeGreaterThan((3 * green.heads) / green.shots);
  });

  it('body shots make crawlers; misses in a crowd hit the living', () => {
    const w = createWorld(1, 1);
    w.healthy[0] = 300;
    w.armed[0] = 60;
    w.ammo[0] = 2000;
    w.aware[0] = 1;
    w.infected[0] = 100;
    const a = step(w);
    expect(a.stats.crawlers).toBeGreaterThan(0);
    expect(a.stats.stray).toBeGreaterThan(0);
    expect(a.stats.stray).toBeLessThan(a.stats.shots * 0.05);
    // No crowd, no stray hits: a lone shooter with nobody beside them.
    const b = createWorld(1, 1);
    b.healthy[0] = 1;
    b.armed[0] = 1;
    b.ammo[0] = 10;
    b.aware[0] = 1;
    b.infected[0] = 5;
    expect(step(b).stats.stray).toBeLessThan(0.05);
  });

  it('asleep streets find out later than awake ones', () => {
    const make = () => {
      const w = createWorld(3, 1);
      w.healthy.fill(200);
      w.infected[0] = 30;
      w.healthy[0] = 0;
      return w;
    };
    const evening = step(make(), undefined, EVENING), night = step(make(), undefined, LATE);
    expect(evening.aware[1]).toBeGreaterThan(night.aware[1] * 1.5);
    expect(evening.aware[2]).toBeLessThan(evening.aware[1]); // the next street over hears less
  });

  it('people in danger take the road out; too many at once jam it; nobody is lost or made up', () => {
    const w = createWorld(12, 12);
    w.healthy.fill(800);
    for (let i = 0; i < 12; i++) w.road[6 * 12 + i] = 1;
    w.infected[6 * 12 + 6] = 400;
    let a = w;
    const before = total(w);
    let jam = 0;
    for (let k = 0; k < 40; k++) {
      a = step(a, undefined, EVENING, k + 1);
      jam = Math.max(jam, Math.max(...a.jam));
    }
    expect(a.stats.escaped).toBeGreaterThan(100);
    expect(count(a.escaped)).toBeCloseTo(a.stats.escaped, 0);
    expect(jam).toBeGreaterThan(0.2);
    expect(total(a)).toBeCloseTo(before, -1);
  });

  it('jams and suspicion turn people on each other; a calm voice cuts it', () => {
    const make = (calm: number) => {
      const w = createWorld(1, 1);
      w.healthy[0] = 1000;
      w.armed[0] = 300;
      w.aware[0] = 1;
      w.jam[0] = 1;
      w.infected[0] = 50;
      w.calm[0] = calm;
      return w;
    };
    let tense = 0, calm = 0;
    for (let s = 1; s <= 20; s++) {
      tense += step(make(0), undefined, EVENING, s).stats.fights;
      calm += step(make(1), undefined, EVENING, s).stats.fights;
    }
    expect(tense).toBeGreaterThan(0);
    expect(calm).toBeLessThan(tense * 0.4);
  });
});
