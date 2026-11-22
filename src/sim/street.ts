// Street level: near the camera, the people in an area become individuals.
// Most people are indoors (and late at night, asleep); only those outside are drawn, and
// the rest come out when their street goes into chaos, or are caught when the dead get in.
// Every person has a skill, maybe a gun, maybe something to swing, and a temper.
// Guns miss a lot (RAND: New York police hit 18-37% of shots); a hit is not a kill unless
// it is the head; body hits knock the dead down (they get up), and some become crawlers.
// Misses fly on and can hit the living. The bitten may hide it until they turn.
// People run to their cars and drive, until the road jams.
// Positions are in map cells (1 cell is about 79 m); speeds and ranges are set in metres
// and seconds of game time, so the street looks right at any zoom.
import { endNode, nearestRoad, pointAt, RoadNet, RoadPoint } from './roadnet';
import { CAR_SHARE, EVENING, Env, headShare, hitChance, outsideShare, rng, SKILL, World } from './outbreak';

export const enum Kind {
  Living = 0,
  Dead = 1,
  Fallen = 2,
}

export const enum Role {
  Civilian = 0,
  Police = 1,
  Hunter = 2,
  Soldier = 3,
}

export const enum Gun {
  None = 0,
  Handgun = 1,
  Shotgun = 2,
  Rifle = 3,
}

/** What a body hit does, per gun (guess): seconds knocked down, and chance to cripple. */
export const GUNS = [
  { name: 'none', knock: 0, cripple: 0 },
  { name: 'handgun', knock: 1.5, cripple: 0.08 },
  { name: 'shotgun', knock: 3, cripple: 0.25 },
  { name: 'rifle', knock: 2.5, cripple: 0.3 },
];

/** Things people grab. Share = how many have it to hand (guess; many have nothing).
 *  kill = chance one swing puts one down for good (a blow to the head); knock = knocks it over. */
export const WEAPONS = [
  { name: 'bare hands', share: 0.45, kill: 0.01, knock: 0.08 },
  { name: 'kitchen knife', share: 0.15, kill: 0.1, knock: 0.04 },
  { name: 'baseball bat', share: 0.1, kill: 0.14, knock: 0.4 },
  { name: 'hockey stick', share: 0.1, kill: 0.06, knock: 0.35 },
  { name: 'crowbar', share: 0.08, kill: 0.18, knock: 0.35 },
  { name: 'frying pan', share: 0.05, kill: 0.05, knock: 0.3 },
  { name: 'hammer', share: 0.04, kill: 0.15, knock: 0.2 },
  { name: 'machete', share: 0.03, kill: 0.3, knock: 0.3 },
];

export interface Agent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: Kind;
  role: Role;
  /** 0..1, how scared; scared people run faster and shoot worse. */
  fear: number;
  /** Rounds left; 0 = no gun or out of ammo. */
  ammo: number;
  armed: boolean;
  gun: Gun;
  /** Base hit chance per shot (calm, close, good light). */
  skill: number;
  /** Index into WEAPONS: what they swing when it comes to that. */
  weapon: number;
  /** 0..1: knows to go for the head (learned, heard, or seen). */
  know: number;
  /** 0..1: fights rather than runs. */
  bold: number;
  hasCar: boolean;
  /** 0 on foot, 1 driving, 2 trying to get to their car. */
  car: number;
  /** Seconds the car has been stuck. */
  stuck: number;
  /** Driving on the road network: edge, metres from its start, direction (+1 / -1),
   *  speed (m/s), and the turn already chosen at the next junction (-1 = none yet). */
  road: number;
  along: number;
  dir: number;
  spd: number;
  nxt: number;
  nxtDir: number;
  nxtTurn: number;
  /** Stable number for this person (colours, names), never reused. */
  uid: number;
  /** Bitten: seconds until they turn (-1 = not bitten). They may hide it. */
  turn: number;
  /** The dead: seconds still knocked down. */
  down: number;
  /** The dead: legs gone, crawling. */
  crawl: boolean;
  /** Seconds until the next shot or swing. */
  cooldown: number;
  /** Frames left to draw a muzzle flash. */
  flash: number;
  /** Facing, radians (for drawing). */
  face: number;
  /** Cached nearest threat or prey, re-checked every few steps (saves time). */
  tgt: Agent | null;
  think: number;
  /** Left the area (drove off): removed at the end of the step. */
  gone: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  dx: number; // cells per second
  dy: number;
  life: number; // seconds left
  px: number; // previous position, for the tracer streak
  py: number;
  /** Who it was aimed at, and whether the shot was true (decided when fired). */
  target: Agent | null;
  hit: boolean;
  head: boolean;
  gun: Gun;
  from: Agent | null;
}

export interface Mark {
  x: number;
  y: number;
  t: number; // seconds left
}

export interface StreetStats {
  shots: number;
  hits: number;
  heads: number;
  /** Bullets that hit a living person (missed shots and suspicion). */
  stray: number;
  /** The living killed on purpose by the living (someone they thought was bitten). */
  fights: number;
  /** The dead put down by hand. */
  melee: number;
  bites: number;
  /** Knocked-down dead that got back up: proof that only the head counts. */
  getUps: number;
  crawlers: number;
  /** Cars that got out of the area. */
  drove: number;
  /** Cars that crashed, and cars left behind in a jam. */
  crashes: number;
  abandoned: number;
  /** People who came out of buildings, and people caught inside. */
  cameOut: number;
  caughtInside: number;
}

export interface Exit {
  x: number;
  y: number;
  armed: boolean;
  ammo: number;
}

export interface Wreck {
  x: number;
  y: number;
  face: number;
  /** Seconds it still burns (0 = not on fire, just dead or left). */
  burn: number;
  /** Crashed (true) or just left in a jam (false). */
  crashed: boolean;
  uid: number;
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
  /** Real people indoors, per cell of the area (not drawn), with their guns. */
  indoor: Float32Array;
  indoorArmed: Float32Array;
  indoorAmmo: Float32Array;
  /** 0..1 per cell: how many indoors know (lights on, doors barricaded). */
  aware: Float32Array;
  /** Fractions of a drawn person waiting to come out / turn inside. */
  pendOut: Float32Array;
  pendDead: Float32Array;
  /** Cars that drove out of the area since the session last looked. */
  exits: Exit[];
  /** Crashed and abandoned cars: they stay where they stopped and block the lane. */
  wrecks: Wreck[];
  stats: StreetStats;
}

export const M = 79; // metres per cell
/** Inside a building? (People walk around buildings; walls stop bullets.) */
export type Blocked = (x: number, y: number) => boolean;
const open: Blocked = () => false;
const anyRoad: Blocked = () => true;
const m = (metres: number) => metres / M;
/** Metres per second (game time). The dead are fast. */
export const SPEED = { walk: 1.4, run: 4.6, dead: 5.6, crawl: 0.8, car: 9 };
const SEE = m(120); // how far people notice the dead
const BITE = m(1.3); // contact distance
const HUNT = m(200); // how far the dead notice the living
const HEAR = m(450); // how far the dead hear gunfire
const RANGE = { civ: m(55), police: m(90) }; // how far the armed shoot
const COOL = { civ: 1.3, police: 0.6 }; // seconds between shots
const BULLET_SPEED = m(170); // slowed down so you can see it (real bullets are invisible)
const BODY_R = m(0.6); // a stray bullet passing this close to someone may hit them
const STRAY_HIT = 0.35; // chance it does (one of the dead, coming at you)
const STRAY_LIVING = 0.08; // people duck, run, stand behind the shooter (guess)
const RALLY = m(300); // how far a scared person will run to reach someone armed
const SWING = 0.9; // seconds between swings

export function emptyStats(): StreetStats {
  return { shots: 0, hits: 0, heads: 0, stray: 0, fights: 0, melee: 0, bites: 0, getUps: 0, crawlers: 0, drove: 0, crashes: 0, abandoned: 0, cameOut: 0, caughtInside: 0 };
}

/** A new person or one of the dead. Old call shape kept: (x, y, kind, ammo, role). */
let nextUid = 1;
export function newAgent(x: number, y: number, kind: Kind, ammo = 0, role = Role.Civilian): Agent {
  const skill = role === Role.Police ? SKILL.police : role === Role.Hunter ? SKILL.hunter : role === Role.Soldier ? SKILL.soldier : SKILL.regular;
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    kind,
    role,
    fear: 0,
    ammo,
    armed: ammo > 0,
    gun: ammo > 0 ? (role === Role.Hunter ? Gun.Rifle : Gun.Handgun) : Gun.None,
    skill,
    weapon: 0,
    know: 0,
    bold: 0.5,
    hasCar: false,
    car: 0,
    stuck: 0,
    road: -1,
    along: 0,
    dir: 1,
    spd: 0,
    nxt: -1,
    nxtDir: 1,
    nxtTurn: 0,
    uid: nextUid++,
    turn: -1,
    down: 0,
    crawl: false,
    cooldown: 0,
    flash: 0,
    face: 0,
    tgt: null,
    think: 0,
    gone: false,
  };
}

/** Give a civilian their kit by the dice: skill and gun if armed, something to swing, a car. */
export function equip(a: Agent, r: () => number, know = 0): Agent {
  if (a.kind !== Kind.Living) return a;
  if (a.armed && a.role === Role.Civilian) {
    const t = r();
    if (t < 0.3) (a.skill = SKILL.untrained), (a.gun = Gun.Handgun);
    else if (t < 0.75) (a.skill = SKILL.regular), (a.gun = r() < 0.7 ? Gun.Handgun : Gun.Shotgun);
    else (a.skill = SKILL.hunter), (a.role = Role.Hunter), (a.gun = r() < 0.5 ? Gun.Rifle : Gun.Shotgun);
  }
  let w = r(), k = 0;
  while (k < WEAPONS.length - 1 && w >= WEAPONS[k].share) (w -= WEAPONS[k].share), k++;
  a.weapon = k;
  a.know = r() < know ? 1 : 0;
  a.bold = r();
  a.hasCar = a.role === Role.Civilian || a.role === Role.Hunter ? r() < CAR_SHARE * 0.75 : false; // can reach theirs
  return a;
}

export function newStreet(x0: number, y0: number, w: number, h: number, scale = 1): Street {
  const n = w * h;
  return {
    x0,
    y0,
    w,
    h,
    scale,
    agents: [],
    bullets: [],
    noise: [],
    puffs: [],
    blood: [],
    shots: 0,
    indoor: new Float32Array(n),
    indoorArmed: new Float32Array(n),
    indoorAmmo: new Float32Array(n),
    aware: new Float32Array(n),
    pendOut: new Float32Array(n),
    pendDead: new Float32Array(n),
    exits: [],
    wrecks: [],
    stats: emptyStats(),
  };
}

function spot(x: number, y: number, r: () => number, blocked: Blocked, centre = false): [number, number] {
  let ax = 0, ay = 0;
  for (let tries = 0; tries < 8; tries++) {
    ax = centre ? x + 0.5 + (r() - 0.5) * 0.5 : x + r();
    ay = centre ? y + 0.5 + (r() - 0.5) * 0.5 : y + r();
    if (!blocked(ax, ay)) break;
  }
  return [ax, ay];
}

/** Spawn individuals from the cell numbers of one area. `police` = cell indices of police
 *  stations. Only people outside (or on the road) are drawn; the rest stay indoors. */
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
  env: Env = EVENING,
): Street {
  const r = rng(seed);
  const baseOut = outsideShare(env.hour);
  const outShare = (i: number) => {
    const hh = world.healthy[i];
    if (hh <= 0) return 0;
    if (police?.has(i)) return 1;
    return Math.min(1, baseOut + world.moving[i] / hh + 0.15 * world.aware[i] * Math.min(1, world.infected[i] / 3));
  };
  let people = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = y * world.width + x;
      people += world.healthy[i] * outShare(i) + world.infected[i];
    }
  const s = newStreet(x0, y0, w, h, Math.max(1, people / maxAgents));
  const scale = s.scale;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = y * world.width + x;
      const li = (y - y0) * w + (x - x0);
      if (!world.land[i]) continue;
      const share = outShare(i);
      const out = world.healthy[i] * share;
      const living = Math.floor(out / scale + r());
      // What stays inside is what was not drawn, so nobody is lost to rounding.
      const drawnShare = world.healthy[i] > 0 ? Math.min(1, (living * scale) / world.healthy[i]) : 0;
      s.indoor[li] = Math.max(0, world.healthy[i] - living * scale);
      s.indoorArmed[li] = world.armed[i] * (1 - drawnShare);
      s.indoorAmmo[li] = world.ammo[i] * (1 - drawnShare);
      s.aware[li] = world.aware[i];
      const armedShare = world.healthy[i] > 0 ? world.armed[i] / world.healthy[i] : 0;
      // Rounds per armed person. Each drawn person is armed by chance, so small
      // shares are not rounded away when one dot stands for many people.
      const ammoEach = world.armed[i] > 0 ? world.ammo[i] / world.armed[i] : 0;
      const isStation = police?.has(i) ?? false;
      const moving = world.healthy[i] > 0 ? world.moving[i] / world.healthy[i] : 0;
      for (let k = 0; k < living; k++) {
        const ammo = ammoEach > 0 && r() < armedShare ? Math.max(1, Math.round(ammoEach)) : 0;
        // Police stand in a loose ring around their station.
        const role = isStation && ammo > 0 ? Role.Police : Role.Civilian;
        const a = equip(newAgent(...spot(x, y, r, blocked, role === Role.Police), Kind.Living, ammo, role), r, world.know[i]);
        if (moving > 0 && r() < moving / Math.max(share, 1e-6)) (a.fear = 1), (a.car = a.hasCar ? 2 : 0);
        s.agents.push(a);
      }
      let dead = Math.floor(world.infected[i] / scale + r());
      const crawlShare = world.infected[i] > 0 ? world.crawl[i] / world.infected[i] : 0;
      while (dead-- > 0) {
        const z = newAgent(...spot(x, y, r, blocked), Kind.Dead);
        z.crawl = r() < crawlShare;
        s.agents.push(z);
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

/** One street-level step of `dt` game seconds. Mutates and returns the street.
 *  `onRoad` says where a car can drive (defaults to anywhere not blocked). */
export function stepStreet(s: Street, world: World, seed: number, dt = 0.25, blocked: Blocked = open, env: Env = EVENING, onRoad: Blocked = anyRoad, net?: RoadNet, wet: Blocked = open): Street {
  const r = rng(seed);
  s.shots = 0;
  const st = s.stats;
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
  const nearest = (a: { x: number; y: number }, test: (o: Agent) => boolean, range: number, self?: Agent): Agent | null => {
    let best: Agent | null = null;
    let bd = range * range;
    const R = Math.ceil(range * B);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const b = buckets.get(key(a.x + dx / B, a.y + dy / B));
        if (!b) continue;
        for (const o of b) {
          if (o === self || !test(o)) continue;
          const d = (o.x - a.x) ** 2 + (o.y - a.y) ** 2;
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
      }
    return best;
  };
  const countNear = (a: Agent, test: (o: Agent) => boolean, range: number, cap = 6): number => {
    let n = 0;
    const R = Math.ceil(range * B);
    const r2 = range * range;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const b = buckets.get(key(a.x + dx / B, a.y + dy / B));
        if (!b) continue;
        for (const o of b) if (o !== a && test(o) && (o.x - a.x) ** 2 + (o.y - a.y) ** 2 < r2 && ++n >= cap) return n;
      }
    return n;
  };
  const isDead = (o: Agent) => o.kind === Kind.Dead;
  const isUp = (o: Agent) => o.kind === Kind.Dead && o.down <= 0;
  const isLiving = (o: Agent) => o.kind === Kind.Living && o.car !== 1;
  const isGun = (o: Agent) => o.kind === Kind.Living && o.ammo > 0 && o.car !== 1;
  const isCar = (o: Agent) => o.kind === Kind.Living && o.car === 1;
  const showing = (o: Agent) => o.kind === Kind.Living && o.turn >= 0 && o.turn < 25; // sweating, shaking, grey
  const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const cellCalm = (a: Agent) => {
    const cx = Math.floor(a.x), cy = Math.floor(a.y);
    return cx >= 0 && cy >= 0 && cx < world.width && cy < world.height ? world.calm[cy * world.width + cx] : 0;
  };
  const bitten = (p: Agent) => {
    if (p.turn < 0) {
      p.turn = 20 + r() * 70; // they turn in a minute or so, and may hide it till then
      st.bites++;
      s.blood.push({ x: p.x, y: p.y });
    }
  };
  const fire = (a: Agent, target: Agent, aimAtLiving: boolean) => {
    const metres = Math.sqrt(d2(a, target)) * M;
    const p = hitChance({ skill: a.skill, dark: env.dark, fear: a.fear, metres, know: a.know });
    const hit = r() < p;
    const head = hit && !aimAtLiving && r() < headShare(a.know);
    // A miss goes off to one side; a hit goes true.
    const err = hit ? 0 : (r() < 0.5 ? -1 : 1) * (0.04 + r() * 0.2);
    const ang = Math.atan2(target.y - a.y, target.x - a.x) + err;
    const range = a.role === Role.Police ? RANGE.police : RANGE.civ;
    s.bullets.push({ x: a.x, y: a.y, px: a.x, py: a.y, dx: Math.cos(ang) * BULLET_SPEED, dy: Math.sin(ang) * BULLET_SPEED, life: (range * 1.6) / BULLET_SPEED, target, hit, head, gun: a.gun, from: a });
    a.ammo--;
    a.cooldown = (a.role === Role.Police || a.role === Role.Soldier ? COOL.police : COOL.civ) * (0.8 + r() * 0.4);
    a.flash = 3;
    a.face = ang;
    s.shots++;
    st.shots++;
    s.noise.push({ x: a.x, y: a.y, t: 8 });
  };

  // ---- Cars on the real road network (when the session passes one in) ----
  // A car follows a road line in its own lane (right-hand side), slows for turns and for
  // whatever is ahead, and turns smoothly. It never leaves the road, so it never clips
  // into a building. Panicked drivers crash; a wreck stays put and blocks the lane.
  const pa: RoadPoint = { x: 0, y: 0, tx: 1, ty: 0 };
  const pb: RoadPoint = { x: 0, y: 0, tx: 1, ty: 0 };
  const pc: RoadPoint = { x: 0, y: 0, tx: 1, ty: 0 };
  const zoneCx = s.x0 + s.w / 2, zoneCy = s.y0 + s.h / 2;
  const wantDir = (a: Agent): [number, number] => {
    let wx = a.x - zoneCx, wy = a.y - zoneCy;
    const wl = Math.hypot(wx, wy) || 1;
    wx /= wl;
    wy /= wl;
    const z = a.tgt;
    if (z && z.kind === Kind.Dead) {
      const zl = Math.sqrt(d2(a, z)) || 1;
      wx += ((a.x - z.x) / zl) * 1.5;
      wy += ((a.y - z.y) / zl) * 1.5;
    }
    return [wx, wy];
  };
  /** Unit direction (cells) over the first or last 12 m of edge e, driven in direction dir. */
  const edgeDir = (e: number, dir: number, atEnd: boolean): [number, number] => {
    const N = net!, L = N.elen[e];
    const from = dir > 0 ? (atEnd ? Math.max(0, L - 12) : 0) : atEnd ? Math.min(L, 12) : L;
    pointAt(N, e, from, pa);
    pointAt(N, e, from + dir * 12, pb);
    const dx = pb.x - pa.x, dy = pb.y - pa.y, l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  /** Choose the turn at the next junction: away from the dead and out of the area. */
  const plan = (a: Agent) => {
    const N = net!;
    const node = endNode(N, a.road, a.dir);
    const [ix, iy] = edgeDir(a.road, a.dir, true);
    const [wx, wy] = wantDir(a);
    let best = -1, bd = 1, bs = -Infinity;
    for (const e of N.adj[node])
      for (const d of [1, -1]) {
        if ((d > 0 ? N.ea[e] : N.eb[e]) !== node) continue;
        if (e === a.road && d === -a.dir) continue; // straight back the way it came
        const [ox, oy] = edgeDir(e, d, false);
        const score = ox * wx + oy * wy + (ox * ix + oy * iy) * 0.6 + N.ewid[e] / 30 + r() * 0.8 - N.covered[e] * 6;
        if (score > bs) (bs = score), (best = e), (bd = d);
      }
    if (best < 0) {
      // A dead end: turn round.
      a.nxt = a.road;
      a.nxtDir = -a.dir;
      a.nxtTurn = Math.PI;
      return;
    }
    const [ox, oy] = edgeDir(best, bd, false);
    a.nxt = best;
    a.nxtDir = bd;
    a.nxtTurn = Math.acos(Math.max(-1, Math.min(1, ox * ix + oy * iy)));
  };
  /** Metres to the nearest car or wreck ahead in this lane, and whether it is a wreck. */
  const gapAhead = (a: Agent, fx: number, fy: number): [number, boolean] => {
    let g = Infinity, wr = false;
    const look = (ox: number, oy: number, isW: boolean) => {
      const rx = (ox - a.x) * M, ry = (oy - a.y) * M;
      const ahead = rx * fx + ry * fy;
      if (ahead < 0.5 || ahead > 16) return;
      if (Math.abs(-rx * fy + ry * fx) > 2.2) return;
      if (ahead < g) (g = ahead), (wr = isW);
    };
    const R = Math.ceil(m(16) * B);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const b = buckets.get(key(a.x + dx / B, a.y + dy / B));
        if (b) for (const o of b) if (o !== a && isCar(o)) look(o.x, o.y, false);
      }
    for (const w of s.wrecks) if (Math.abs(w.x - a.x) < m(16) && Math.abs(w.y - a.y) < m(16)) look(w.x, w.y, true);
    return [g, wr];
  };
  /** Cars are solid. The first car or wreck that a car body at (x, y) facing `face` would
   *  overlap (boxes about 4.4 x 1.8 m), or null. `onlyAhead`: ignore cars behind (they yield). */
  const CAR_HL = 2.2, CAR_HW = 0.9;
  const bodyHit = (a: Agent, x: number, y: number, face: number, onlyAhead: boolean): Agent | Wreck | null => {
    const fx = Math.cos(face), fy = Math.sin(face);
    const test = (ox: number, oy: number, oface: number) => {
      const rx = (ox - x) * M, ry = (oy - y) * M;
      if (rx * rx + ry * ry > 36) return false;
      const along = rx * fx + ry * fy, lat = -rx * fy + ry * fx;
      const c = Math.abs(Math.cos(oface - face)), sn = Math.abs(Math.sin(oface - face));
      if (Math.abs(along) > CAR_HL + CAR_HL * c + CAR_HW * sn - 0.3) return false;
      if (Math.abs(lat) > CAR_HW + CAR_HL * sn + CAR_HW * c - 0.15) return false;
      return true;
    };
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const b = buckets.get(key(x + dx / B, y + dy / B));
        if (!b) continue;
        for (const o of b) {
          if (o === a || !isCar(o) || o.gone) continue;
          if (onlyAhead) {
            const along = ((o.x - x) * fx + (o.y - y) * fy) * M;
            if (along < -0.3 || (along < 0.3 && o.uid < a.uid)) continue;
          }
          if (test(o.x, o.y, o.face)) return o;
        }
      }
    for (const w of s.wrecks) if (Math.abs(w.x - x) < m(6) && Math.abs(w.y - y) < m(6) && test(w.x, w.y, w.face)) return w;
    return null;
  };
  /** The car stops for good: crashed, or left in a jam. The driver gets out (if they can). */
  const leaveCar = (a: Agent, crashed: boolean) => {
    if (a.car === 1) {
      s.wrecks.push({ x: a.x, y: a.y, face: a.face, burn: crashed && r() < 0.3 ? 40 + r() * 80 : 0, crashed, uid: a.uid });
      if (s.wrecks.length > 400) s.wrecks.shift();
      if (crashed) {
        st.crashes++;
        s.noise.push({ x: a.x, y: a.y, t: 10 });
      } else st.abandoned++;
    }
    a.car = 0;
    a.hasCar = false;
    a.road = -1;
    a.spd = 0;
    a.stuck = 0;
    a.vx = 0;
    a.vy = 0;
    if (crashed && r() < 0.2) {
      a.kind = Kind.Fallen; // did not walk away from it
      return;
    }
    // Out of the driver's door, a step to the side (if that is not a wall).
    const fx = Math.cos(a.face), fy = Math.sin(a.face);
    const ox = a.x - fy * m(2.2), oy = a.y + fx * m(2.2);
    if (!blocked(ox, oy)) (a.x = ox), (a.y = oy);
  };
  const drive = (a: Agent) => {
    const N = net!;
    if (a.think-- <= 0) (a.think = 4), (a.tgt = nearest(a, isDead, SEE));
    a.fear = 1;
    if (a.road < 0) {
      const h = nearestRoad(N, a.x, a.y, m(40));
      if (!h) {
        a.car = 0;
        return;
      }
      a.road = h.edge;
      a.along = h.along;
      a.spd = 0;
      pointAt(N, h.edge, h.along, pa);
      const [wx, wy] = wantDir(a);
      a.dir = pa.tx * wx + pa.ty * wy >= 0 ? 1 : -1;
      a.face = Math.atan2(pa.ty * a.dir, pa.tx * a.dir);
      a.nxt = -1;
      // The car pulls out right in its lane (no sliding across the road to get there), into
      // a gap: if the kerb is full of cars, they wait.
      const lane0 = m(Math.min(3, N.ewid[h.edge] / 4));
      let placed = false;
      for (const off of [0, 6, -6, 12, -12]) {
        const al = Math.max(0, Math.min(N.elen[h.edge], h.along + off));
        pointAt(N, h.edge, al, pa);
        const x = pa.x - pa.ty * a.dir * lane0, y = pa.y + pa.tx * a.dir * lane0;
        if (bodyHit(a, x, y, a.face, false)) continue;
        a.x = x;
        a.y = y;
        a.along = al;
        placed = true;
        break;
      }
      if (!placed) {
        a.car = 2;
        a.road = -1;
        return;
      }
    }
    if (a.nxt < 0) plan(a);
    const wid = N.ewid[a.road];
    const remain = a.dir > 0 ? N.elen[a.road] - a.along : a.along;
    let vMax = wid >= 18 ? SPEED.car * 1.5 : wid >= 13 ? SPEED.car * 1.2 : SPEED.car;
    // Slow down for the turn ahead: a corner at walking pace, a U-turn slower still.
    const vTurn = SPEED.car * (1 - (0.7 * a.nxtTurn) / Math.PI);
    if (remain < 16) vMax = Math.min(vMax, vTurn + (vMax - vTurn) * Math.max(0, (remain - 4) / 12));
    const fx = Math.cos(a.face), fy = Math.sin(a.face);
    const [gap, isWreck] = gapAhead(a, fx, fy);
    if (gap < 16) vMax = Math.min(vMax, Math.max(0, (gap - 5) * 1.2));
    a.spd = Math.max(0, a.spd + Math.max(-9 * dt, Math.min(3.5 * dt, vMax - a.spd)));
    a.stuck = a.spd < 0.5 ? a.stuck + dt : Math.max(0, a.stuck - 2 * dt);
    // A wreck across the lane: turn round. Stuck in a jam too long: get out and run.
    if (isWreck && gap < 9 && a.stuck > 2.5) {
      a.dir = -a.dir;
      a.nxt = -1;
      a.stuck = 0;
      plan(a);
    }
    // People sit in a jam a long while; with the dead close they give up much sooner.
    const z = a.tgt && a.tgt.kind === Kind.Dead && d2(a, a.tgt) < m(40) ** 2;
    if (a.stuck > (z ? 8 : 45)) {
      leaveCar(a, false);
      return;
    }
    const was = { road: a.road, dir: a.dir, along: a.along, nxt: a.nxt, nxtDir: a.nxtDir, nxtTurn: a.nxtTurn, x: a.x, y: a.y, face: a.face };
    let d = a.spd * dt;
    for (let guard = 0; d > 0 && guard < 8; guard++) {
      const rem = a.dir > 0 ? N.elen[a.road] - a.along : a.along;
      if (d <= rem) {
        a.along += a.dir * d;
        break;
      }
      d -= rem;
      a.road = a.nxt;
      a.dir = a.nxtDir;
      a.along = a.dir > 0 ? 0 : N.elen[a.road];
      a.nxt = -1;
      plan(a);
    }
    // Where the car should be: on the road line, shifted into the right-hand lane, using
    // the road's direction over a few metres so the lane bends round corners.
    pointAt(N, a.road, a.along, pc);
    pointAt(N, a.road, a.along - 4 * a.dir, pa);
    pointAt(N, a.road, a.along + 4 * a.dir, pb);
    let tx = pb.x - pa.x, ty = pb.y - pa.y;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) (tx = pc.tx * a.dir), (ty = pc.ty * a.dir);
    else (tx /= tl), (ty /= tl);
    const lane = m(Math.min(3, wid / 4));
    const gx = pc.x - ty * lane, gy = pc.y + tx * lane;
    // Ease toward it (no snapping), and turn the body at a car's pace.
    const k = 1 - Math.exp(-dt / 0.18);
    const mx = (gx - a.x) * k, my = (gy - a.y) * k;
    a.x += mx;
    a.y += my;
    a.vx = mx;
    a.vy = my;
    if (Math.hypot(mx, my) * M > 0.02) {
      let turn = Math.atan2(my, mx) - a.face;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const maxTurn = 3 * dt;
      a.face += Math.max(-maxTurn, Math.min(maxTurn, turn));
    }
    // Solid: never drive into the car (or wreck) in front. Too fast to stop: a pile-up.
    const o = bodyHit(a, a.x, a.y, a.face, true);
    if (o) {
      const fast = a.spd > 6;
      Object.assign(a, was);
      a.vx = a.vy = 0;
      if (fast && r() < 0.5) {
        leaveCar(a, true);
        if ('kind' in o && r() < 0.5) leaveCar(o, true);
        return;
      }
      a.spd = 0;
    }
    // Out of the area: they got away (from here, at least).
    if (a.x < s.x0 + 0.15 || a.y < s.y0 + 0.15 || a.x > s.x0 + s.w - 0.15 || a.y > s.y0 + s.h - 0.15) {
      a.gone = true;
      st.drove++;
      s.exits.push({ x: a.x, y: a.y, armed: a.ammo > 0, ammo: a.ammo });
      return;
    }
    if (a.spd > 3) {
      // The dead in the road: knocked flying, and sometimes the car comes off worse.
      const hitZ = nearest(a, isUp, m(2));
      if (hitZ) {
        hitZ.down = 2;
        if (r() < 0.3) hitZ.kind = Kind.Fallen;
        s.blood.push({ x: hitZ.x, y: hitZ.y });
        a.spd *= 0.6;
        if (r() < 0.04) return leaveCar(a, true);
      }
      // Another car coming across: a crash at the junction.
      const o = nearest(a, isCar, m(2.6), a);
      if (o && o.spd > 3) {
        const rel = Math.abs(Math.atan2(Math.sin(o.face - a.face), Math.cos(o.face - a.face)));
        if (rel > 0.6 && rel < 2.6 && r() < 0.25) {
          leaveCar(a, true);
          leaveCar(o, true);
        }
      }
    }
  };
  for (const w of s.wrecks) if (w.burn > 0) w.burn = Math.max(0, w.burn - dt);

  // Bodies take up room. A 1 m grid of everyone on their feet (or crawling), so a step that
  // would walk into someone is turned aside or held back: crowds pack, they do not merge.
  const SEP = 0.6; // metres between two people's centres, at the closest
  const walker = (a: Agent) => !a.gone && a.kind !== Kind.Fallen && a.car !== 1;
  const G = 1000003;
  const CM = M / 2; // grid squares of 2 m
  const bodyGrid = new Map<number, Agent[]>();
  const walkers: Agent[] = [];
  for (const a of s.agents)
    if (walker(a)) {
      walkers.push(a);
      const k = Math.floor(a.y * CM) * G + Math.floor(a.x * CM);
      let b = bodyGrid.get(k);
      if (!b) bodyGrid.set(k, (b = []));
      b.push(a);
    }
  /** Would standing at (x, y) put `a` inside someone (closer than before)? */
  const bumps = (a: Agent, x: number, y: number): boolean => {
    const X = Math.floor(x * CM), Y = Math.floor(y * CM);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const b = bodyGrid.get((Y + dy) * G + X + dx);
        if (!b) continue;
        for (const o of b) {
          if (o === a || !walker(o)) continue;
          const nd = ((o.x - x) * M) ** 2 + ((o.y - y) * M) ** 2;
          if (nd >= SEP * SEP) continue;
          const od = ((o.x - a.x) * M) ** 2 + ((o.y - a.y) * M) ** 2;
          if (nd < od) return true;
        }
      }
    return false;
  };

  for (const a of s.agents) {
    if (a.kind === Kind.Fallen || a.gone) continue;
    if (a.flash > 0) a.flash--;
    if (a.cooldown > 0) a.cooldown -= dt;
    let tx = 0;
    let ty = 0;
    let speed = 0; // metres per second
    if (a.kind === Kind.Living) {
      // The bitten turn. Nobody can stop that.
      if (a.turn >= 0) {
        a.turn -= dt;
        if (a.turn <= 0) {
          if (a.car === 1) leaveCar(a, false);
          a.kind = Kind.Dead;
          a.ammo = 0;
          a.car = 0;
          a.down = 0;
          a.tgt = null;
          continue;
        }
      }
      if (a.car === 1 && net) {
        drive(a);
        continue;
      }
      if (a.car === 1) {
        // Driving: away from the dead, toward the edge of the area, on roads only.
        const z = a.think-- <= 0 ? ((a.think = 4), (a.tgt = nearest(a, isDead, SEE))) : a.tgt;
        const ex = a.x - (s.x0 + s.w / 2), ey = a.y - (s.y0 + s.h / 2);
        const el = Math.hypot(ex, ey) || 1;
        tx = ex / el;
        ty = ey / el;
        if (z && z.kind === Kind.Dead) {
          const zl = Math.sqrt(d2(a, z)) || 1;
          tx += ((a.x - z.x) / zl) * 1.5;
          ty += ((a.y - z.y) / zl) * 1.5;
        }
        // Keep going roughly the way the car points, so it follows the road.
        if (a.vx || a.vy) {
          const vl = Math.hypot(a.vx, a.vy);
          tx += (a.vx / vl) * 2;
          ty += (a.vy / vl) * 2;
        }
        // A car ahead and close: wait. That is how a jam starts.
        const ahead = nearest(a, (o) => isCar(o) && (o.x - a.x) * tx + (o.y - a.y) * ty > 0, m(7), a);
        speed = ahead ? 0 : SPEED.car;
        a.stuck = speed === 0 ? a.stuck + dt : Math.max(0, a.stuck - dt);
        a.fear = 1;
        // Out of the area: they got away (from here, at least).
        if (a.x < s.x0 + 0.15 || a.y < s.y0 + 0.15 || a.x > s.x0 + s.w - 0.15 || a.y > s.y0 + s.h - 0.15) {
          a.gone = true;
          st.drove++;
          s.exits.push({ x: a.x, y: a.y, armed: a.ammo > 0, ammo: a.ammo });
          continue;
        }
        if (speed > 0) {
          const step = m(speed) * dt;
          const len = Math.hypot(tx, ty) || 1;
          let vx = (tx / len) * step, vy = (ty / len) * step;
          const can = (x: number, y: number) => isLand(world, x, y) && !blocked(x, y) && onRoad(x, y);
          if (!can(a.x + vx, a.y + vy)) {
            // Turn along the road: try the axes, then a random new heading.
            const base = Math.atan2(vy, vx);
            let found = false;
            for (const turn of [0.5, -0.5, 1.0, -1.0, 1.57, -1.57, 2.3, -2.3]) {
              const ang = base + turn * (r() < 0.5 ? 1 : -1);
              const ux = Math.cos(ang) * step, uy = Math.sin(ang) * step;
              if (can(a.x + ux, a.y + uy)) {
                vx = ux;
                vy = uy;
                found = true;
                break;
              }
            }
            if (!found) (vx = 0), (vy = 0);
          }
          if (vx || vy) {
            // Running into the dead: knocks them over (and sometimes worse).
            const hitZ = nearest({ x: a.x + vx, y: a.y + vy }, isUp, m(2));
            if (hitZ) {
              hitZ.down = 2;
              if (r() < 0.3) hitZ.kind = Kind.Fallen;
              s.blood.push({ x: hitZ.x, y: hitZ.y });
            }
            a.x += vx;
            a.y += vy;
            a.vx = vx;
            a.vy = vy;
            a.face = Math.atan2(vy, vx);
          }
        }
        continue;
      }

      if (--a.think <= 0 || (a.tgt && a.tgt.kind !== Kind.Dead)) {
        a.tgt = nearest(a, isDead, SEE);
        a.think = 3 + Math.floor(r() * 3);
      }
      const z = a.tgt;
      if (z) a.fear = Math.min(1, a.fear + 0.5);
      else a.fear = Math.max(0, a.fear - 0.03 * dt);
      const range = a.role === Role.Police ? RANGE.police : RANGE.civ;

      // Fear of the bitten: someone near you shows the signs. A scared person with a gun
      // may shoot them. A calm voice on the radio makes it rarer.
      if (a.ammo > 0 && a.fear > 0.5 && a.turn < 0 && a.cooldown <= 0 && r() < 0.04 * dt * (1 - 0.8 * cellCalm(a))) {
        const sick = nearest(a, showing, m(12), a);
        if (sick) {
          fire(a, sick, true);
          st.fights++;
          continue;
        }
      }

      if (a.ammo > 0 && z && d2(a, z) < range * range) {
        // Stand and shoot.
        a.face = Math.atan2(z.y - a.y, z.x - a.x);
        if (a.cooldown <= 0) fire(a, z, false);
      } else if (a.car === 2 && z && net) {
        // Getting to the car, parked at the kerb: run to the street, then drive off.
        const h = nearestRoad(net, a.x, a.y, m(30));
        if (!h) {
          a.car = 0;
        } else if (h.dist < m(4) && r() < 1.5 * dt) {
          a.car = 1;
          a.road = -1;
          drive(a);
          continue;
        } else {
          pointAt(net, h.edge, h.along, pa);
          const rl = h.dist || 1;
          const zl = Math.sqrt(d2(a, z)) || 1;
          tx = (pa.x - a.x) / rl + ((a.x - z.x) / zl) * 0.4;
          ty = (pa.y - a.y) / rl + ((a.y - z.y) / zl) * 0.4;
          speed = SPEED.run;
        }
      } else if (a.car === 2 && z) {
        // Getting to the car: on a road now? Then drive.
        if (onRoad(a.x, a.y) && r() < 0.5 * dt) {
          a.car = 1;
          a.road = -1;
          a.vx = a.x - z.x;
          a.vy = a.y - z.y;
          continue;
        }
        tx = a.x - z.x;
        ty = a.y - z.y;
        speed = SPEED.run;
      } else if (z && a.ammo > 0) {
        // Armed, the dead seen but not yet in range: hold, or close up with other guns.
        const g = nearest(a, (o) => isGun(o), m(40), a);
        if (!g && a.role !== Role.Police) {
          const g2 = nearest(a, (o) => isGun(o), RALLY, a);
          if (g2) {
            tx = g2.x - a.x;
            ty = g2.y - a.y;
            speed = SPEED.run;
          }
        }
        a.face = Math.atan2(z.y - a.y, z.x - a.x);
      } else if (z) {
        // The choice: fight with what they hold, run to a gun, run to the car, or just run.
        const close = d2(a, z) < m(15) ** 2;
        const few = close && countNear(a, isUp, m(15), 3) <= 2;
        const friends = countNear(a, isLiving, m(10), 2) >= 1;
        if (few && friends && a.weapon > 0 && a.bold > 0.55 && a.turn < 0) {
          // Fight: go at it. The swing happens on contact (below).
          tx = z.x - a.x;
          ty = z.y - a.y;
          speed = SPEED.run;
          if (d2(a, z) < (BITE * 1.3) ** 2 && a.cooldown <= 0 && z.kind === Kind.Dead) {
            const wpn = WEAPONS[a.weapon];
            a.cooldown = SWING;
            const roll = r();
            if (roll < wpn.kill * (1 + 1.5 * a.know)) {
              z.kind = Kind.Fallen;
              st.melee++;
              a.know = Math.min(1, a.know + 0.2);
              s.blood.push({ x: z.x, y: z.y });
            } else if (roll < wpn.kill * (1 + 1.5 * a.know) + wpn.knock) {
              z.down = Math.max(z.down, 1.2);
            }
            speed = 0;
          }
        } else if (a.hasCar && a.car === 0 && a.fear > 0.8 && r() < 0.6 * dt) {
          a.car = 2;
        } else {
          // Run: toward someone armed if one is close and not past the dead, else away.
          const g = nearest(a, isGun, RALLY, a);
          if (g && (g.x - a.x) * (z.x - a.x) + (g.y - a.y) * (z.y - a.y) < 0) {
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
        }
      } else if (a.role !== Role.Police || a.fear < 0.5) {
        tx = a.vx + (r() - 0.5) * 0.02;
        ty = a.vy + (r() - 0.5) * 0.02;
        speed = a.role === Role.Police ? 0 : SPEED.walk + (SPEED.run - SPEED.walk) * a.fear;
      }
    } else {
      // The dead.
      if (a.down > 0) {
        a.down -= dt;
        if (a.down <= 0 && !a.crawl) st.getUps++;
        continue;
      }
      if (--a.think <= 0 || (a.tgt && (a.tgt.kind !== Kind.Living || a.tgt.gone))) {
        a.tgt = nearest(a, (o) => o.kind === Kind.Living && !o.gone, HUNT);
        a.think = 3 + Math.floor(r() * 3);
      }
      const p = a.tgt;
      const fast = a.crawl ? SPEED.crawl : SPEED.dead;
      if (p) {
        tx = p.x - a.x;
        ty = p.y - a.y;
        if (tx * tx + ty * ty < BITE * BITE) {
          if (p.car === 1) {
            // A car: they claw at it; a stopped car is a trap.
            if (p.stuck > 1 && r() < 0.15 * dt) {
              bitten(p);
              leaveCar(p, false);
            }
          } else if (p.turn < 0) {
            // Last chance: a swing with whatever they hold.
            const wpn = WEAPONS[p.weapon];
            const roll = r();
            if (roll < wpn.kill * (1 + 1.5 * p.know) * 0.6) {
              a.kind = Kind.Fallen;
              st.melee++;
              s.blood.push({ x: a.x, y: a.y });
              continue;
            } else if (roll < (wpn.kill * (1 + 1.5 * p.know) + wpn.knock) * 0.6) {
              a.down = 1;
              continue;
            }
            bitten(p);
          }
        }
        speed = fast;
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
          speed = fast * 0.8;
        } else {
          tx = a.vx + (r() - 0.5) * 0.04;
          ty = a.vy + (r() - 0.5) * 0.04;
          speed = Math.min(fast, SPEED.walk * 1.3);
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
    // Walls and water stop you (unless you are already in them: then you may climb out).
    const free = (x: number, y: number) => isLand(world, x, y) && !blocked(x, y) && !wet(x, y);
    let ok = inBox && (free(nx, ny) || (isLand(world, nx, ny) && (blocked(a.x, a.y) || wet(a.x, a.y))));
    let mx = nx, my = ny;
    if (!ok && inBox) {
      // Slide along walls: try moving on one axis only.
      if (free(nx, a.y)) (ok = true), (my = a.y);
      else if (free(a.x, ny)) (ok = true), (mx = a.x);
    }
    if (ok && a.car !== 1 && bumps(a, mx, my)) {
      // Someone in the way: step round them, or wait.
      ok = false;
      for (const turn of [0.8, -0.8, 1.6, -1.6]) {
        const c = Math.cos(turn), sn = Math.sin(turn);
        const ux = vx * c - vy * sn, uy = vx * sn + vy * c;
        if (free(a.x + ux, a.y + uy) && !bumps(a, a.x + ux, a.y + uy)) {
          (mx = a.x + ux), (my = a.y + uy), (ok = true);
          break;
        }
      }
    }
    if (ok) {
      a.x = mx;
      a.y = my;
      a.vx = vx;
      a.vy = vy;
      if (a.kind === Kind.Living && speed > SPEED.walk) a.face = Math.atan2(vy, vx);
    } else {
      a.vx = (r() - 0.5) * step;
      a.vy = (r() - 0.5) * step;
    }
  }

  // Push apart whoever still overlaps (never into a wall or the water), and out of cars.
  {
    const grid = bodyGrid;
    const canStand = (x: number, y: number) => isLand(world, x, y) && !blocked(x, y) && !wet(x, y);
    const nudge = (a: Agent, dx: number, dy: number) => {
      const x = a.x + dx / M, y = a.y + dy / M;
      if (canStand(x, y)) (a.x = x), (a.y = y);
      else if (canStand(x, a.y)) a.x = x;
      else if (canStand(a.x, y)) a.y = y;
    };
    for (let pass = 0; pass < 2; pass++)
      for (const a of walkers) {
        const X = Math.floor(a.x * CM), Y = Math.floor(a.y * CM);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const b = grid.get((Y + dy) * G + X + dx);
            if (!b) continue;
            for (let q = 0; q < b.length && q < 40; q++) {
              const o = b[q];
              if (o.uid <= a.uid) continue; // each pair once
              let rx = (o.x - a.x) * M, ry = (o.y - a.y) * M;
              let d2 = rx * rx + ry * ry;
              if (d2 >= SEP * SEP) continue;
              if (d2 < 1e-6) (rx = r() - 0.5), (ry = r() - 0.5), (d2 = rx * rx + ry * ry);
              const d = Math.sqrt(d2), push = (SEP - d) / 2;
              nudge(a, (-rx / d) * push, (-ry / d) * push);
              nudge(o, (rx / d) * push, (ry / d) * push);
            }
          }
      }
    // Out of car bodies (cars and wrecks are about 4.4 x 1.8 m).
    const pushOut = (cx: number, cy: number, face: number) => {
      const fx = Math.cos(face), fy = Math.sin(face);
      const X = Math.floor(cx * CM), Y = Math.floor(cy * CM);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const b = grid.get((Y + dy) * G + X + dx);
          if (b)
            for (const a of b) {
              const rx = (a.x - cx) * M, ry = (a.y - cy) * M;
              const al = rx * fx + ry * fy, la = -rx * fy + ry * fx;
              if (Math.abs(al) > 2.45 || Math.abs(la) > 1.15) continue;
              // Out the nearer side.
              if (2.45 - Math.abs(al) < 1.15 - Math.abs(la)) {
                const k = (Math.sign(al) || 1) * 2.45 - al;
                nudge(a, fx * k, fy * k);
              } else {
                const k = (Math.sign(la) || 1) * 1.15 - la;
                nudge(a, -fy * k, fx * k);
              }
            }
        }
    };
    for (const a of s.agents) if (a.car === 1 && !a.gone && a.kind === Kind.Living) pushOut(a.x, a.y, a.face);
    for (const w of s.wrecks) if (w.x >= s.x0 && w.y >= s.y0 && w.x < s.x0 + s.w && w.y < s.y0 + s.h) pushOut(w.x, w.y, w.face);
  }

  // Bullets fly. A true shot hits its target when it gets there; anyone in the way, or
  // anyone a miss passes close to, may be hit instead: the dead or the living.
  const alive: Bullet[] = [];
  for (const b of s.bullets) {
    b.px = b.x;
    b.py = b.y;
    const nx = b.x + b.dx * dt;
    const ny = b.y + b.dy * dt;
    let hit: Agent | null = null;
    let ht = 2;
    let onTarget = false;
    const len2 = (nx - b.x) ** 2 + (ny - b.y) ** 2 || 1e-9;
    const R = Math.ceil(Math.sqrt(len2) * B) + 1;
    const cx = (b.x + nx) / 2;
    const cy = (b.y + ny) / 2;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const bucket = buckets.get(key(cx + dx / B, cy + dy / B));
        if (!bucket) continue;
        for (const o of bucket) {
          if (o === b.from || o.kind === Kind.Fallen || o.gone) continue;
          const t = Math.max(0, Math.min(1, ((o.x - b.x) * (nx - b.x) + (o.y - b.y) * (ny - b.y)) / len2));
          const qx = b.x + (nx - b.x) * t;
          const qy = b.y + (ny - b.y) * t;
          const dd = (o.x - qx) ** 2 + (o.y - qy) ** 2;
          if (t >= ht) continue;
          if (o === b.target && b.hit && dd < m(1.5) ** 2) (ht = t), (hit = o), (onTarget = true);
          else if (o !== b.target && dd < BODY_R * BODY_R && r() < (o.kind === Kind.Living ? STRAY_LIVING : STRAY_HIT * (o.down > 0 ? 0.3 : 1))) (ht = t), (hit = o), (onTarget = false);
        }
      }
    if (hit) {
      s.puffs.push({ x: hit.x, y: hit.y, t: 0.4 });
      s.blood.push({ x: hit.x, y: hit.y });
      if (hit.kind === Kind.Living) {
        hit.kind = Kind.Fallen; // the living: one bullet is usually enough
        if (!(onTarget && b.target && b.target.kind === Kind.Living && b.target === hit && hit.turn >= 0)) st.stray++;
      } else {
        st.hits++;
        const head = onTarget ? b.head : r() < 0.1;
        if (head) {
          hit.kind = Kind.Fallen;
          st.heads++;
          if (b.from) b.from.know = Math.min(1, b.from.know + 0.08); // they saw what works
        } else {
          const g = GUNS[b.gun] ?? GUNS[1];
          hit.down = Math.max(hit.down, g.knock * (0.7 + r() * 0.6));
          if (!hit.crawl && r() < g.cripple) (hit.crawl = true), st.crawlers++;
        }
      }
      continue;
    }
    b.x = nx;
    b.y = ny;
    b.life -= dt;
    if (b.life > 0 && isLand(world, nx, ny) && !blocked(nx, ny)) alive.push(b);
    else s.puffs.push({ x: nx, y: ny, t: 0.3 });
  }
  s.bullets = alive;

  // Indoors: people hear it, the dead break in, and when the street goes into chaos the
  // people inside come out running (to their cars if they can).
  const W = s.w;
  const deadIn = new Float32Array(s.w * s.h);
  for (const a of s.agents) {
    if (a.kind !== Kind.Dead || a.down > 0) continue;
    const cx = Math.floor(a.x) - s.x0, cy = Math.floor(a.y) - s.y0;
    if (cx >= 0 && cy >= 0 && cx < s.w && cy < s.h) deadIn[cy * W + cx]++;
  }
  const shotsIn = new Float32Array(s.w * s.h);
  for (const n of s.noise) {
    const cx = Math.floor(n.x) - s.x0, cy = Math.floor(n.y) - s.y0;
    if (cx >= 0 && cy >= 0 && cx < s.w && cy < s.h) shotsIn[cy * W + cx]++;
  }
  for (let li = 0; li < s.indoor.length; li++) {
    const ppl = s.indoor[li];
    if (ppl <= 0) continue;
    const cx = li % W, cy = (li / W) | 0;
    let zNear = deadIn[li];
    if (cx > 0) zNear += 0.5 * deadIn[li - 1];
    if (cx < W - 1) zNear += 0.5 * deadIn[li + 1];
    if (cy > 0) zNear += 0.5 * deadIn[li - W];
    if (cy < s.h - 1) zNear += 0.5 * deadIn[li + W];
    const zReal = zNear * s.scale;
    // Waking up: screams and shots. The asleep need more.
    s.aware[li] = Math.min(1, s.aware[li] + dt * (0.02 * Math.min(5, shotsIn[li]) + 0.01 * Math.min(10, zNear)));
    // Breaking in: the more of the dead, the faster; barricades (awareness) slow them.
    const caught = Math.min(ppl, ppl * Math.min(0.02, 0.0004 * zReal * (1 - 0.6 * s.aware[li])) * dt);
    // Coming out: once the block is in chaos.
    const chaos = s.aware[li] * Math.min(1, zReal / 20);
    const out = Math.min(ppl - caught, ppl * 0.004 * chaos * dt);
    const share = (caught + out) / ppl;
    s.indoorArmed[li] *= 1 - share;
    const am = s.indoorAmmo[li] * (out / ppl);
    s.indoorAmmo[li] *= 1 - share;
    s.indoor[li] = ppl - caught - out;
    st.caughtInside += caught;
    s.pendDead[li] += caught / s.scale;
    s.pendOut[li] += out / s.scale;
    const x = s.x0 + cx, y = s.y0 + cy;
    while (s.pendDead[li] >= 1) {
      s.pendDead[li]--;
      const [ax, ay] = spot(x, y, r, blocked);
      s.agents.push(newAgent(ax, ay, Kind.Dead));
    }
    while (s.pendOut[li] >= 1) {
      s.pendOut[li]--;
      st.cameOut += s.scale;
      const [ax, ay] = spot(x, y, r, blocked);
      const armed = s.indoorArmed[li] > 0 && r() < s.indoorArmed[li] / Math.max(1, s.indoor[li]);
      const a = equip(newAgent(ax, ay, Kind.Living, armed ? Math.max(1, Math.round(am / Math.max(1, out / s.scale))) : 0), r, 0);
      a.fear = 1;
      if (a.hasCar) a.car = 2;
      s.agents.push(a);
    }
  }

  if (s.agents.some((a) => a.gone)) s.agents = s.agents.filter((a) => !a.gone);
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
      const li = (y - s.y0) * s.w + (x - s.x0);
      world.healthy[i] = s.indoor[li];
      world.armed[i] = s.indoorArmed[li];
      world.ammo[i] = s.indoorAmmo[li];
      world.aware[i] = s.aware[li];
      world.infected[i] = 0;
      world.crawl[i] = 0;
      world.moving[i] = 0;
    }
  for (const a of s.agents) {
    if (a.gone) continue;
    const i = Math.floor(a.y) * world.width + Math.floor(a.x);
    if (a.kind === Kind.Living) {
      // The bitten count as the dead now: they will turn soon anyway.
      if (a.turn >= 0) {
        world.infected[i] += s.scale;
        continue;
      }
      world.healthy[i] += s.scale;
      if (a.car > 0 || a.fear > 0.8) world.moving[i] += s.scale;
      if (a.ammo > 0) {
        world.armed[i] += s.scale;
        world.ammo[i] += a.ammo * s.scale;
      }
      if (a.know > 0.5) world.know[i] = Math.min(1, world.know[i] + 0.02);
    } else if (a.kind === Kind.Dead) {
      world.infected[i] += s.scale;
      if (a.crawl) world.crawl[i] += s.scale;
    } else world.fallen[i] += s.scale;
  }
  for (let i = 0; i < world.healthy.length; i++) if (world.moving[i] > world.healthy[i]) world.moving[i] = world.healthy[i];
}
