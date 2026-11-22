import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { blocked, det } from '../game/session';
import { buildingGeometry, localToCell } from './city';
import { TILE } from '../map/detail';

describe('buildings', () => {
  it('walls face outward, so you never see into a building', () => {
    let n = 0, out = 0, agree = 0, inw = 0;
    // Tiles around the hospital and downtown.
    for (let ty = 112; ty < 128; ty += TILE) for (let tx = 88; tx < 108; tx += TILE) {
      const x0 = Math.floor(tx / TILE) * TILE, y0 = Math.floor(ty / TILE) * TILE;
      const g = buildingGeometry(det.buildings, x0, y0);
      if (!g) continue;
      const P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute;
      const I = g.index!;
      const K = g.attributes.aK as THREE.BufferAttribute;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Vector3(), nn = new THREE.Vector3();
      for (let i = 0; i < I.count; i += 3) {
        const i0 = I.getX(i), i1 = I.getX(i + 1), i2 = I.getX(i + 2);
        if (Math.abs(N.getY(i0)) > 0.5) continue; // roof
        if (K.getX(i0) !== 0 && K.getX(i0) !== 6) continue; // porches, doors, chimneys: their backs face the house
        a.fromBufferAttribute(P, i0), b.fromBufferAttribute(P, i1), c.fromBufferAttribute(P, i2);
        const face = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
        nn.set(N.getX(i0), 0, N.getZ(i0));
        if (face.dot(nn) > 0.9) agree++;
        m.copy(a).add(b).add(c).divideScalar(3);
        const o = localToCell(m.clone().addScaledVector(nn, 3)), ins = localToCell(m.clone().addScaledVector(nn, -3));
        if (!blocked(o.x, o.y) && blocked(ins.x, ins.y)) out++;
        if (blocked(o.x, o.y) && !blocked(ins.x, ins.y)) inw++;
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(agree / n).toBe(1); // drawn side = the side the light thinks is the front
    expect(out).toBeGreaterThan(inw * 10); // front side points away from the building (a coarse grid leaves many unclear)
  });
});
