import { describe, expect, it } from 'vitest';
import { distanceKm, inWindow, localTime, MPLS, nightOver, passCentre, rateAt, realSeconds, subPoint, untilWindow, WINDOW } from './clock';

describe('orbit clock', () => {
  it('opens six windows, at 20:00 and then every 92 minutes', () => {
    expect(localTime(passCentre(0))).toBe('20:00');
    expect(localTime(passCentre(1))).toBe('21:32');
    expect(inWindow(passCentre(3))).toBe(true);
    expect(inWindow(passCentre(3) + WINDOW + 5)).toBe(false);
    expect(nightOver(passCentre(5) + WINDOW + 60)).toBe(true);
  });
  it('the station is right over Minneapolis at closest approach and far away between passes', () => {
    expect(distanceKm(subPoint(passCentre(2)), MPLS)).toBeLessThan(6);
    expect(distanceKm(subPoint(passCentre(2) + WINDOW), MPLS)).toBeLessThan(1700);
    expect(distanceKm(subPoint(passCentre(2) + 2700), MPLS)).toBeGreaterThan(8000);
  });
  it('time runs slow in the window and fast on the far side, with no jumps', () => {
    expect(rateAt(passCentre(1))).toBe(2);
    expect(rateAt(passCentre(1) + 2700)).toBe(300);
    expect(Math.abs(rateAt(passCentre(1) + WINDOW + 1) - rateAt(passCentre(1) + WINDOW))).toBeLessThan(6);
    expect(untilWindow(passCentre(1) + WINDOW + 10)).toBeGreaterThan(80 * 60);
  });
});

describe('realSeconds after the last pass', () => {
  it('returns Infinity instead of looping forever', () => {
    expect(realSeconds(0, Infinity)).toBe(Infinity);
  });

  it('the orbit track never jumps (no dent between passes)', () => {
    let worst = 0;
    for (let t = 0; t < passCentre(5) + 3000; t += 20) worst = Math.max(worst, distanceKm(subPoint(t), subPoint(t + 20)));
    // 20 s of flight is about 150 km on the ground; a jump would be thousands.
    expect(worst).toBeLessThan(200);
  });
});
