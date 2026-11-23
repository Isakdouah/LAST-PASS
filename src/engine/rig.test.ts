import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Kind, newAgent } from '../sim/street';
import { poseOf } from './rig';
import { addHouse, Buf, fitHouse } from './houses';

describe('close-up people and houses', () => {
  it('poses follow the simulation: held and bitten lie down, lunges pitch forward, walkers stand', () => {
    const p = newAgent(0, 0, Kind.Living);
    expect(poseOf(p, 1).hip).toBeGreaterThan(0.8);
    p.held = 1;
    expect(poseOf(p, 1).hip).toBeLessThan(0.3);
    p.held = 0;
    p.turn = 5;
    expect(poseOf(p, 1).pitch).toBeCloseTo(-Math.PI / 2);
    const z = newAgent(0, 0, Kind.Dead);
    z.lunge = 0.3;
    expect(poseOf(z, 1).pitch).toBeGreaterThan(0.5);
    z.lunge = 0;
    z.fresh = 0.1;
    expect(poseOf(z, 1).hip).toBeLessThan(0.3); // just starting to get up
    z.fresh = 5;
    expect(poseOf(z, 1).armL).toBeLessThan(-0.9); // reaching
  });

  it('walking: the leg swinging forward bends its knee, the planted one stays straight', () => {
    const p = newAgent(0, 0, Kind.Living);
    p.vx = 0.01;
    const a = poseOf(p, 0, Math.PI); // left leg coming through
    expect(a.kneeL).toBeGreaterThan(0.5);
    expect(a.kneeR).toBeLessThan(0.15);
    const b = poseOf(p, 0, 0);
    expect(b.kneeR).toBeGreaterThan(0.5);
  });

  it('a house-sized rectangle gets a pitched roof along its long side; a big block does not', () => {
    const rect = (w: number, l: number, ang: number) =>
      [[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]].map(([x, y]) => new THREE.Vector2(x * Math.cos(ang) - y * Math.sin(ang) + 10, x * Math.sin(ang) + y * Math.cos(ang) + 5));
    const f = fitHouse(rect(8, 12, 0.4), 6)!;
    expect(f).not.toBeNull();
    expect(f.hl).toBeCloseTo(6, 3);
    expect(f.hw).toBeCloseTo(4, 3);
    expect(f.cx).toBeCloseTo(10, 3);
    expect(f.cz).toBeCloseTo(5, 3);
    expect(Math.abs(f.ax * Math.cos(0.4) + f.az * Math.sin(0.4))).toBeCloseTo(1, 3);
    // Ridge the long way even when the long side comes second.
    const g = fitHouse(rect(12, 8, 0.4), 6)!;
    expect(g.hl).toBeCloseTo(6, 3);
    expect(g.cx).toBeCloseTo(10, 3);
    expect(g.cz).toBeCloseTo(5, 3);
    expect(fitHouse(rect(30, 40, 0), 6)).toBeNull();
    expect(fitHouse(rect(8, 12, 0), 20)).toBeNull();
    const b: Buf = { P: [], N: [], U: [], S: [], H: [], K: [], I: [] };
    addHouse(b, f, 6, 0.9, [1, 0]);
    let top = 0;
    for (let i = 1; i < b.P.length; i += 3) top = Math.max(top, b.P[i]);
    expect(top).toBeGreaterThan(7); // roof (and chimney) above the walls
    expect(b.K).toContain(4); // a door
  });
});
