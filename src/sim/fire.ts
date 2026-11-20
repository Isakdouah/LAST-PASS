// Fires: fighting starts them, wind (from the west) spreads them through built-up blocks,
// they burn out when there is nothing left. Fire stations put out fires near them,
// but only while their crews are alive. One value per map cell.
import { rng, World } from './outbreak';

export interface Fires {
  fire: Float32Array; // 0..1 how hard it burns
  fuel: Float32Array; // 0..1 what is left to burn (built-up share)
}

export function createFires(buildings: Uint8Array): Fires {
  const fuel = new Float32Array(buildings.length);
  for (let i = 0; i < fuel.length; i++) fuel[i] = Math.min(1, buildings[i] / 160);
  return { fire: new Float32Array(fuel.length), fuel };
}

/**
 * One tick. `fighting` = how much fighting happened per cell this tick (people fallen).
 * `stations` = cell indices of fire stations.
 */
export function stepFires(f: Fires, w: World, fighting: Float32Array, stations: number[], seed: number): void {
  const r = rng(seed);
  const { width, height } = w;
  const next = f.fire.slice();
  // Crews that are still alive cover the cells around their station.
  const covered = new Uint8Array(f.fire.length);
  for (const s of stations) {
    if (w.healthy[s] < Math.max(5, w.infected[s])) continue;
    const sx = s % width;
    const sy = Math.floor(s / width);
    for (let y = Math.max(0, sy - 8); y <= Math.min(height - 1, sy + 8); y++)
      for (let x = Math.max(0, sx - 8); x <= Math.min(width - 1, sx + 8); x++) covered[y * width + x] = 1;
  }
  for (let i = 0; i < f.fire.length; i++) {
    const fuel = f.fuel[i];
    if (fighting[i] > 0 && fuel > 0.1 && r() < Math.min(0.01, fighting[i] * 0.0008) * fuel) next[i] = Math.max(next[i], 0.3);
    const fi = f.fire[i];
    if (fi <= 0) continue;
    if (fuel > 0.05) {
      next[i] = Math.min(1, next[i] + 0.08);
      f.fuel[i] = Math.max(0, fuel - 0.006 * fi);
    } else next[i] = Math.max(0, next[i] - 0.06);
    if (covered[i]) next[i] = Math.max(0, next[i] - 0.12);
    // Spread to neighbours with something to burn; the wind blows east.
    if (fi > 0.4) {
      const x = i % width;
      const y = Math.floor(i / width);
      const nb: [number, number][] = [];
      if (x < width - 1) nb.push([i + 1, 1.8]);
      if (x > 0) nb.push([i - 1, 0.5]);
      if (y > 0) nb.push([i - width, 1]);
      if (y < height - 1) nb.push([i + width, 1]);
      for (const [j, wgt] of nb)
        if (f.fire[j] === 0 && f.fuel[j] > 0.2 && w.land[j] && r() < 0.008 * wgt * f.fuel[j]) next[j] = 0.2;
    }
    // People in a burning block flee or die.
    const loss = 0.01 * fi;
    const h = w.healthy[i] * loss;
    const z = w.infected[i] * loss;
    w.healthy[i] -= h;
    w.armed[i] *= 1 - loss;
    w.infected[i] -= z;
    w.fallen[i] += h + z;
  }
  f.fire.set(next);
}
