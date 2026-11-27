import { describe, expect, it } from 'vitest';
import { createWorld, count } from '../sim/outbreak';
import { createHoldouts, Holdout, HoldKind, KINDS, stepHoldouts, sheltered, insideDead } from './holdouts';

function oneHold(kind: HoldKind, people: number, armed: number, ammo: number): { w: ReturnType<typeof createWorld>; h: Holdout; H: { list: Holdout[]; arrived: number } } {
  const w = createWorld(12, 12);
  w.land.fill(1);
  const H = createHoldouts([], w, 0);
  const k = KINDS[kind];
  const h: Holdout = { id: 0, name: kind, kind, x: 6.5, y: 6.5, fort: k.fort, cap: k.cap, screen: k.screen, people, armed, ammo, hidden: 0, inside: 0, boards: 0.3, know: 0.2, state: 'holding', fellAt: -1, peak: people, routedUntil: -1, seenAt: -1, seen: null, downed: 0 };
  H.list.push(h);
  return { w, h, H };
}

/** The same siege (the dead keep coming, Z at the door) for three hours, many times. */
function held(kind: HoldKind, people: number, armed: number, ammo: number, Z = 60, tries = 40) {
  let stood = 0;
  for (let k = 0; k < tries; k++) {
    const { w, h, H } = oneHold(kind, people, armed, ammo);
    for (let m = 0; m < 180; m++) {
      w.infected[6 * 12 + 6] = Math.max(w.infected[6 * 12 + 6], Z);
      stepHoldouts(H, w, m * 60, 0.8, k * 1000 + m);
    }
    if (h.state !== 'fallen') stood++;
  }
  return stood / tries;
}

describe('holdouts', () => {
  it('a precinct holds better than a fire station, which holds better than flats', () => {
    const p = held('precinct', 100, 30, 1500), f = held('station', 70, 15, 600), a = held('apartments', 100, 15, 600);
    expect(p).toBeGreaterThan(a);
    expect(f).toBeGreaterThan(a);
  });
  it('crowding a place past its room makes it weaker', () => {
    const room = held('apartments', 300, 40, 1500), packed = held('apartments', 700, 40, 1500);
    expect(room).toBeGreaterThan(packed);
  });
  it('pooled guns and rounds help: the same flats hold longer with them', () => {
    expect(held('apartments', 150, 40, 3000)).toBeGreaterThan(held('apartments', 150, 2, 50));
  });
  it('people come in from nearby when the dead are close, more when you route them', () => {
    const run = (routed: boolean) => {
      const w = createWorld(20, 20);
      w.land.fill(1);
      w.healthy.fill(100);
      w.aware.fill(1);
      const H = createHoldouts([{ x: 10, y: 10, kind: 'hospital', name: 'Test Hospital' }], w, 0);
      if (routed) H.list[0].routedUntil = 1e9;
      w.infected[3 * 20 + 3] = 30;
      w.infected[10 * 20 + 13] = 20;
      for (let m = 0; m < 20; m++) stepHoldouts(H, w, m * 60, 0.8, m);
      return H.list[0].people;
    };
    const plain = run(false), told = run(true);
    expect(plain).toBeGreaterThan(5);
    expect(told).toBeGreaterThan(plain * 1.3);
  });
  it('nobody appears or vanishes: the living, the dead and the fallen add up', () => {
    const w = createWorld(20, 20);
    w.land.fill(1);
    w.healthy.fill(50);
    w.aware.fill(0.8);
    w.armed.fill(5);
    w.ammo.fill(60);
    for (let i = 0; i < 20; i++) w.infected[i * 20 + 9] = 15;
    const H = createHoldouts([{ x: 10, y: 10, kind: 'fire', name: 'Station' }, { x: 5, y: 5, kind: 'hospital', name: 'Hospital' }], w, 0);
    const sum = () => count(w.healthy) + count(w.infected) + count(w.fallen) + sheltered(H) + insideDead(H);
    const before = sum();
    for (let m = 0; m < 120; m++) stepHoldouts(H, w, m * 60, 0.8, m + 7);
    expect(Math.abs(sum() - before)).toBeLessThan(0.5);
  });
});

describe('holdouts: doors', () => {
  it('police and firefighters shut the doors when full; a hospital keeps taking people', () => {
    const fill = (kind: 'police' | 'hospital') => {
      const w = createWorld(20, 20);
      w.land.fill(1);
      w.healthy.fill(400);
      w.aware.fill(1);
      const H = createHoldouts([{ x: 10, y: 10, kind, name: 'x' }], w, 0);
      H.list[0].routedUntil = 1e9;
      for (let m = 0; m < 120; m++) stepHoldouts(H, w, m * 60, 0.8, m);
      return H.list[0].people / H.list[0].cap;
    };
    expect(fill('police')).toBeLessThanOrEqual(1.06);
    expect(fill('hospital')).toBeGreaterThan(1.3);
  });
});
