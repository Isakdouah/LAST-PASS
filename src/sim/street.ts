// Street level: when the camera zooms in, the people in a small area become
// individuals. The living walk, notice the dead and run; the dead are fast and chase.
// Positions are in map-cell units (1 cell is about 80 m). Pure functions, testable.
import { rng, World } from './outbreak';

export const enum Kind {
  Living = 0,
  Dead = 1,
  Fallen = 2,
}

export interface Agent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: Kind;
  /** 0..1, how scared; scared people run faster and stay scared a while. */
  fear: number;
}

export interface Street {
  /** Area of the map this street view covers (cells). */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** How many real people one drawn person stands for. */
  scale: number;
  agents: Agent[];
}

export const SPEED = { walk: 0.006, run: 0.03, dead: 0.036 };
const SEE = 1.6; // how far people notice the dead (cells)
const BITE = 0.12; // contact distance (cells)
const HUNT = 3; // how far the dead notice the living (cells)

/** Spawn individuals from the cell numbers of one area. */
export function enterStreet(world: World, x0: number, y0: number, w: number, h: number, maxAgents = 3000, seed = 1): Street {
  const r = rng(seed);
  let people = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = y * world.width + x;
      people += world.healthy[i] + world.infected[i];
    }
  const scale = Math.max(1, people / maxAgents);
  const agents: Agent[] = [];
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = y * world.width + x;
      if (!world.land[i]) continue;
      const spawn = (n: number, kind: Kind) => {
        let k = Math.floor(n / scale + r());
        while (k-- > 0) agents.push({ x: x + r(), y: y + r(), vx: 0, vy: 0, kind, fear: 0 });
      };
      spawn(world.healthy[i], Kind.Living);
      spawn(world.infected[i], Kind.Dead);
    }
  return { x0, y0, w, h, scale, agents };
}

function isLand(world: World, x: number, y: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= world.width || cy >= world.height) return false;
  return world.land[cy * world.width + cx] === 1;
}

/** One street-level tick. Mutates and returns the street. */
export function stepStreet(s: Street, world: World, seed: number): Street {
  const r = rng(seed);
  // Bucket agents by cell so each one only checks its neighbours.
  const buckets = new Map<number, Agent[]>();
  const key = (x: number, y: number) => Math.floor(y) * 100000 + Math.floor(x);
  for (const a of s.agents) {
    if (a.kind === Kind.Fallen) continue;
    const k = key(a.x, a.y);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(a);
  }
  const nearest = (a: Agent, kind: Kind, range: number): Agent | null => {
    let best: Agent | null = null;
    let bd = range * range;
    const R = Math.ceil(range);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const b = buckets.get(key(a.x + dx, a.y + dy));
        if (!b) continue;
        for (const o of b) {
          if (o.kind !== kind) continue;
          const d = (o.x - a.x) ** 2 + (o.y - a.y) ** 2;
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
      }
    return best;
  };

  for (const a of s.agents) {
    if (a.kind === Kind.Fallen) continue;
    let tx = 0;
    let ty = 0;
    let speed = SPEED.walk;
    if (a.kind === Kind.Living) {
      const z = nearest(a, Kind.Dead, SEE);
      if (z) {
        a.fear = 1;
        tx = a.x - z.x;
        ty = a.y - z.y;
      } else {
        a.fear = Math.max(0, a.fear - 0.01);
        tx = a.vx + (r() - 0.5) * 0.02;
        ty = a.vy + (r() - 0.5) * 0.02;
      }
      speed = SPEED.walk + (SPEED.run - SPEED.walk) * a.fear;
    } else {
      const p = nearest(a, Kind.Living, HUNT);
      if (p) {
        tx = p.x - a.x;
        ty = p.y - a.y;
        if (tx * tx + ty * ty < BITE * BITE) p.kind = Kind.Dead; // bitten: turns
        speed = SPEED.dead;
      } else {
        tx = a.vx + (r() - 0.5) * 0.04;
        ty = a.vy + (r() - 0.5) * 0.04;
        speed = SPEED.walk * 1.5;
      }
    }
    const len = Math.hypot(tx, ty) || 1;
    const vx = (tx / len) * speed;
    const vy = (ty / len) * speed;
    const nx = a.x + vx;
    const ny = a.y + vy;
    const inBox = nx >= s.x0 && ny >= s.y0 && nx < s.x0 + s.w && ny < s.y0 + s.h;
    if (inBox && isLand(world, nx, ny)) {
      a.x = nx;
      a.y = ny;
      a.vx = vx;
      a.vy = vy;
    } else {
      // Blocked by water or the edge of the view: turn somewhere random.
      a.vx = (r() - 0.5) * speed;
      a.vy = (r() - 0.5) * speed;
    }
  }
  return s;
}

/** Write the street result back into the city numbers when the camera leaves. */
export function leaveStreet(s: Street, world: World): void {
  for (let y = s.y0; y < s.y0 + s.h; y++)
    for (let x = s.x0; x < s.x0 + s.w; x++) {
      const i = y * world.width + x;
      world.healthy[i] = 0;
      world.infected[i] = 0;
    }
  for (const a of s.agents) {
    const i = Math.floor(a.y) * world.width + Math.floor(a.x);
    if (a.kind === Kind.Living) world.healthy[i] += s.scale;
    else if (a.kind === Kind.Dead) world.infected[i] += s.scale;
    else world.fallen[i] += s.scale;
  }
}
