import { describe, expect, it } from 'vitest';
import { dressingSpots } from './dressing';
import { nearOtherRoad } from './props';
import { blocked } from '../game/session';
import { TILE } from '../map/detail';

describe('street dressing', () => {
  it('stop signs, hydrants, poles and carts stand beside streets, never on them or in buildings', () => {
    const seen = { stop: 0, hydrant: 0, pole: 0, cart: 0 };
    let wires = 0;
    for (const [tx, ty] of [[96, 152], [72, 120], [128, 140]]) {
      const x0 = Math.floor(tx / TILE) * TILE, y0 = Math.floor(ty / TILE) * TILE;
      const items = dressingSpots(x0, y0);
      for (const it of items) {
        seen[it.kind]++;
        expect(blocked(it.x, it.y)).toBe(false);
        expect(nearOtherRoad(-1, it.x, it.y, 0.2), `${it.kind} on a street`).toBe(false);
        if (it.next >= 0) {
          wires++;
          expect(items[it.next].kind).toBe('pole');
        }
      }
    }
    expect(seen.stop).toBeGreaterThan(10);
    expect(seen.hydrant).toBeGreaterThan(3);
    expect(seen.pole).toBeGreaterThan(10);
    expect(seen.cart).toBeGreaterThan(2);
    expect(wires).toBeGreaterThan(5);
  });
});
