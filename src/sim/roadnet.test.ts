import { describe, expect, it } from 'vitest';
import { buildRoadNet, nearestRoad, pointAt } from './roadnet';
import { decodeShapes, Shapes } from '../map/detail';
import { Agent, Kind, newAgent, newStreet, stepStreet, Street } from './street';
import { createWorld } from './outbreak';
import { blocked, city, roadNet } from '../game/session';

/** Hand-made roads: each a list of points in cells, all 8 m wide. */
function roads(lines: [number, number][][], width = 8): Shapes {
  const q = 64;
  const starts: number[] = [], lens: number[] = [], steps: number[] = [];
  for (const l of lines) {
    const p = l.map(([x, y]) => [Math.round(x * q), Math.round(y * q)]);
    starts.push(p[0][0], p[0][1]);
    let n = 0;
    for (let k = 1; k < p.length; k++) {
      let [ax, ay] = p[k - 1];
      const [bx, by] = p[k];
      const parts = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / 127));
      for (let j = 1; j <= parts; j++) {
        const nx = p[k - 1][0] + Math.round(((bx - p[k - 1][0]) * j) / parts), ny = p[k - 1][1] + Math.round(((by - p[k - 1][1]) * j) / parts);
        steps.push(nx - ax, ny - ay);
        ax = nx;
        ay = ny;
        n++;
      }
    }
    lens.push(n);
  }
  const b64 = (a: ArrayBufferView) => btoa(String.fromCharCode(...new Uint8Array(a.buffer, a.byteOffset, a.byteLength)));
  return decodeShapes(
    { count: lines.length, starts: b64(new Int16Array(starts)), lens: b64(new Uint16Array(lens)), steps: b64(new Int8Array(steps)), meta: b64(new Uint8Array(lines.map(() => width))) },
    q,
  );
}

function driver(x: number, y: number): Agent {
  const a = newAgent(x, y, Kind.Living);
  a.car = 1;
  a.hasCar = true;
  return a;
}

// Deep inside a building (not just clipping a corner the map draws over the road by a metre or two).
// A road that the map runs under a building (a ramp or passage) does not count: that is map data.
const deep = (x: number, y: number) => [[0, 0], [0.025, 0], [-0.025, 0], [0, 0.025], [0, -0.025]].every(([dx, dy]) => blocked(x + dx, y + dy)) && !nearestRoad(roadNet(), x, y, 0.06);

describe('road network for cars', () => {
  it('joins two roads that cross, even with no shared point', () => {
    const net = buildRoadNet(roads([[[0, 5], [10, 5]], [[5, 0], [5, 10]]]));
    expect(net.n).toBe(4);
    expect(net.adj.some((a) => a.length === 4)).toBe(true);
  });
  it('joins a road that ends on the side of another (a T-junction)', () => {
    const net = buildRoadNet(roads([[[0, 5], [10, 5]], [[5, 0], [5, 4.98]]]));
    expect(net.adj.some((a) => a.length === 3)).toBe(true);
  });
  it('finds the nearest road and points along it', () => {
    const net = buildRoadNet(roads([[[0, 5], [10, 5]]]));
    const h = nearestRoad(net, 3, 5.1, 0.5)!;
    expect(h).not.toBeNull();
    expect(h.dist).toBeCloseTo(0.1, 3);
    const p = pointAt(net, h.edge, h.along);
    expect(p.x).toBeCloseTo(3, 2);
    expect(p.tx).toBeCloseTo(1, 3);
  });
  it('a car keeps to its lane, turns smoothly and never jumps (hand-made grid)', () => {
    const grid: [number, number][][] = [];
    for (let k = 2; k <= 18; k += 4) grid.push([[0, k], [20, k]], [[k, 0], [k, 20]]);
    const net = buildRoadNet(roads(grid));
    const s = newStreet(0, 0, 20, 20);
    const w = createWorld(20, 20);
    for (let i = 0; i < 12; i++) s.agents.push(driver(2 + (i % 4) * 4, 6 + Math.floor(i / 4) * 4));
    let maxTurn = 0, maxOff = 0, maxJump = 0;
    for (let t = 0; t < 400; t++) {
      const before = new Map(s.agents.map((a) => [a.uid, [a.x, a.y, a.face]]));
      stepStreet(s, w, t, 0.25, undefined, undefined, undefined, net);
      s.agents.forEach((a) => {
        const b = before.get(a.uid)!;
        if (a.car !== 1 || a.gone || t === 0) return; // (the first step puts them on the road)
        const d = Math.atan2(Math.sin(a.face - b[2]), Math.cos(a.face - b[2]));
        maxTurn = Math.max(maxTurn, Math.abs(d));
        maxJump = Math.max(maxJump, Math.hypot(a.x - b[0], a.y - b[1]) * 79);
        maxOff = Math.max(maxOff, nearestRoad(net, a.x, a.y, 1)!.dist * 79);
      });
    }
    expect(maxTurn).toBeLessThanOrEqual(3 * 0.25 + 1e-6); // never spins on the spot
    expect(maxJump).toBeLessThan(14 * 0.25 + 0.5); // never teleports
    expect(maxOff).toBeLessThan(4.5); // in its lane, at most cutting a corner a little
  });
  it('a wreck blocks the lane: the car behind stops short, then turns round', () => {
    const net = buildRoadNet(roads([[[0, 5], [30, 5]]]));
    const s: Street = newStreet(0, 0, 30, 10);
    const w = createWorld(30, 10);
    const a = driver(10, 5);
    s.agents.push(a);
    s.wrecks.push({ x: 10 + 25 / 79, y: 5 + 2 / 79, face: 0, burn: 0, crashed: true, uid: 1 });
    // Point it at the wreck.
    stepStreet(s, w, 1, 0.25, undefined, undefined, undefined, net);
    a.dir = 1;
    a.nxt = -1;
    let closest = Infinity, turned = false;
    for (let t = 0; t < 80; t++) {
      stepStreet(s, w, t + 2, 0.25, undefined, undefined, undefined, net);
      if (a.car !== 1) break;
      closest = Math.min(closest, Math.hypot(a.x - s.wrecks[0].x, a.y - s.wrecks[0].y) * 79);
      if (a.dir === -1) turned = true;
    }
    expect(closest).toBeGreaterThan(3.5);
    expect(turned).toBe(true);
  });
  it('cars are solid: a jam is bumper to bumper, never two cars in one spot', () => {
    const net = buildRoadNet(roads([[[0, 5], [60, 5]]]));
    const s: Street = newStreet(0, 0, 60, 10);
    const w = createWorld(60, 10);
    for (let x = 31; x < 44; x += 0.2) s.agents.push(driver(x, 5));
    s.wrecks.push({ x: 46, y: 5 + 2 / 79, face: 0, burn: 0, crashed: true, uid: 1 });
    let worst = Infinity, queued = 0;
    for (let t = 0; t < 400; t++) {
      stepStreet(s, w, t + 1, 0.25, undefined, undefined, undefined, net);
      const cars = s.agents.filter((a) => a.car === 1 && !a.gone);
      if (t < 5) continue;
      for (let i = 0; i < cars.length; i++)
        for (let j = i + 1; j < cars.length; j++) {
          const a = cars[i], b = cars[j];
          if (Math.abs(a.y - b.y) * 79 > 1.5) continue; // other lane
          worst = Math.min(worst, Math.abs(a.x - b.x) * 79);
        }
      queued = Math.max(queued, cars.filter((a) => a.spd < 0.5).length);
    }
    expect(worst).toBeGreaterThan(4); // car bodies are 4.4 m long: they touch at most
    expect(worst).toBeLessThan(6.5); // ...and they do close up: a queue, not a gap
    expect(queued).toBeGreaterThan(1);
  });
  it('cars crossing at a junction never drive through each other', () => {
    const net = buildRoadNet(roads([[[0, 10], [40, 10]], [[20, 0], [20, 40]]]));
    const s: Street = newStreet(0, 0, 40, 40);
    const w = createWorld(40, 40);
    // Zone centre is the junction, so everyone drives away from it... start them past it,
    // pointed back in, and let them turn wherever they like.
    for (let k = 0; k < 10; k++) s.agents.push(driver(21 + k * 0.15, 10), driver(20, 21 + k * 0.15), driver(19 - k * 0.15, 10), driver(20, 19 - k * 0.15));
    stepStreet(s, w, 1, 0.25, undefined, undefined, undefined, net);
    for (const a of s.agents) (a.dir = -a.dir), (a.face += Math.PI), (a.nxt = -1);
    let worst = Infinity;
    for (let t = 0; t < 200; t++) {
      stepStreet(s, w, t + 2, 0.25, undefined, undefined, undefined, net);
      const cars = s.agents.filter((a) => a.car === 1 && !a.gone);
      for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) worst = Math.min(worst, Math.hypot(cars[i].x - cars[j].x, cars[i].y - cars[j].y) * 79);
    }
    expect(worst).toBeGreaterThan(1.8); // two bodies side by side at the very least, never one spot
  });
  it('on the real map, cars stay on the streets and out of buildings', () => {
    const net = roadNet();
    // Downtown Minneapolis and the blocks around it, 40 x 40 cells.
    const s = newStreet(80, 80, 40, 40);
    let k = 0;
    for (let i = 0; i < 400 && s.agents.length < 60; i++) {
      const x = 82 + ((i * 7.3) % 36), y = 82 + ((i * 5.1) % 36);
      const h = nearestRoad(net, x, y, 0.3);
      if (!h) continue;
      const p = pointAt(net, h.edge, h.along);
      s.agents.push(driver(p.x, p.y));
      k++;
    }
    expect(k).toBeGreaterThan(40);
    let samples = 0, inside = 0;
    for (let t = 0; t < 480; t++) {
      stepStreet(s, city.world, t, 0.25, blocked, undefined, undefined, net);
      for (const a of s.agents)
        if (a.car === 1 && !a.gone) {
          samples++;
          if (deep(a.x, a.y)) inside++;
        }
    }
    expect(samples).toBeGreaterThan(5000);
    expect(inside / samples).toBeLessThan(0.003);
  });
});
