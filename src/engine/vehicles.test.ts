import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAR_STYLES, SIZE, vehicleGeometry, VKind } from './vehicles';
import { parkedAt, parkedCarSpots } from './city';
import { blocked, GH, GW } from '../game/session';
import { TILE } from '../map/detail';
import { lampSpots, nearOtherRoad } from './props';

describe('size contract', () => {
  it('every vehicle model matches its real 2009 size (within 10 cm)', () => {
    for (const kind of ['car', 'pickup', 'bus', 'ambulance'] as VKind[]) {
      const g = vehicleGeometry(kind, 0xffffff);
      g.computeBoundingBox();
      const b = g.boundingBox!, sz = new THREE.Vector3();
      b.getSize(sz);
      const want = SIZE[kind];
      expect(Math.abs(sz.z - want.l), `${kind} length`).toBeLessThan(0.15);
      expect(Math.abs(sz.x - want.w), `${kind} width`).toBeLessThan(0.15);
      // Height: roof units and light bars may stick up a little above the body.
      expect(sz.y, `${kind} height`).toBeGreaterThan(want.h - 0.15);
      expect(sz.y, `${kind} height`).toBeLessThan(want.h + 0.6);
      expect(b.min.y, `${kind} wheels on the ground`).toBeCloseTo(0, 1);
    }
    // Every car body style keeps the car footprint (parking and collisions rely on it).
    for (let st = 0; st < CAR_STYLES; st++) {
      const g = vehicleGeometry('car', 0xffffff, st);
      g.computeBoundingBox();
      const sz = new THREE.Vector3();
      g.boundingBox!.getSize(sz);
      expect(Math.abs(sz.z - SIZE.car.l), `style ${st} length`).toBeLessThan(0.15);
      expect(Math.abs(sz.x - SIZE.car.w), `style ${st} width`).toBeLessThan(0.15);
      expect(sz.y, `style ${st} height`).toBeLessThan(1.9);
    }
  });
  it('a bus is longer than a car, a car longer than a person is tall', () => {
    expect(SIZE.bus.l).toBeGreaterThan(SIZE.car.l * 2);
    expect(SIZE.car.l).toBeGreaterThan(SIZE.person.h * 2);
  });
});

describe('nothing inside anything', () => {
  it('no parked car stands inside a building (downtown and Powderhorn tiles)', () => {
    let n = 0;
    for (const [tx, ty] of [[96, 120], [128, 118], [96, 152], [72, 120]]) {
      const x0 = Math.floor(tx / TILE) * TILE, y0 = Math.floor(ty / TILE) * TILE;
      for (const c of parkedCarSpots(x0, y0)) {
        n++;
        expect(blocked(c.x, c.y)).toBe(false);
        expect(c.x >= 0 && c.y >= 0 && c.x < GW && c.y < GH).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('parked cars are solid: you cannot stand in one, but you can stand on the pavement beside it', () => {
    const x0 = Math.floor(96 / TILE) * TILE, y0 = Math.floor(152 / TILE) * TILE;
    const spots = parkedCarSpots(x0, y0);
    expect(spots.length).toBeGreaterThan(3);
    for (const c of spots.slice(0, 10)) {
      expect(parkedAt(c.x, c.y)).toBe(true);
      // 2.5 m to the side (across the car) is outside its body.
      const ax = Math.cos(c.angle), ay = -Math.sin(c.angle); // across, in metres
      expect(parkedAt(c.x + (ax * 2.5) / 79, c.y + (ay * 2.5) / 79)).toBe(false);
    }
  });

  it('no lamp post stands on the surface of a street it does not belong to', () => {
    let n = 0;
    for (const [tx, ty] of [[96, 120], [96, 152], [72, 120]]) {
      const x0 = Math.floor(tx / TILE) * TILE, y0 = Math.floor(ty / TILE) * TILE;
      for (const l of lampSpots(x0, y0)) {
        n++;
        expect(nearOtherRoad(-1, l.x, l.y, 0.3)).toBe(false);
      }
    }
    expect(n).toBeGreaterThan(20);
  });
});
