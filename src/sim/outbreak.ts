// The ground simulation, version 1 (20 Nov 2026).
// People are numbers per map cell, not individual objects, so a whole city fits.
// Each cell holds healthy people, infected (the fast dead) and the fallen, plus what the
// people there know and do: whether they are awake and aware, how many are on the road,
// how well their guns shoot, and whether they have learned that only the head counts.
// Pure functions + a seeded random generator, so every rule can be tested.
//
// Numbers marked (data) come from a source in docs/people-rules.md; (guess) are ours to tune.

export interface World {
  width: number;
  height: number;
  /** false = water or blocked: the dead cannot cross (for now). */
  land: Uint8Array;
  /** 0 = no road, higher = bigger road. The dead flow faster and prefer roads; cars need them. */
  road: Uint8Array;
  healthy: Float32Array;
  infected: Float32Array;
  fallen: Float32Array;
  /** How many of the healthy are armed (a subset of healthy). */
  armed: Float32Array;
  /** Rounds of ammunition held in the cell. */
  ammo: Float32Array;
  /** 0..1: how ready the block is (warned, barricaded). */
  guard: Float32Array;
  /** 0..1: share of the healthy who know the dead are here (awake, lights on, phones ringing). */
  aware: Float32Array;
  /** 0..1: share who have learned that only a hit to the head stops one. */
  know: Float32Array;
  /** Average base hit chance per shot of the armed here (calm, close, good light). */
  skill: Float32Array;
  /** Of the healthy: how many are on the road, leaving (by car or on foot). */
  moving: Float32Array;
  /** Of the infected: crawlers (legs or spine shot); slow, weaker, still bite. */
  crawl: Float32Array;
  /** People who got out of the city through this edge cell (not in healthy any more). */
  escaped: Float32Array;
  /** 0..1: how jammed the road is here (more people want through than it can carry). */
  jam: Float32Array;
  /** 0..1: how calm people here are with each other (raised by a calming voice on the radio). */
  calm: Float32Array;
  /** Last tick: shots fired here (the dead come to the noise). */
  noise: Float32Array;
  /** Last tick: living killed by the living here (fights, stray bullets). */
  strife: Float32Array;
  /** Running totals, for tests and the end screen. */
  stats: Stats;
}

export interface Stats {
  shots: number;
  hits: number;
  heads: number;
  stray: number;
  fights: number;
  escaped: number;
  crawlers: number;
}

export interface Rules {
  /** How hard the dead bite: share of exposed healthy people turned per tick at full contact. */
  bite: number;
  /** Share of the infected in a cell that move to neighbours each tick (fast swarm). */
  surge: number;
  /** Close fighting: share of the dead put down per tick by the people with tools in hand. */
  melee: number;
  /** How much more the swarm prefers a road cell per road level. */
  roadPull: number;
  /** Shots per armed person per tick (one tick = a minute) while the dead are in reach. */
  fireRate: number;
}

/** What time it is and what the night is like (from the clock and the weather). */
export interface Env {
  /** Local hour, 0..24 (19.67 = 7:40 PM). */
  hour: number;
  /** 0..1: how dark the streets are (night, power out). */
  dark: number;
  /** 0..1: how much the TV and phones have spread the news by now. */
  news: number;
  /** Rumours: share of people who still leave (1 = normal), and how much more they fight each other. */
  leave?: number;
  strife?: number;
}

export const DEFAULT_RULES: Rules = { bite: 0.6, surge: 0.35, melee: 0.05, roadPull: 2.5, fireRate: 3 };
export const EVENING: Env = { hour: 19.67, dark: 0.8, news: 0 };

/** Base hit chance per shot, calm, close, good light. Police from RAND 2008 (NYPD 1998-2006:
 *  30% when nobody fired back); the rest are guesses (docs/people-rules.md). */
export const SKILL = { untrained: 0.1, regular: 0.2, hunter: 0.35, police: 0.3, soldier: 0.4, special: 0.6 };
/** Average for the civilian armed: 30% untrained, 45% regular owners, 25% hunters (guess). */
export const CIV_SKILL = 0.3 * SKILL.untrained + 0.45 * SKILL.regular + 0.25 * SKILL.hunter;
/** Share of hits that land on the head before anyone aims for it (guess: chest training). */
export const HEAD_EARLY = 0.12;
/** ...and once a person aims for the head (guess). */
export const HEAD_LEARNED = 0.7;
/** Share of households with a car (guess; Minneapolis about 4 in 5, check ACS). */
export const CAR_SHARE = 0.82;

/** Share of people asleep at a local hour. BLS American Time Use Survey Table A-3 (2021),
 *  all days, shifted one hour later because it is a Friday night (guess). */
const SLEEP_BY_HOUR = [87, 93, 95, 95, 92, 85, 67, 43, 24, 14, 7, 5, 3.5, 4.2, 4.4, 4.0, 3.6, 2.7, 2.5, 3.4, 6.7, 18.7, 43.9, 70.3];
export function asleepShare(hour: number): number {
  const h = (((hour - 1) % 24) + 24) % 24;
  const a = Math.floor(h), f = h - a;
  return (SLEEP_BY_HOUR[a] * (1 - f) + SLEEP_BY_HOUR[(a + 1) % 24] * f) / 100;
}
/** Share of people outdoors or out on the town (guess; a cold October Friday evening). */
export function outsideShare(hour: number): number {
  const awake = 1 - asleepShare(hour);
  return 0.015 + 0.07 * awake * awake;
}

export function createWorld(width: number, height: number): World {
  const n = width * height;
  const f = () => new Float32Array(n);
  return {
    width,
    height,
    land: new Uint8Array(n).fill(1),
    road: new Uint8Array(n),
    healthy: f(),
    infected: f(),
    fallen: f(),
    armed: f(),
    ammo: f(),
    guard: f(),
    aware: f(),
    know: f(),
    skill: new Float32Array(n).fill(CIV_SKILL),
    moving: f(),
    crawl: f(),
    escaped: f(),
    jam: f(),
    calm: f(),
    noise: f(),
    strife: f(),
    stats: { shots: 0, hits: 0, heads: 0, stray: 0, fights: 0, escaped: 0, crawlers: 0 },
  };
}

export function cloneWorld(w: World): World {
  return {
    width: w.width,
    height: w.height,
    land: w.land,
    road: w.road,
    healthy: w.healthy.slice(),
    infected: w.infected.slice(),
    fallen: w.fallen.slice(),
    armed: w.armed.slice(),
    ammo: w.ammo.slice(),
    guard: w.guard.slice(),
    aware: w.aware.slice(),
    know: w.know.slice(),
    skill: w.skill.slice(),
    moving: w.moving.slice(),
    crawl: w.crawl.slice(),
    escaped: w.escaped.slice(),
    jam: w.jam.slice(),
    calm: w.calm.slice(),
    noise: w.noise.slice(),
    strife: w.strife.slice(),
    stats: { ...w.stats },
  };
}

/** Everyone: living, dead, fallen and those who got out. Never changes. */
export function total(w: World): number {
  let t = 0;
  for (let i = 0; i < w.healthy.length; i++) t += w.healthy[i] + w.infected[i] + w.fallen[i] + w.escaped[i];
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

/** Chance one shot hits, for a shooter of base `skill`. Pure, shared by street and city. */
export function hitChance(o: { skill: number; dark: number; fear: number; metres: number; know: number; guard?: number }): number {
  const light = 1 - 0.45 * o.dark; // night, sodium light, muzzle flash
  const nerve = 1 - 0.5 * o.fear * (1 - 0.5 * o.know); // fear shakes hands; veterans steady
  const range = o.metres <= 7 ? 1.2 : o.metres <= 20 ? 0.9 : o.metres <= 50 ? 0.6 : 0.35; // RAND: 37% close, 23% far
  const fast = 0.75; // the dead sprint at you
  return Math.min(0.95, o.skill * light * nerve * range * fast * (1 + 0.3 * (o.guard ?? 0)));
}
/** Share of hits that land on the head. */
export const headShare = (know: number) => HEAD_EARLY + (HEAD_LEARNED - HEAD_EARLY) * know;

const nbrs = (i: number, w: number, h: number, out: number[]) => {
  out.length = 0;
  const x = i % w, y = (i / w) | 0;
  if (x > 0) out.push(i - 1);
  if (x < w - 1) out.push(i + 1);
  if (y > 0) out.push(i - w);
  if (y < h - 1) out.push(i + w);
  return out;
};

/** How far each land cell is from the edge of the map (in cells): the way out of the city. */
const edgeCache = new WeakMap<Uint8Array, Int32Array>();
function edgeDistance(w: World): Int32Array {
  const hit = edgeCache.get(w.land);
  if (hit) return hit;
  const { width, height, land } = w;
  const d = new Int32Array(width * height).fill(1 << 30);
  const q: number[] = [];
  for (let i = 0; i < d.length; i++) {
    const x = i % width, y = (i / width) | 0;
    if (land[i] && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) (d[i] = 0), q.push(i);
  }
  const n: number[] = [];
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    for (const j of nbrs(i, width, height, n)) if (land[j] && d[j] > d[i] + 1) (d[j] = d[i] + 1), q.push(j);
  }
  edgeCache.set(w.land, d);
  return d;
}

/** Advance the world by one tick (a minute). Returns a new world; the old one is untouched. */
export function step(w0: World, rules: Rules = DEFAULT_RULES, env: Env = EVENING, seed = 1): World {
  const w = cloneWorld(w0);
  const { width, height, land, road, healthy, infected, fallen, armed, ammo, guard, aware, know, skill, moving, crawl, jam, calm, noise, strife, stats } = w;
  const n = healthy.length;
  const r = rng(seed);
  const N: number[] = [];
  const sleep = asleepShare(env.hour);
  const outside = outsideShare(env.hour);
  const edge = edgeDistance(w);
  noise.fill(0);
  strife.fill(0);

  // Danger nearby: the dead here and next door (what people can hear and see).
  const near = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    let z = infected[i];
    for (const j of nbrs(i, width, height, N)) z += 0.5 * w0.infected[j];
    near[i] = z;
  }

  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    let h = healthy[i];
    let z = infected[i];

    // 1. Waking up and finding out: screams and shots next door, phones, knocking, the TV.
    if (h > 0) {
      let nb = 0, k = 0;
      for (const j of nbrs(i, width, height, N)) if (land[j]) (nb += w0.aware[j]), k++;
      const heard = Math.min(1, near[i] / (2 + 0.02 * h)) * 0.6 + Math.min(1, w0.noise[i] / 4) * 0.5;
      const slow = 1 - 0.6 * sleep; // the asleep wake up later
      let gain = heard * slow + 0.06 * (k ? nb / k - aware[i] : 0) + 0.004 * env.news * slow;
      gain = Math.max(0, Math.min(1, gain));
      aware[i] = Math.min(1, aware[i] + (1 - aware[i]) * gain + guard[i] * 0.2 * (1 - aware[i]));
    }

    if (z > 0 && h > 0) {
      // 2. Guns. Shots limited by ammo and by how many of the armed are awake and in reach.
      const ready = armed[i] * Math.min(1, 0.3 + aware[i]);
      const shots = Math.min(ammo[i], ready * rules.fireRate * Math.min(1, z / (armed[i] + 1) + 0.2));
      const fear = Math.min(1, z / (h + z) + (1 - aware[i]) * 0.5);
      const p = hitChance({ skill: skill[i], dark: env.dark, fear, metres: 15, know: know[i], guard: guard[i] });
      const hits = shots * p;
      const heads = Math.min(z, hits * headShare(know[i]));
      const body = Math.max(0, Math.min(z - heads, hits - heads));
      // Body hits knock them down for a moment (fewer bites this minute); some become crawlers.
      const crippled = Math.min(z - heads - crawl[i], body * 0.15);
      // Misses fly on: in a crowd of the living, some hit people.
      const stray = Math.min(h * 0.5, shots * (1 - p) * 0.015 * (h / (h + z)) * Math.min(1, h / 40));
      ammo[i] -= shots;
      noise[i] += shots;
      z -= heads;
      fallen[i] += heads;
      crawl[i] = Math.max(0, Math.min(z, crawl[i] + crippled));
      stats.shots += shots;
      stats.hits += hits;
      stats.heads += heads;
      stats.crawlers += crippled;
      stats.stray += stray;
      strife[i] += stray;

      // 3. Hands and tools: bats, hockey sticks, crowbars, pans, knives. Many have nothing.
      const knocked = Math.min(z, body * 0.8);
      const up = Math.max(0, z - knocked); // the dead on their feet this minute
      const fighters = h * aware[i] * 0.55; // about 55% grab something (guess)
      const struck = Math.min(up, up * rules.melee * (fighters / (fighters + up + 1)) * (1 + 2 * know[i]));
      z -= struck;
      fallen[i] += struck;

      // 4. Bites. Crawlers bite less; doors and barricades slow them; the asleep are caught out.
      const biting = Math.max(0, up - struck - crawl[i] * 0.7);
      const contact = biting / (h + biting);
      const shelter = (1 - outside) * (0.2 + 0.35 * aware[i]) + 0.5 * guard[i];
      const exposedRoad = moving[i] / Math.max(1, h); // on the road: open, and trapped if jammed
      const shelterAll = Math.min(0.85, shelter * (1 - exposedRoad) + exposedRoad * (jam[i] > 0.5 ? 0 : 0.4));
      const turned = Math.min(h - stray, h * rules.bite * contact * (1 - shelterAll));
      const keep = h > 0 ? 1 - (turned + stray) / h : 0;
      armed[i] *= keep;
      moving[i] *= keep;
      h -= turned + stray;
      fallen[i] += stray;
      healthy[i] = Math.max(0, h);
      infected[i] = z + turned;

      // 5. Learning: watching what works. Survivors who keep fighting get better at it.
      const seen = heads + struck;
      if (seen > 0 && h > 0) know[i] = Math.min(1, know[i] + (1 - know[i]) * 0.08 * Math.min(1, seen / 3));
    }

    // 6. Deciding: stay and barricade, or run for it. Aware people in danger leave; people
    //    copy their neighbours; the armed stay more; nobody leaves a quiet street.
    h = healthy[i];
    if (h > 0) {
      const danger = near[i] / (near[i] + 0.04 * h + 4);
      let herd = 0, k = 0;
      for (const j of nbrs(i, width, height, N)) if (land[j] && w0.healthy[j] > 0) (herd += w0.moving[j] / w0.healthy[j]), k++;
      herd = k ? herd / k : 0;
      const armedShare = armed[i] / h;
      const go = Math.min(0.5, (env.leave ?? 1) * aware[i] * danger * 0.35 * (1 + 2 * herd) * (1 - 0.5 * armedShare) * (1 - 0.6 * guard[i]));
      moving[i] = Math.min(h, moving[i] + (h - moving[i]) * go);
    }
  }

  // 7. People against people. Not panic: reasons. A jammed road, one seat, a locked door,
  //    someone who might be bitten, frightened people with guns. A calm voice helps.
  for (let i = 0; i < n; i++) {
    const h = healthy[i];
    if (!land[i] || h < 1) continue;
    const z = infected[i];
    const suspicion = aware[i] * (z / (h + z + 1)) * Math.min(1, (armed[i] / h) * 4);
    const rate = (0.006 * jam[i] + 0.004 * suspicion) * (1 - 0.8 * calm[i]) * (env.strife ?? 1);
    const killed = Math.min(h * 0.2, h * rate * (0.5 + r()));
    if (killed <= 0) continue;
    const keep = 1 - killed / h;
    armed[i] *= keep;
    moving[i] *= keep;
    healthy[i] -= killed;
    fallen[i] += killed;
    strife[i] += killed;
    noise[i] += killed * 2;
    stats.fights += killed;
  }

  // 8. The road out: people leaving move toward the edge of the city, away from the dead,
  //    on roads (most by car). A road carries only so many; the rest wait in a jam.
  const flow = new Float32Array(n);
  const flowArmed = new Float32Array(n);
  const flowKnow = new Float32Array(n);
  const inflow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const m = moving[i];
    if (!land[i] || m < 0.01) continue;
    if (edge[i] === 0) {
      // Out of the city.
      const share = m / Math.max(m, healthy[i]);
      const a = armed[i] * share;
      healthy[i] -= m;
      armed[i] -= a;
      ammo[i] -= ammo[i] * share;
      w.escaped[i] += m;
      stats.escaped += m;
      moving[i] = 0;
      jam[i] *= 0.5;
      continue;
    }
    let best = -1, bestW = 0;
    for (const j of nbrs(i, width, height, N)) {
      if (!land[j] || edge[j] >= edge[i]) continue;
      const wgt = (road[j] + 0.3) / (1 + infected[j]);
      if (wgt > bestW) (bestW = wgt), (best = j);
    }
    if (best < 0) continue;
    const capacity = road[i] >= 3 ? 400 : road[i] >= 1 ? 120 : 30; // per minute (guess)
    const speed = CAR_SHARE * 0.9 + (1 - CAR_SHARE) * 0.3;
    const go = Math.min(m * speed, capacity);
    jam[i] = Math.min(1, Math.max(0, (m * speed - capacity) / capacity));
    const share = go / Math.max(go, healthy[i]);
    const a = armed[i] * share;
    flow[i] -= go;
    flow[best] += go;
    flowArmed[i] -= a;
    flowArmed[best] += a;
    flowKnow[best] += go * know[i];
    inflow[best] += go;
    const am = ammo[i] * share;
    ammo[i] -= am;
    ammo[best] += am;
  }
  for (let i = 0; i < n; i++) {
    if (!flow[i] && !inflow[i]) continue;
    if (inflow[i] > 0) {
      // Arrivals bring what they know.
      const h0 = Math.max(0, healthy[i]);
      know[i] = Math.min(1, (know[i] * h0 + flowKnow[i]) / (h0 + inflow[i]));
    }
    healthy[i] = Math.max(0, healthy[i] + flow[i]);
    armed[i] = Math.max(0, Math.min(healthy[i], armed[i] + flowArmed[i]));
    moving[i] = Math.max(0, Math.min(healthy[i], moving[i] + flow[i]));
  }

  // 9. Word of mouth: what works spreads to the next block.
  const k0 = w.know.slice();
  for (let i = 0; i < n; i++) {
    if (!land[i] || healthy[i] < 1) continue;
    let s = 0, c = 0;
    for (const j of nbrs(i, width, height, N)) if (land[j] && healthy[j] >= 1) (s += k0[j]), c++;
    if (c) know[i] = Math.max(know[i], know[i] + 0.03 * (s / c - know[i]));
    calm[i] = Math.max(0, calm[i] - 0.01);
  }

  // 10. The swarm moves toward the living and toward noise (4 neighbours, water blocks).
  //     Lit windows draw them a little. Crawlers barely move.
  const moved = new Float32Array(n);
  const movedCrawl = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const z = infected[i];
      if (z <= 0) continue;
      const open = nbrs(i, width, height, N).filter((j) => land[j]);
      if (open.length === 0) continue;
      let sum = 0;
      const weights = open.map((j) => {
        const awake = (1 - sleep) * 0.5 + aware[j] * 0.5;
        const wgt = (healthy[j] + 1) * (1 + road[j] * rules.roadPull) * (1 + 0.3 * Math.min(10, noise[j])) * (1 + 0.1 * awake);
        sum += wgt;
        return wgt;
      });
      const walkers = Math.max(0, z - crawl[i]);
      const leaving = walkers * Math.min(0.9, rules.surge * (1 + road[i] * 0.5)) + crawl[i] * 0.02;
      const crawlLeaving = crawl[i] * 0.02;
      moved[i] -= leaving;
      movedCrawl[i] -= crawlLeaving;
      open.forEach((j, k) => {
        moved[j] += (leaving * weights[k]) / sum;
        movedCrawl[j] += (crawlLeaving * weights[k]) / sum;
      });
    }
  }
  for (let i = 0; i < n; i++) {
    infected[i] = Math.max(0, infected[i] + moved[i]);
    crawl[i] = Math.max(0, Math.min(infected[i], crawl[i] + movedCrawl[i]));
  }
  return w;
}
