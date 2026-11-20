// Street level: near the camera, the people in an area become individuals.
// The living walk, notice the dead and run. The armed stand and shoot real (visible)
// bullets until their ammo runs out; the unarmed run to them, so groups and last stands
// form on their own. Gunfire is loud: it draws the dead. The dead are fast and hunt.
// Positions are in map cells (1 cell is about 79 m); speeds and ranges are set in metres
// and seconds of game time, so the street looks right at any zoom.
import { rng, World } from './outbreak';

export const enum Kind {
  Living = 0,
  Dead = 1,
  Fallen = 2,
}

export const enum Role {
  Civilian = 0,
  Police = 1,
}

export interface Agent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: Kind;
  role: Role;
  /** 0..1, how scared; scared people run faster and stay scared a while. */
  fear: number;
  /** Rounds left; 0 = unarmed or out of ammo. */
  ammo: number;
  armed: boolean;
  /** Seconds until the next shot. */
  cooldown: number;
  /** Frames left to draw a muzzle flash. */
  flash: number;
  /** Facing, radians (for drawing). */
  face: number;
  /** Cached nearest threat or prey, re-checked every few steps (saves time). */
  tgt: Agent | null;
  think: number;
}

export interface Bullet {
  x: number;
  y: number;
  dx: number; // cells per second
  dy: number;
  life: number; // seconds left
  px: number; // previous position, for the tracer streak
  py: number;
}

export interface Mark {
  x: number;
  y: number;
  t: number; // seconds left
}

export interface Street {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** How many real people one drawn person stands for. */
  scale: number;
  agents: Agent[];
  bullets: Bullet[];
  /** Where shots were fired recently: the dead come to the noise. */
  noise: Mark[];
  /** Bullet impacts (puffs) and blood, for drawing. */
  puffs: Mark[];
  blood: { x: number; y: number }[];
  /** Shots fired in the last step (for sound). */
  shots: number;
}

export const M = 79; // metres per cell
/** Inside a building? (People walk around buildings; walls stop bullets.) */
export type Blocked = (x: number, y: number) => boolean;
const open: Blocked = () => false;
const m = (metres: number) => metres / M;
/** Metres per second (game time). The dead are fast. */
export const SPEED = { walk: 1.4, run: 4.6, dead: 5.6 };
const SEE = m(120); // how far people notice the dead
const BITE = m(1.3); // contact distance
const HUNT = m(200); // how far the dead notice the living
const HEAR = m(450); // how far the dead hear gunfire
const RANGE = { civ: m(55), police: m(90) }; // how far the armed shoot
const COOL = { civ: 1.3, police: 0.6 }; // seconds between shots
const SPREAD = { civ: 0.07, police: 0.035 }; // aim error, radians
const BULLET_SPEED = m(170); // slowed down so you can see it (real bullets are invisible)
const HIT_R = m(1.8); // a bullet passing this close to one of the dead hits it
const RALLY = m(300); // how far a scared person will run to reach someone armed
const FIGHT_OFF = 0.15; // chance an unarmed person fights off a bite

export function newAgent(x: number, y: number, kind: Kind, ammo = 0, role = Role.Civilian): Agent {
  return { x, y, vx: 0, vy: 0, kind, role, fear: 0, ammo, armed: ammo > 0, cooldown: 0, flash: 0, face: 0, tgt: null, think: 0 };
}

export function newStreet(x0: number, y0: number, w: number, h: number, scale = 1): Street {
  return { x0, y0, w, h, scale, agents: [], bullets: [], noise: [], puffs: [], blood: [], shots: 0 };
}

/** Spawn individuals from the cell numbers of one area. `police` = cell indices of police stations. */
export function enterStreet(
  world: World,
  x0: number,
  y0: number,
  w: number,
  h: number,
  maxAgents = 3000,
  seed = 1,
  police?: Set<number>,
  blocked: Blocked = open,
): Street {
  const r = rng(seed);
  let people = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = y * world.width + x;
      people += world.healthy[i] + world.infected[i];
    }
  const s = newStreet(x0, y0, w, h, Math.max(1, people / maxAgents));
  const scale = s.scale;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = y * world.width + x;
      if (!world.land[i]) continue;
      const living = Math.floor(world.healthy[i] / scale + r());
      const armedShare = world.healthy[i] > 0 ? world.armed[i] / world.healthy[i] : 0;
      // Rounds per armed person. Each drawn person is armed by chance, so small
      // shares are not rounded away when one dot stands for many people.
      const ammoEach = world.armed[i] > 0 ? world.ammo[i] / world.armed[i] : 0;
      const isStation = police?.has(i) ?? false;
      for (let k = 0; k < living; k++) {
        const ammo = ammoEach > 0 && r() < armedShare ? Math.max(1, Math.round(ammoEach)) : 0;
        // Police stand in a loose ring around their station.
        const role = isStation && ammo > 0 ? Role.Police : Role.Civilian;
        let ax = 0, ay = 0;
        for (let tries = 0; tries < 6; tries++) {
          ax = role === Role.Police ? x + 0.5 + (r() - 0.5) * 0.5 : x + r();
          ay = role === Role.Police ? y + 0.5 + (r() - 0.5) * 0.5 : y + r();
          if (!blocked(ax, ay)) break;
        }
        s.agents.push(newAgent(ax, ay, Kind.Living, ammo, role));
      }
      let dead = Math.floor(world.infected[i] / scale + r());
      while (dead-- > 0) {
        let ax = 0, ay = 0;
        for (let tries = 0; tries < 6; tries++) {
          ax = x + r();
          ay = y + r();
          if (!blocked(ax, ay)) break;
        }
        s.agents.push(newAgent(ax, ay, Kind.Dead));
      }
    }
  return s;
}

function isLand(world: World, x: number, y: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= world.width || cy >= world.height) return false;
  return world.land[cy * world.width + cx] === 1;
}

/** One street-level step of `dt` game seconds. Mutates and returns the street. */
export function stepStreet(s: Street, world: World, seed: number, dt = 0.25, blocked: Blocked = open): Street {
  const r = rng(seed);
  s.shots = 0;
  // Spatial buckets: half a cell each.
  const B = 2;
  const buckets = new Map<number, Agent[]>();
  const key = (x: number, y: number) => Math.floor(y * B) * 100000 + Math.floor(x * B);
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
    const R = Math.ceil(range * B);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const b = buckets.get(key(a.x + dx / B, a.y + dy / B));
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
  const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  for (const a of s.agents) {
    if (a.kind === Kind.Fallen) continue;
    if (a.flash > 0) a.flash--;
    let tx = 0;
    let ty = 0;
    let speed = 0; // metres per second
    if (a.kind === Kind.Living) {
      if (--a.think <= 0 || (a.tgt && a.tgt.kind !== Kind.Dead)) {
        a.tgt = nearest(a, isDead, SEE);
        a.think = 3 + Math.floor(r() * 3);
      }
      const z = a.tgt;
      if (z) a.fear = 1;
      else a.fear = Math.max(0, a.fear - 0.03 * dt);
      const range = a.role === Role.Police ? RANGE.police : RANGE.civ;
      if (a.cooldown > 0) a.cooldown -= dt;
      if (a.ammo > 0 && z && d2(a, z) < range * range) {
        // Stand and shoot: a real bullet, aimed with some error.
        a.face = Math.atan2(z.y - a.y, z.x - a.x);
        if (a.cooldown <= 0) {
          const spread = (a.role === Role.Police ? SPREAD.police : SPREAD.civ) * (1 + a.fear * 0.5);
          const ang = a.face + (r() - 0.5) * 2 * spread;
          s.bullets.push({
            x: a.x,
            y: a.y,
            px: a.x,
            py: a.y,
            dx: Math.cos(ang) * BULLET_SPEED,
            dy: Math.sin(ang) * BULLET_SPEED,
            life: (range * 1.6) / BULLET_SPEED,
          });
          a.ammo--;
          a.cooldown = (a.role === Role.Police ? COOL.police : COOL.civ) * (0.8 + r() * 0.4);
          a.flash = 3;
          s.shots++;
          s.noise.push({ x: a.x, y: a.y, t: 8 });
        }
      } else if (z && a.ammo > 0) {
        // Armed, the dead seen but not yet in range: hold, or close up with other guns.
        const g = nearest(a, (o) => isGun(o) && o !== a, m(40));
        if (!g && a.role !== Role.Police) {
          const g2 = nearest(a, (o) => isGun(o) && o !== a, RALLY);
          if (g2) {
            tx = g2.x - a.x;
            ty = g2.y - a.y;
            speed = SPEED.run;
          }
        }
        a.face = Math.atan2(z.y - a.y, z.x - a.x);
      } else if (z) {
        // Run: toward someone armed if one is close and not past the dead, else away.
        const g = nearest(a, isGun, RALLY);
        if (g && (g.x - a.x) * (z.x - a.x) + (g.y - a.y) * (z.y - a.y) < 0) {
          // Get behind the gun: aim for a spot on the far side from the dead.
          const gx = g.x + (g.x - z.x) * 0.08;
          const gy = g.y + (g.y - z.y) * 0.08;
          tx = gx - a.x;
          ty = gy - a.y;
          speed = tx * tx + ty * ty < m(2) ** 2 ? 0 : SPEED.run;
        } else {
          tx = a.x - z.x;
          ty = a.y - z.y;
          speed = SPEED.run;
        }
      } else if (a.role !== Role.Police || a.fear < 0.5) {
        tx = a.vx + (r() - 0.5) * 0.02;
        ty = a.vy + (r() - 0.5) * 0.02;
        speed = a.role === Role.Police ? 0 : SPEED.walk + (SPEED.run - SPEED.walk) * a.fear;
      }
    } else {
      if (--a.think <= 0 || (a.tgt && a.tgt.kind !== Kind.Living)) {
        a.tgt = nearest(a, isLiving, HUNT);
        a.think = 3 + Math.floor(r() * 3);
      }
      const p = a.tgt;
      if (p) {
        tx = p.x - a.x;
        ty = p.y - a.y;
        if (tx * tx + ty * ty < BITE * BITE) {
          if (p.ammo === 0 && r() < FIGHT_OFF) {
            a.kind = Kind.Fallen; // fought off
            s.blood.push({ x: a.x, y: a.y });
          } else {
            p.kind = Kind.Dead; // bitten: turns
            p.ammo = 0;
            s.blood.push({ x: p.x, y: p.y });
          }
        }
        speed = SPEED.dead;
      } else {
        // No one in sight: go toward the nearest gunfire, else drift.
        let best: Mark | null = null;
        let bd = HEAR * HEAR;
        for (const n of s.noise) {
          const d = d2(a, n);
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
        if (best) {
          tx = best.x - a.x;
          ty = best.y - a.y;
          speed = SPEED.dead * 0.8;
        } else {
          tx = a.vx + (r() - 0.5) * 0.04;
          ty = a.vy + (r() - 0.5) * 0.04;
          speed = SPEED.walk * 1.3;
        }
      }
      if (tx || ty) a.face = Math.atan2(ty, tx);
    }
    if (speed === 0) {
      a.vx = a.vy = 0;
      continue;
    }
    const step = m(speed) * dt;
    const len = Math.hypot(tx, ty) || 1;
    const vx = (tx / len) * step;
    const vy = (ty / len) * step;
    const nx = a.x + vx;
    const ny = a.y + vy;
    const inBox = nx >= s.x0 && ny >= s.y0 && nx < s.x0 + s.w && ny < s.y0 + s.h;
    let ok = inBox && isLand(world, nx, ny) && (!blocked(nx, ny) || blocked(a.x, a.y));
    let mx = nx, my = ny;
    if (!ok && inBox) {
      // Slide along walls: try moving on one axis only.
      if (isLand(world, nx, a.y) && !blocked(nx, a.y)) (ok = true), (my = a.y);
      else if (isLand(world, a.x, ny) && !blocked(a.x, ny)) (ok = true), (mx = a.x);
    }
    if (ok) {
      const nx = mx, ny = my;
      a.x = nx;
      a.y = ny;
      a.vx = vx;
      a.vy = vy;
      if (a.kind === Kind.Living && speed > SPEED.walk) a.face = Math.atan2(vy, vx);
    } else {
      a.vx = (r() - 0.5) * step;
      a.vy = (r() - 0.5) * step;
    }
  }

  // Bullets fly; the first of the dead close to the path goes down.
  const alive: Bullet[] = [];
  for (const b of s.bullets) {
    b.px = b.x;
    b.py = b.y;
    const nx = b.x + b.dx * dt;
    const ny = b.y + b.dy * dt;
    let hit: Agent | null = null;
    let ht = 2;
    const len2 = (nx - b.x) ** 2 + (ny - b.y) ** 2 || 1e-9;
    const R = Math.ceil(Math.sqrt(len2) * B) + 1;
    const cx = (b.x + nx) / 2;
    const cy = (b.y + ny) / 2;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const bucket = buckets.get(key(cx + dx / B, cy + dy / B));
        if (!bucket) continue;
        for (const o of bucket) {
          if (o.kind !== Kind.Dead) continue;
          // Closest point on the segment.
          const t = Math.max(0, Math.min(1, ((o.x - b.x) * (nx - b.x) + (o.y - b.y) * (ny - b.y)) / len2));
          const qx = b.x + (nx - b.x) * t;
          const qy = b.y + (ny - b.y) * t;
          if ((o.x - qx) ** 2 + (o.y - qy) ** 2 < HIT_R * HIT_R && t < ht) {
            ht = t;
            hit = o;
          }
        }
      }
    if (hit) {
      hit.kind = Kind.Fallen;
      s.blood.push({ x: hit.x, y: hit.y });
      s.puffs.push({ x: hit.x, y: hit.y, t: 0.4 });
      continue;
    }
    b.x = nx;
    b.y = ny;
    b.life -= dt;
    if (b.life > 0 && isLand(world, nx, ny) && !blocked(nx, ny)) alive.push(b);
    else s.puffs.push({ x: nx, y: ny, t: 0.3 });
  }
  s.bullets = alive;
  s.noise = s.noise.filter((n) => (n.t -= dt) > 0);
  if (s.noise.length > 60) s.noise = s.noise.slice(-60);
  s.puffs = s.puffs.filter((p) => (p.t -= dt) > 0);
  if (s.blood.length > 4000) s.blood = s.blood.slice(-4000);
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
