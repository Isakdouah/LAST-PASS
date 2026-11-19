// The ground simulation, version 0.
// People are numbers per map cell, not individual objects, so millions fit.
// Each cell holds healthy people, infected (the fast dead) and the fallen.
// Pure functions + a seeded random generator, so every rule can be tested.

export interface World {
  width: number;
  height: number;
  /** false = water or blocked: the dead cannot cross (for now). */
  land: Uint8Array;
  healthy: Float32Array;
  infected: Float32Array;
  fallen: Float32Array;
}

export interface Rules {
  /** How hard the dead bite: share of healthy people turned per tick at full contact. */
  bite: number;
  /** Share of the infected in a cell that move to neighbours each tick (fast swarm). */
  surge: number;
  /** Share of the infected put down by the living each tick, scaled by how outnumbered they are. */
  resistance: number;
}

export const DEFAULT_RULES: Rules = { bite: 0.6, surge: 0.35, resistance: 0.05 };

export function createWorld(width: number, height: number): World {
  const n = width * height;
  return {
    width,
    height,
    land: new Uint8Array(n).fill(1),
    healthy: new Float32Array(n),
    infected: new Float32Array(n),
    fallen: new Float32Array(n),
  };
}

export function total(w: World): number {
  let t = 0;
  for (let i = 0; i < w.healthy.length; i++) t += w.healthy[i] + w.infected[i] + w.fallen[i];
  return t;
}

export function count(arr: Float32Array): number {
  let t = 0;
  for (let i = 0; i < arr.length; i++) t += arr[i];
  return t;
}

/** Small deterministic random generator (mulberry32). Same seed, same outbreak. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Advance the world by one tick. Returns a new world; the old one is untouched. */
export function step(w: World, rules: Rules = DEFAULT_RULES): World {
  const { width, height, land } = w;
  const healthy = w.healthy.slice();
  const infected = w.infected.slice();
  const fallen = w.fallen.slice();

  // 1. Bites and losses inside each cell.
  for (let i = 0; i < healthy.length; i++) {
    const h = healthy[i];
    const z = infected[i];
    if (z <= 0 || h <= 0) continue;
    const contact = z / (h + z);
    const turned = Math.min(h, h * rules.bite * contact);
    const putDown = Math.min(z, z * rules.resistance * (h / (h + z)));
    healthy[i] = h - turned;
    infected[i] = z + turned - putDown;
    fallen[i] += putDown;
  }

  // 2. The swarm moves toward the living (4 neighbours, water blocks).
  const moved = new Float32Array(infected.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const z = infected[i];
      if (z <= 0) continue;
      const nbrs: number[] = [];
      if (x > 0) nbrs.push(i - 1);
      if (x < width - 1) nbrs.push(i + 1);
      if (y > 0) nbrs.push(i - width);
      if (y < height - 1) nbrs.push(i + width);
      const open = nbrs.filter((j) => land[j]);
      if (open.length === 0) continue;
      // Pull: weight each neighbour by how many living are there (plus a little wander).
      let sum = 0;
      const weights = open.map((j) => {
        const wgt = healthy[j] + 1;
        sum += wgt;
        return wgt;
      });
      const leaving = z * rules.surge;
      moved[i] -= leaving;
      open.forEach((j, k) => {
        moved[j] += (leaving * weights[k]) / sum;
      });
    }
  }
  for (let i = 0; i < infected.length; i++) infected[i] = Math.max(0, infected[i] + moved[i]);

  return { width, height, land, healthy, infected, fallen };
}
