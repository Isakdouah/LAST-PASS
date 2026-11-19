// Street level: near the camera, the people in an area become individuals.
// The living walk, notice the dead and run. The armed stand and shoot until their
// ammo runs out; the unarmed run to them, so groups and last stands form on their own.
// The dead are fast and hunt. Positions are in map cells (1 cell is about 80 m).
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
  /** Rounds left; 0 = unarmed or out of ammo. */
  ammo: number;
  armed: boolean;
  /** Ticks until the next shot. */
  cooldown: number;
  /** Ticks left to draw a muzzle flash. */
  flash: number;
}

export interface Street {
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
const RANGE = 1.0; // how far the armed shoot (cells, about 80 m)
const RALLY = 4; // how far a scared person will run to reach someone armed
const HIT = 0.35; // chance a shot puts one of the dead down
const FIGHT_OFF = 0.15; // chance an unarmed person fights off a bite

export function newAgent(x: number, y: number, kind: Kind, ammo = 0): Agent {
  return { x, y, vx: 0, vy: 0, kind, fear: 0, ammo, armed: ammo > 0, cooldown: 0, flash: 0 };
}

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
      const living = Math.floor(world.healthy[i] / scale + r());
      const armedShare = world.healthy[i] > 0 ? world.armed[i] / world.healthy[i] : 0;
      // Rounds per armed person. Each drawn person is armed by chance, so small
      // shares are not rounded away when one dot stands for many people.
      const ammoEach = world.armed[i] > 0 ? world.ammo[i] / world.armed[i] : 0;
      for (let k = 0; k < living; k++) {
        const ammo = ammoEach > 0 && r() < armedShare ? Math.max(1, Math.round(ammoEach)) : 0;
        agents.push(newAgent(x + r(), y + r(), Kind.Living, ammo));
      }
      let dead = Math.floor(world.infected[i] / scale + r());
      while (dead-- > 0) agents.push(newAgent(x + r(), y + r(), Kind.Dead));
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
  const buckets = new Map<number, Agent[]>();
  const key = (x: number, y: number) => Math.floor(y) * 100000 + Math.floor(x);
  for (const a of s.agents) {
    if (a.kind === Kind.Fallen) continue;
    const k = key(a.x, a.y);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(a);
  }
  const nearest = (a: Agent, test: (o: Agent) => boolean, range: number): Agent | null => {
    let best: Agent | null = null;
    let bd = range * range;
    const R = Math.ceil(range);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const b = buckets.get(key(a.x + dx, a.y + dy));
        if (!b) continue;
        for (const o of b) {
          if (o === a || !test(o)) continue;
          const d = (o.x - a.x) ** 2 + (o.y - a.y) ** 2;
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
      }
    return best;
  };
  const isDead = (o: Agent) => o.kind === Kind.Dead;
  const isLiving = (o: Agent) => o.kind === Kind.Living;
  const isGun = (o: Agent) => o.kind === Kind.Living && o.ammo > 0;

  for (const a of s.agents) {
    if (a.kind === Kind.Fallen) continue;
    if (a.flash > 0) a.flash--;
    let tx = 0;
    let ty = 0;
    let speed = SPEED.walk;
    if (a.kind === Kind.Living) {
      const z = nearest(a, isDead, SEE);
      if (z) a.fear = 1;
      else a.fear = Math.max(0, a.fear - 0.01);
      if (a.ammo > 0 && z && (z.x - a.x) ** 2 + (z.y - a.y) ** 2 < RANGE * RANGE) {
        // Stand and shoot.
        speed = 0;
        if (a.cooldown > 0) a.cooldown--;
        else {
          a.ammo--;
          a.cooldown = 6;
          a.flash = 2;
          if (r() < HIT) z.kind = Kind.Fallen;
        }
      } else if (z) {
        // Run: toward someone armed if one is close and not past the dead, else away.
        const g = a.ammo > 0 ? null : nearest(a, isGun, RALLY);
        if (g && (g.x - a.x) * (z.x - a.x) + (g.y - a.y) * (z.y - a.y) < 0.5) {
          tx = g.x - a.x;
          ty = g.y - a.y;
        } else {
          tx = a.x - z.x;
          ty = a.y - z.y;
        }
        speed = SPEED.run;
      } else {
        tx = a.vx + (r() - 0.5) * 0.02;
        ty = a.vy + (r() - 0.5) * 0.02;
        speed = SPEED.walk + (SPEED.run - SPEED.walk) * a.fear;
      }
    } else {
      const p = nearest(a, isLiving, HUNT);
      if (p) {
        tx = p.x - a.x;
        ty = p.y - a.y;
        if (tx * tx + ty * ty < BITE * BITE) {
          if (p.ammo === 0 && r() < FIGHT_OFF) a.kind = Kind.Fallen; // fought off
          else {
            p.kind = Kind.Dead; // bitten: turns
            p.ammo = 0;
          }
        }
        speed = SPEED.dead;
      } else {
        tx = a.vx + (r() - 0.5) * 0.04;
        ty = a.vy + (r() - 0.5) * 0.04;
        speed = SPEED.walk * 1.5;
      }
    }
    if (speed === 0) continue;
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
      world.armed[i] = 0;
      world.ammo[i] = 0;
    }
  for (const a of s.agents) {
    const i = Math.floor(a.y) * world.width + Math.floor(a.x);
    if (a.kind === Kind.Living) {
      world.healthy[i] += s.scale;
      if (a.ammo > 0) {
        world.armed[i] += s.scale;
        world.ammo[i] += a.ammo * s.scale;
      }
    } else if (a.kind === Kind.Dead) world.infected[i] += s.scale;
    else world.fallen[i] += s.scale;
  }
}
