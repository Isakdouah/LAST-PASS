import { describe, expect, it } from 'vitest';
import { buildNav, field, follow, sees, UNREACHED, at } from './nav';
import { enterStreet, Kind, newAgent, newStreet, Role, stepStreet, M } from './street';
import { createWorld } from './outbreak';

// A wall across the middle of a 4 x 4 cell area, with a gap at the bottom.
const wallAt = (x: number, y: number) => x > 1.9 && x < 2.1 && y < 3.2;

describe('finding the way on foot', () => {
  const n = buildNav(0, 0, 4, 4, M, wallAt);
  it('the way to someone behind a wall goes round it, not through it', () => {
    const f = field(n, [{ x: 3, y: 1 }]);
    // Straight line from (1,1) to (3,1) is 2 cells; round the gap it is much further.
    const metres = (at(n, f, 1, 1) / 5) * n.res * M;
    expect(metres).toBeGreaterThan(3 * M);
    // The first step heads down toward the gap, not right into the wall.
    const d = follow(n, f, 1, 1)!;
    expect(d[1]).toBeGreaterThan(0.5);
  });
  it('nobody sees through a wall', () => {
    expect(sees(n, 1, 1, 3, 1)).toBe(false);
    expect(sees(n, 1, 3.6, 3, 3.6)).toBe(true);
  });
  it('a field does not spread past its reach', () => {
    const f = field(n, [{ x: 0.5, y: 0.5 }], 10);
    expect(at(n, f, 3.5, 3.5)).toBe(UNREACHED);
  });
});

describe('police only shoot at what they can see', () => {
  it('a wall between them: no shot through it; they go round to get a clear shot', () => {
    const w = createWorld(4, 4);
    w.land.fill(1);
    const s = newStreet(0, 0, 4, 4);
    // A short wall this time: the way round is about 80 m.
    const short = (x: number, y: number) => x > 1.9 && x < 2.1 && y < 1.8;
    const cop = newAgent(1.7, 1.4, Kind.Living, 30, Role.Police);
    const z = newAgent(2.3, 1.4, Kind.Dead);
    z.tgt = null;
    s.agents.push(cop, z);
    const startX = cop.x, startY = cop.y;
    for (let k = 0; k < 150; k++) {
      z.x = 2.3; // the dead one stays put behind the wall (for the test)
      z.y = 1.4;
      z.down = 0;
      stepStreet(s, w, k + 1, 1 / 15, short);
    }
    expect(s.stats.blind).toBe(0);
    expect(Math.hypot(cop.x - startX, cop.y - startY) * M).toBeGreaterThan(5);
  });
});

void enterStreet;
